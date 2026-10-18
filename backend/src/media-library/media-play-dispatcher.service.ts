import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { MediaLibraryItem, MediaLibraryKind } from '../database/entities/media-library-item.entity';
import { MediaPlayBatch, MediaPlayDelivery, MediaPlaySchedule, MediaPlayScheduleItem } from '../database/entities/media-play-schedule.entities';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import { mediaUnavailableReason, UNAVAILABLE_LABEL, type MediaBody } from './media-availability';
import { MEDIA_SCHEDULE_TAG } from './media-play-schedules.service';
import { countTimedOccurrences, nextTimedOccurrence } from './media-schedule-time';

/** 到期後還在這個時間內就照常處理；超過（例如後端停機）標示錯過，不補播 */
export const DUE_GRACE_MS = 2 * 60_000;
/** 載具最後一次健康心跳在這段時間內才算在線（與即時清單相同門檻） */
const ONLINE_WITHIN_MS = 5_000;
const TICK_MS = 15_000;
const CLAIM_LIMIT = 20;

/** 目前車端沒有媒體播放的指令契約：到期只建立待下發資料，不發 MQTT、不假裝已播放 */
export const PLAYBACK_CONTRACT_MISSING = '媒體播放介接尚未就緒：車端尚無媒體播放指令契約，未下發';

/**
 * 媒體排程到期處理。後端自己跑，不靠使用者開著網頁；用後端實際時間，不跟營運模擬時鐘。
 *
 * 防重：
 * - 以 FOR UPDATE SKIP LOCKED 領取到期排程，多個後端實例不會同時處理同一筆。
 * - 批次唯一鍵（排程, 排定時刻）、明細唯一鍵（批次, 載具）：重啟、重試都不會多產生一份。
 * - 領取時持有排程列鎖，編輯／刪除必須等它處理完（反之亦然），版本記在批次上。
 * - 只往前推 next_run_at，不預先展開未來時點。
 */
@Injectable()
export class MediaPlayDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaPlayDispatcherService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  now: () => number = () => Date.now();

  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly invalidation?: DatasourceInvalidationService,
  ) {}

  onModuleInit() {
    if (process.env.MEDIA_SCHEDULE_DISPATCH === '0' || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // 重啟後先處理一次（錯過的依窗口判定）
    setTimeout(() => void this.tick(), 3_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return 0;
    this.running = true;
    try {
      let total = 0;
      for (let round = 0; round < 10; round += 1) {
        const handled = await this.processDue();
        total += handled;
        if (handled < CLAIM_LIMIT) break;
      }
      if (total) this.invalidation?.emit([MEDIA_SCHEDULE_TAG], 'media_schedule_due');
      return total;
    } catch (error) {
      this.logger.error(`媒體排程到期處理失敗：${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** 領取一批到期排程並處理；回傳處理了幾筆 */
  async processDue(): Promise<number> {
    const now = this.now();
    return this.dataSource.transaction(async (manager) => {
      const due = await manager
        .getRepository(MediaPlaySchedule)
        .createQueryBuilder('s')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where("s.status = 'active' AND s.next_run_at IS NOT NULL AND s.next_run_at <= :now", { now })
        .orderBy('s.next_run_at', 'ASC')
        .addOrderBy('s.created_at', 'ASC')
        .addOrderBy('s.id', 'ASC')
        .limit(CLAIM_LIMIT)
        .getMany();
      for (const schedule of due) await this.handle(manager, schedule, now);
      return due.length;
    });
  }

  private async handle(manager: EntityManager, schedule: MediaPlaySchedule, now: number) {
    const dueAt = Number(schedule.nextRunAt);
    const timed = schedule.mode === 'timed' ? { startDate: schedule.startDate!, endDate: schedule.endDate, weekly: schedule.weekly ?? {}, timeZone: schedule.timeZone } : null;
    if (now - dueAt > DUE_GRACE_MS) {
      // 錯過（停機或處理延遲）：只記一筆錯過，連同期間被跳過的時點數，不補播
      const missedCount = timed ? countTimedOccurrences(timed, dueAt, now) : 1;
      await this.insertBatch(manager, schedule, dueAt, 'missed', { missed_count: missedCount, reason: `超過 ${DUE_GRACE_MS / 60_000} 分鐘容許窗口未處理，不補播`, detected_at: now });
    } else {
      await this.dispatch(manager, schedule, dueAt, now);
    }
    const next = timed ? nextTimedOccurrence(timed, Math.max(now, dueAt)) : null;
    await manager.update(MediaPlaySchedule, { id: schedule.id }, { nextRunAt: next === null ? null : String(next), status: next === null ? 'completed' : 'active' });
  }

  private async dispatch(manager: EntityManager, schedule: MediaPlaySchedule, dueAt: number, now: number) {
    // 執行前再檢查內容：任何一項無效就整批標示，不靜默跳過部分項目
    const items = await manager.find(MediaPlayScheduleItem, { where: { scheduleId: schedule.id }, order: { position: 'ASC' } });
    const media = items.length ? await manager.find(MediaLibraryItem, { where: { id: In(items.map((i) => i.mediaId)) } }) : [];
    const byId = new Map(media.map((m) => [m.id, m]));
    const content = items.map((item) => {
      const row = byId.get(item.mediaId);
      if (!row || row.kind !== MediaLibraryKind.MEDIA) return { media_id: item.mediaId, valid: false, reason: '媒體已不存在' };
      const body = row.body as MediaBody;
      const reason = mediaUnavailableReason(row);
      return {
        media_id: row.id,
        name: row.name,
        media_type: body.mediaType ?? null,
        // 當時內容的校驗資訊：檔案用上傳時的 sha256，文字另外算；檔案之後被替換也查得出差異
        sha256: body.file?.sha256 ?? (body.textContent ? createHash('sha256').update(body.textContent).digest('hex') : null),
        updated_at: row.updatedAt,
        valid: reason === null,
        reason: reason ? UNAVAILABLE_LABEL[reason] : null,
      };
    });
    const invalid = content.filter((c) => !c.valid);
    const targets = await this.targets(manager, schedule, now);
    const status = !items.length || invalid.length ? 'content_invalid' : targets.length === 0 ? 'no_targets' : 'awaiting_integration';
    const batchId = await this.insertBatch(manager, schedule, dueAt, status, {
      content,
      target_scope: schedule.targetScope,
      contract: PLAYBACK_CONTRACT_MISSING,
      processed_at: now,
    });
    if (!batchId) return;
    const contentReason = invalid.length ? `播放清單有 ${invalid.length} 項無效，整批不下發` : !items.length ? '播放清單是空的' : null;
    const rows = targets.map((target) => ({
      batchId,
      vehicleId: target.id,
      vehicleCode: target.vehicle_code,
      vehicleName: target.display_name,
      status: !target.active ? 'skipped_removed' : contentReason ? 'content_invalid' : !target.online ? 'skipped_offline' : 'not_delivered',
      reason: !target.active ? '載具已移除' : contentReason ?? (!target.online ? '到期時載具離線，不在上線後補播' : PLAYBACK_CONTRACT_MISSING),
      createdAt: String(now),
    }));
    if (rows.length) await manager.createQueryBuilder().insert().into(MediaPlayDelivery).values(rows).orIgnore().execute();
  }

  /** 到期當下固定的目標名單：全部載具＝此刻註冊中的載具；指定載具＝保存的那幾台（已移除的照實記錄） */
  private async targets(manager: EntityManager, schedule: MediaPlaySchedule, now: number) {
    const rows: Array<{ id: string; vehicle_code: string; display_name: string | null; is_active: boolean; fresh: string | null }> =
      schedule.targetScope === 'all'
        ? await manager.query(
            `SELECT v.id, v.vehicle_code, v.display_name, v.is_active, m.health_fresh_received_at AS fresh
               FROM vehicles v LEFT JOIN vehicle_monitor_demo m ON m.vehicle_code = v.vehicle_code
              WHERE v.is_active = true ORDER BY v.vehicle_code`,
          )
        : await manager.query(
            `SELECT v.id, v.vehicle_code, v.display_name, v.is_active, m.health_fresh_received_at AS fresh
               FROM vehicles v LEFT JOIN vehicle_monitor_demo m ON m.vehicle_code = v.vehicle_code
              WHERE v.id::text = ANY($1::text[]) ORDER BY v.vehicle_code`,
            [schedule.vehicleIds ?? []],
          );
    return rows.map((row) => ({
      id: row.id,
      vehicle_code: row.vehicle_code,
      display_name: row.display_name?.trim() || row.vehicle_code,
      active: row.is_active,
      online: row.fresh !== null && now - Number(row.fresh) <= ONLINE_WITHIN_MS,
    }));
  }

  /** 批次（排程, 排定時刻）唯一；已存在就不再建立，回傳 null */
  private async insertBatch(manager: EntityManager, schedule: MediaPlaySchedule, dueAt: number, status: string, detail: Record<string, unknown>) {
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(MediaPlayBatch)
      .values({ scheduleId: schedule.id, scheduledAt: String(dueAt), scheduleVersion: schedule.version, status, detail: detail as never, createdAt: String(this.now()) })
      .orIgnore()
      .returning(['id'])
      .execute();
    const row = result.raw?.[0] as { id?: string } | undefined;
    return row?.id ?? null;
  }
}
