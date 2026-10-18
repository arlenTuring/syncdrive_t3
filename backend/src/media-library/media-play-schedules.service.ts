import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { MediaLibraryItem, MediaLibraryKind } from '../database/entities/media-library-item.entity';
import { MediaPlayBatch, MediaPlayDelivery, MediaPlaySchedule, MediaPlayScheduleItem } from '../database/entities/media-play-schedule.entities';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import { SystemFoundationSettingsService } from '../system-health/system-foundation-settings.service';
import { groupMediaIds, memberSummary, mediaUnavailableReason, UNAVAILABLE_LABEL } from './media-availability';
import { MediaGroupsService } from './media-groups.service';
import {
  assertDate,
  assertTimeZone,
  nextTimedOccurrence,
  normaliseWeekly,
  parseLocalDateTime,
  weekdayLabel,
  zonedToEpoch,
  type Weekly,
} from './media-schedule-time';

export const SCHEDULE_NAME_MAX = 60;
export const PLAYLIST_MAX = 100;
const PAGE_SIZE_MAX = 50;
export const MEDIA_SCHEDULE_TAG = 'table:media_play_schedules';

export type ScheduleInput = {
  name?: unknown;
  mode?: unknown;
  time_zone?: unknown;
  run_local?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  weekly?: unknown;
  target_scope?: unknown;
  vehicle_ids?: unknown;
  media_ids?: unknown;
  source_group?: unknown;
  expected_version?: unknown;
};

type Normalised = {
  name: string;
  mode: 'reserved' | 'timed';
  timeZone: string;
  runLocal: string | null;
  runAt: number | null;
  startDate: string | null;
  endDate: string | null;
  weekly: Weekly | null;
  targetScope: 'all' | 'vehicles';
  vehicleIds: string[];
  mediaIds: string[];
  sourceGroup: { id: string; version: number } | null;
};

/**
 * 媒體排程設定（預約播放、定時播放）。只有這兩種模式；循環播放不在本功能。
 *
 * - 清單是「當下複製的有序媒體 ID」，套用分組只複製，不跟隨分組後續變動。
 * - 修改以 row_version 樂觀鎖；鎖定順序與媒體／分組相同：先媒體（FOR SHARE）、再排程。
 * - 修改只影響尚未處理的時點：next_run_at 從「現在」與「最後一次已處理時點」之後重新計算，
 *   已到期處理過的時點不會因編輯再執行一次。
 */
@Injectable()
export class MediaPlaySchedulesService {
  /** 測試可注入時鐘；正式環境是後端實際時間（不跟營運模擬時鐘） */
  now: () => number = () => Date.now();

  constructor(
    private readonly dataSource: DataSource,
    private readonly groups: MediaGroupsService,
    @Optional() private readonly settings?: SystemFoundationSettingsService,
    @Optional() private readonly invalidation?: DatasourceInvalidationService,
  ) {}

  async defaultTimeZone() {
    try {
      return (await this.settings?.get())?.locale?.timeZone || 'Asia/Taipei';
    } catch {
      return 'Asia/Taipei';
    }
  }

  async list(args: { keyword?: string; page?: number; page_size?: number; sort_by?: string; sort_direction?: string }) {
    const page = Math.max(1, Math.floor(Number(args.page)) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(Number(args.page_size)) || 10));
    const direction = args.sort_direction === 'desc' ? 'DESC' : 'ASC';
    const qb = this.dataSource.getRepository(MediaPlaySchedule).createQueryBuilder('s').where("s.status <> 'deleted'");
    const keyword = args.keyword?.trim();
    if (keyword) qb.andWhere('s.name ILIKE :kw', { kw: `%${keyword.replace(/[\\%_]/g, (c) => `\\${c}`)}%` });
    // 排序用原始欄位或下一次時點，不用中文摘要；同值依 id 穩定排序
    const sort: Record<string, string> = { name: 's.name', mode: 's.mode', target: 's.target_scope', next_run_at: 'COALESCE(s.next_run_at, s.run_at)', created_at: 's.created_at' };
    qb.orderBy(sort[args.sort_by ?? 'created_at'] ?? sort.created_at, direction, 'NULLS LAST').addOrderBy('s.id', 'ASC');
    const total = await qb.getCount();
    const rows = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    const vehicles = await this.vehicleNames(rows.flatMap((row) => row.vehicleIds ?? []));
    const counts = await this.itemCounts(rows.map((row) => row.id));
    return { items: rows.map((row) => this.present(row, vehicles, counts.get(row.id) ?? 0)), total, page, page_size: pageSize };
  }

  async get(id: string) {
    const row = await this.find(this.dataSource.manager, id);
    const items = await this.dataSource.getRepository(MediaPlayScheduleItem).find({ where: { scheduleId: id }, order: { position: 'ASC' } });
    const media = await this.dataSource.getRepository(MediaLibraryItem).find({ where: { id: In(items.map((item) => item.mediaId)) } });
    const byId = new Map(media.map((m) => [m.id, m]));
    const vehicles = await this.vehicleNames(row.vehicleIds ?? []);
    return {
      ...this.present(row, vehicles, items.length),
      items: items.map((item) => {
        const m = byId.get(item.mediaId);
        return m ? { ...memberSummary(m), missing: false } : { id: item.mediaId, name: null, media_type: null, description: '', available: false, unavailable_label: '媒體已不存在', missing: true };
      }),
    };
  }

  async create(input: ScheduleInput, actor?: string) {
    const data = await this.validate(input, null);
    const saved = await this.dataSource.transaction(async (manager) => {
      await this.lockAndCheckMedia(manager, data.mediaIds);
      await this.checkVehicles(manager, data);
      const group = await this.checkSourceGroup(manager, data, null);
      const now = String(this.now());
      const row = manager.create(MediaPlaySchedule, {
        name: data.name,
        mode: data.mode,
        timeZone: data.timeZone,
        runLocal: data.runLocal,
        runAt: data.runAt === null ? null : String(data.runAt),
        startDate: data.startDate,
        endDate: data.endDate,
        weekly: data.weekly,
        targetScope: data.targetScope,
        vehicleIds: data.vehicleIds,
        sourceGroup: group,
        nextRunAt: null,
        status: 'active',
        version: 1,
        createdBy: actor ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      const next = this.firstPending(data, null);
      if (next === null) throw new BadRequestException(data.mode === 'reserved' ? '預約時間已過，請選擇未來的時間' : '有效日期內已沒有未來的播放時點');
      row.nextRunAt = String(next);
      const created = await manager.save(row);
      await this.writeItems(manager, created.id, data.mediaIds);
      return created;
    });
    this.changed('media_schedule_created');
    return this.get(saved.id);
  }

  async update(id: string, input: ScheduleInput) {
    const expected = this.version(input.expected_version);
    await this.dataSource.transaction(async (manager) => {
      const current = await this.find(manager, id);
      const data = await this.validate(input, current);
      await this.lockAndCheckMedia(manager, data.mediaIds);
      const locked = await this.lock(manager, id, expected);
      await this.checkVehicles(manager, data);
      const group = await this.checkSourceGroup(manager, data, locked.sourceGroup);
      const lastDone = await this.lastProcessedAt(manager, id);
      let next: number | null;
      let status = locked.status;
      if (data.mode === 'reserved' && locked.mode === 'reserved' && data.runAt === Number(locked.runAt)) {
        // 預約時間沒改：維持原本狀態（已執行過的不會因為改名或改清單再觸發）
        next = locked.nextRunAt === null ? null : Number(locked.nextRunAt);
      } else {
        next = this.firstPending(data, lastDone);
        if (data.mode === 'reserved' && next === null) throw new BadRequestException('新的預約時間已過，請選擇未來的時間');
        status = next === null ? 'completed' : 'active';
      }
      const result = await manager
        .createQueryBuilder()
        .update(MediaPlaySchedule)
        .set({
          name: data.name,
          mode: data.mode,
          timeZone: data.timeZone,
          runLocal: data.runLocal,
          runAt: data.runAt === null ? null : String(data.runAt),
          startDate: data.startDate,
          endDate: data.endDate,
          weekly: data.weekly as never,
          targetScope: data.targetScope,
          vehicleIds: data.vehicleIds as never,
          sourceGroup: group as never,
          nextRunAt: next === null ? null : String(next),
          status,
          version: () => 'row_version + 1',
          updatedAt: String(this.now()),
        })
        .where('id = :id AND row_version = :version', { id, version: locked.version })
        .execute();
      if (!result.affected) throw new ConflictException('排程已被其他使用者修改，請重新整理');
      await manager.delete(MediaPlayScheduleItem, { scheduleId: id });
      await this.writeItems(manager, id, data.mediaIds);
    });
    this.changed('media_schedule_updated');
    return this.get(id);
  }

  /** 刪除：不再產生未來播放；保留歷史結果；不刪媒體、分組、檔案，也不發送停止指令 */
  async remove(id: string, expectedRaw: unknown) {
    const expected = this.version(expectedRaw);
    await this.dataSource.transaction(async (manager) => {
      await this.lock(manager, id, expected);
      const now = String(this.now());
      await manager.update(MediaPlaySchedule, { id }, { status: 'deleted', nextRunAt: null, deletedAt: now, updatedAt: now, version: () => 'row_version + 1' });
      // 清單關聯拿掉：已刪除的排程不再擋媒體刪除（歷史批次另存當時內容）
      await manager.delete(MediaPlayScheduleItem, { scheduleId: id });
    });
    this.changed('media_schedule_deleted');
    return { deleted: true };
  }

  async results(id: string) {
    await this.find(this.dataSource.manager, id, true);
    const batches = await this.dataSource.getRepository(MediaPlayBatch).find({ where: { scheduleId: id }, order: { scheduledAt: 'DESC' }, take: 20 });
    const deliveries = batches.length
      ? await this.dataSource.getRepository(MediaPlayDelivery).find({ where: { batchId: In(batches.map((b) => b.id)) }, order: { vehicleCode: 'ASC' } })
      : [];
    return {
      items: batches.map((batch) => ({
        id: batch.id,
        scheduled_at: Number(batch.scheduledAt),
        status: batch.status,
        schedule_version: batch.scheduleVersion,
        detail: batch.detail,
        deliveries: deliveries.filter((d) => d.batchId === batch.id).map((d) => ({ vehicle_id: d.vehicleId, vehicle_code: d.vehicleCode, vehicle_name: d.vehicleName, status: d.status, reason: d.reason })),
      })),
    };
  }

  /** 指派載具選項：註冊中的載具（名稱與通訊代號分開） */
  async vehicleOptions() {
    const rows = await this.dataSource.query<Array<{ id: string; vehicle_code: string; display_name: string | null }>>(
      `SELECT id, vehicle_code, display_name FROM vehicles WHERE is_active = true ORDER BY vehicle_code`,
    );
    return { items: rows.map((row) => ({ id: row.id, vehicle_code: row.vehicle_code, display_name: row.display_name?.trim() || row.vehicle_code })) };
  }

  /** 分組選項：列表與成員（只讀摘要；不需要分組編輯權限） */
  groupOptions(args: { keyword?: string; page?: number }) {
    return this.groups.list({ keyword: args.keyword, page: args.page, page_size: 5 });
  }

  /** 單一媒體選項（只有 kind=media；標示無法加入原因） */
  async mediaOptions(args: { keyword?: string; page?: number; page_size?: number }) {
    const page = Math.max(1, Math.floor(Number(args.page)) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(Number(args.page_size)) || 6));
    const qb = this.dataSource.getRepository(MediaLibraryItem).createQueryBuilder('m').where('m.kind = :kind', { kind: MediaLibraryKind.MEDIA });
    const keyword = args.keyword?.trim();
    if (keyword) qb.andWhere("(m.name ILIKE :kw OR COALESCE(m.body->>'description', '') ILIKE :kw)", { kw: `%${keyword.replace(/[\\%_]/g, (c) => `\\${c}`)}%` });
    qb.orderBy('m.name', 'ASC').addOrderBy('m.id', 'ASC');
    const total = await qb.getCount();
    const rows = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    return { items: rows.map(memberSummary), total, page, page_size: pageSize, limits: { playlist_max: PLAYLIST_MAX } };
  }

  /** 有引用這個媒體的排程（尚未刪除的） */
  async referencingSchedules(manager: EntityManager, mediaId: string) {
    return manager.query<Array<{ id: string; name: string }>>(
      `SELECT DISTINCT s.id, s.name FROM media_play_schedule_items i JOIN media_play_schedules s ON s.id = i.schedule_id
        WHERE i.media_id = $1 AND s.status <> 'deleted' ORDER BY s.name`,
      [mediaId],
    );
  }

  // ── 內部 ───────────────────────────────────────────────

  private async validate(input: ScheduleInput, current: MediaPlaySchedule | null): Promise<Normalised> {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw new BadRequestException('請輸入排程名稱');
    if (name.length > SCHEDULE_NAME_MAX) throw new BadRequestException(`排程名稱最多 ${SCHEDULE_NAME_MAX} 字`);
    if (input.mode !== 'reserved' && input.mode !== 'timed') throw new BadRequestException('播放模式只能是預約播放或定時播放');
    const timeZone = assertTimeZone(input.time_zone ?? current?.timeZone ?? (await this.defaultTimeZone()));
    const out: Normalised = { name, mode: input.mode, timeZone, runLocal: null, runAt: null, startDate: null, endDate: null, weekly: null, targetScope: 'all', vehicleIds: [], mediaIds: [], sourceGroup: null };
    // 只取生效模式的欄位，另一模式的殘留一律不保存
    if (out.mode === 'reserved') {
      const local = parseLocalDateTime(input.run_local);
      out.runLocal = `${local.date}T${local.time}`;
      out.runAt = zonedToEpoch(local.date, local.time, timeZone);
    } else {
      out.startDate = assertDate(input.start_date, '開始日期');
      out.endDate = input.end_date === null || input.end_date === undefined || input.end_date === '' ? null : assertDate(input.end_date, '結束日期');
      if (out.endDate && out.endDate < out.startDate) throw new BadRequestException('結束日期不得早於開始日期');
      out.weekly = normaliseWeekly(input.weekly);
    }
    if (input.target_scope === 'all') out.targetScope = 'all';
    else if (input.target_scope === 'vehicles') {
      out.targetScope = 'vehicles';
      const ids = Array.isArray(input.vehicle_ids) ? input.vehicle_ids.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()) : [];
      if (!ids.length) throw new BadRequestException('請至少指定一台載具');
      if (new Set(ids).size !== ids.length) throw new BadRequestException('指定載具有重複');
      out.vehicleIds = ids;
    } else throw new BadRequestException('請選擇指派範圍');
    if (!Array.isArray(input.media_ids) || input.media_ids.some((v) => typeof v !== 'string' || !v.trim())) throw new BadRequestException('播放清單格式不正確');
    out.mediaIds = input.media_ids.map((v: string) => v.trim());
    if (!out.mediaIds.length) throw new BadRequestException('播放清單至少要有一個媒體');
    if (out.mediaIds.length > PLAYLIST_MAX) throw new BadRequestException(`播放清單最多 ${PLAYLIST_MAX} 個媒體`);
    if (new Set(out.mediaIds).size !== out.mediaIds.length) throw new BadRequestException('播放清單有重複的媒體');
    if (input.source_group && typeof input.source_group === 'object') {
      const sg = input.source_group as { id?: unknown; version?: unknown };
      if (typeof sg.id !== 'string' || !Number.isInteger(Number(sg.version))) throw new BadRequestException('來源分組資訊不正確');
      out.sourceGroup = { id: sg.id, version: Number(sg.version) };
    }
    return out;
  }

  /** 第一個尚未處理的時點：預約＝執行時刻（未來才算）；定時＝現在與最後已處理時點之後的下一個 */
  private firstPending(data: Normalised, lastProcessed: number | null): number | null {
    const now = this.now();
    if (data.mode === 'reserved') return data.runAt! > now && (lastProcessed === null || data.runAt! > lastProcessed) ? data.runAt! : null;
    const after = Math.max(now, lastProcessed ?? -Infinity);
    return nextTimedOccurrence({ startDate: data.startDate!, endDate: data.endDate, weekly: data.weekly!, timeZone: data.timeZone }, after);
  }

  private async lastProcessedAt(manager: EntityManager, id: string) {
    const [row] = await manager.query<Array<{ at: string | null }>>(`SELECT MAX(scheduled_at) AS at FROM media_play_batches WHERE schedule_id = $1`, [id]);
    return row?.at === null || row?.at === undefined ? null : Number(row.at);
  }

  /** 清單媒體：FOR SHARE 鎖住（擋同時進行的永久刪除），逐一檢查存在、是單一媒體、可播放 */
  private async lockAndCheckMedia(manager: EntityManager, ids: string[]) {
    const rows = await manager
      .getRepository(MediaLibraryItem)
      .createQueryBuilder('m')
      .setLock('pessimistic_read')
      .where('m.id IN (:...ids)', { ids: [...new Set(ids)].sort() })
      .orderBy('m.id', 'ASC')
      .getMany();
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) throw new ConflictException('播放清單中有媒體已不存在，請移除後再儲存');
      if (row.kind !== MediaLibraryKind.MEDIA) throw new BadRequestException('播放清單只能放單一媒體，不能放分組');
      const reason = mediaUnavailableReason(row);
      if (reason) throw new BadRequestException(`「${row.name}」無法播放：${UNAVAILABLE_LABEL[reason]}`);
    }
  }

  private async checkVehicles(manager: EntityManager, data: Normalised) {
    if (data.targetScope !== 'vehicles') return;
    const rows = await manager.query<Array<{ id: string }>>(`SELECT id FROM vehicles WHERE id::text = ANY($1::text[]) AND is_active = true`, [data.vehicleIds]);
    if (rows.length !== data.vehicleIds.length) throw new BadRequestException('指定的載具有不存在或已移除的項目，請重新選擇');
  }

  /** 新套用的來源分組：確認仍存在且版本相同（成員沒變）；沿用原本的來源不再檢查 */
  private async checkSourceGroup(manager: EntityManager, data: Normalised, stored: MediaPlaySchedule['sourceGroup']) {
    if (!data.sourceGroup) return null;
    if (stored && stored.id === data.sourceGroup.id && stored.version === data.sourceGroup.version) return stored;
    const group = await manager.findOne(MediaLibraryItem, { where: { id: data.sourceGroup.id, kind: MediaLibraryKind.GROUP } });
    if (!group) throw new ConflictException('套用的媒體分組已被刪除，請重新選擇');
    if (group.version !== data.sourceGroup.version) throw new ConflictException('套用後媒體分組已被修改，請重新套用');
    if (groupMediaIds(group).join() !== data.mediaIds.join()) {
      // 套用後使用者自己調整過清單：照樣保存清單，來源只做追溯
    }
    return { id: group.id, name: group.name, version: group.version, applied_at: this.now() };
  }

  private async writeItems(manager: EntityManager, scheduleId: string, mediaIds: string[]) {
    if (!mediaIds.length) return;
    await manager.insert(MediaPlayScheduleItem, mediaIds.map((mediaId, position) => ({ scheduleId, position, mediaId })));
  }

  private async find(manager: EntityManager, id: string, includeDeleted = false) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('找不到媒體排程');
    const row = await manager.findOne(MediaPlaySchedule, { where: { id } });
    if (!row || (!includeDeleted && row.status === 'deleted')) throw new NotFoundException('找不到媒體排程');
    return row;
  }

  private async lock(manager: EntityManager, id: string, expected: number) {
    const row = await manager.getRepository(MediaPlaySchedule).createQueryBuilder('s').setLock('pessimistic_write').where('s.id = :id', { id }).getOne();
    if (!row || row.status === 'deleted') throw new NotFoundException('找不到媒體排程，可能已被刪除');
    if (row.version !== expected) throw new ConflictException('排程已被其他使用者修改，請重新整理');
    return row;
  }

  private version(raw: unknown) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) throw new BadRequestException('缺少排程版本，請重新整理');
    return value;
  }

  private async vehicleNames(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, { id: string; vehicle_code: string; display_name: string; active: boolean }>();
    const rows = await this.dataSource.query<Array<{ id: string; vehicle_code: string; display_name: string | null; is_active: boolean }>>(
      `SELECT id, vehicle_code, display_name, is_active FROM vehicles WHERE id::text = ANY($1::text[])`,
      [unique],
    );
    return new Map(rows.map((row) => [row.id, { id: row.id, vehicle_code: row.vehicle_code, display_name: row.display_name?.trim() || row.vehicle_code, active: row.is_active }]));
  }

  private async itemCounts(ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const rows = await this.dataSource.query<Array<{ schedule_id: string; n: string }>>(`SELECT schedule_id, count(*) AS n FROM media_play_schedule_items WHERE schedule_id = ANY($1::uuid[]) GROUP BY schedule_id`, [ids]);
    return new Map(rows.map((row) => [row.schedule_id, Number(row.n)]));
  }

  private present(row: MediaPlaySchedule, vehicles: Awaited<ReturnType<MediaPlaySchedulesService['vehicleNames']>>, itemCount: number) {
    return {
      id: row.id,
      name: row.name,
      mode: row.mode,
      time_zone: row.timeZone,
      run_local: row.runLocal,
      run_at: row.runAt === null ? null : Number(row.runAt),
      start_date: row.startDate,
      end_date: row.endDate,
      weekly: row.weekly,
      target_scope: row.targetScope,
      vehicles: (row.vehicleIds ?? []).map((id) => vehicles.get(id) ?? { id, vehicle_code: id, display_name: '已移除的載具', active: false }),
      source_group: row.sourceGroup,
      next_run_at: row.nextRunAt === null ? null : Number(row.nextRunAt),
      status: row.status,
      version: row.version,
      item_count: itemCount,
      summary: scheduleSummary(row),
      created_at: Number(row.createdAt),
      updated_at: Number(row.updatedAt),
    };
  }

  private changed(reason: string) {
    this.invalidation?.emit([MEDIA_SCHEDULE_TAG], reason);
  }
}

/** 播放時間摘要（顯示用；排序不用這個字串） */
export function scheduleSummary(row: Pick<MediaPlaySchedule, 'mode' | 'runLocal' | 'startDate' | 'endDate' | 'weekly'>) {
  if (row.mode === 'reserved') return (row.runLocal ?? '').replace('T', ' ');
  const days = Object.entries(row.weekly ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, times]) => `${weekdayLabel(day)} ${times.join('、')}`)
    .join('；');
  return `${row.startDate} 至 ${row.endDate ?? '無結束日期'}　${days}`;
}
