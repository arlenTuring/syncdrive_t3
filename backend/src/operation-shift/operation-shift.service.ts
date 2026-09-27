import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  OperationShift,
  OperationShiftPublishStatus,
  OperationShiftUsageStatus,
} from '../database/entities/operation-shift.entity';
import {
  toOperationShiftListItem,
  UNTITLED_OPERATION_SHIFT_NAME,
  type OperationShiftListItem,
} from './operation-shift-list.util';
import {
  expandStationEtas,
  expandTimetableTrips,
  groupStationEtasIncludingMapAliases,
  parseTimeRangeQuery,
  type StationEtaEventDto,
  type TimetableTripDto,
} from './timetable/expand-timetable';
import { formatSecondToHms } from './timetable/clock';
import {
  loadMapDocumentForShift,
  resolveMapIdFromShiftBody,
} from './timetable/station-alias';

export type ListOperationShiftsQuery = {
  keyword?: string;
  usage_status?: 'all' | OperationShiftUsageStatus;
  publish_status?: 'all' | OperationShiftPublishStatus;
  page?: number;
  page_size?: number;
};

export type SaveOperationShiftDraftInput = {
  name: string;
  body?: Record<string, unknown>;
};

export type TimetableSourceMeta = {
  shift_id: string;
  name: string;
  publish_status: string;
  source: 'published' | 'draft_fallback';
  generated_at: string | null;
  updated_at: string;
  map_id: string | null;
};

@Injectable()
export class OperationShiftService {
  constructor(
    @InjectRepository(OperationShift)
    private readonly repo: Repository<OperationShift>,
  ) {}

  async listShifts(query: ListOperationShiftsQuery): Promise<{
    items: OperationShiftListItem[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 20));

    const qb = this.repo.createQueryBuilder('s');

    const keyword = String(query.keyword ?? '').trim();
    if (keyword) {
      qb.andWhere('(s.shift_id ILIKE :kw OR s.name ILIKE :kw)', { kw: `%${keyword}%` });
    }

    const usageStatus = query.usage_status;
    if (usageStatus && usageStatus !== 'all') {
      qb.andWhere('s.usage_status = :us', { us: usageStatus });
    }

    const publishStatus = query.publish_status;
    if (publishStatus && publishStatus !== 'all') {
      qb.andWhere('s.publish_status = :ps', { ps: publishStatus });
    }

    qb.orderBy('s.updated_at', 'DESC').addOrderBy('s.created_at', 'DESC');

    const total = await qb.getCount();
    const rows = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      items: rows.map(toOperationShiftListItem),
      total,
      page,
      page_size: pageSize,
    };
  }

  async getShiftById(id: string): Promise<OperationShift> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Operation shift '${id}' not found`);
    }
    return row;
  }

  async getShiftDetail(id: string): Promise<{
    shift_id: string;
    name: string;
    publish_status: string;
    usage_status: string;
    body: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }> {
    const row = await this.getShiftById(id);
    return {
      shift_id: row.id,
      name: row.name,
      publish_status: row.publishStatus,
      usage_status: row.usageStatus,
      body: row.body ?? {},
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }

  async isShiftNameUnique(name: string, excludeShiftId?: string): Promise<boolean> {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || trimmed === UNTITLED_OPERATION_SHIFT_NAME) return true;

    const qb = this.repo
      .createQueryBuilder('s')
      .where('LOWER(s.name) = LOWER(:name)', { name: trimmed });

    if (excludeShiftId) {
      qb.andWhere('s.shift_id != :excludeId', { excludeId: excludeShiftId });
    }

    const existing = await qb.getOne();
    return !existing;
  }

  async createDraft(input: SaveOperationShiftDraftInput): Promise<OperationShiftListItem> {
    const name = this.resolveDraftName(input.name);
    if (!(await this.isShiftNameUnique(name))) {
      throw new BadRequestException('此班表名稱已存在，請重新輸入');
    }

    const now = String(Date.now());
    const row = this.repo.create({
      id: this.generateShiftId(),
      name,
      publishStatus: OperationShiftPublishStatus.DRAFT,
      usageStatus: OperationShiftUsageStatus.IDLE,
      body: input.body ?? {},
      createdAt: now,
      updatedAt: now,
    });

    const saved = await this.repo.save(row);
    return toOperationShiftListItem(saved);
  }

  async updateDraft(id: string, input: SaveOperationShiftDraftInput): Promise<OperationShiftListItem> {
    const name = this.resolveDraftName(input.name);
    if (!(await this.isShiftNameUnique(name, id))) {
      throw new BadRequestException('此班表名稱已存在，請重新輸入');
    }

    const row = await this.getShiftById(id);
    row.name = name;
    row.body = input.body ?? {};
    row.updatedAt = String(Date.now());

    const saved = await this.repo.save(row);
    return toOperationShiftListItem(saved);
  }

  async duplicateAsNewDraft(id: string): Promise<OperationShiftListItem> {
    const source = await this.getShiftById(id);
    const baseName = source.name.trim() || UNTITLED_OPERATION_SHIFT_NAME;
    let candidate = `${baseName}（複製）`;
    let suffix = 2;
    while (!(await this.isShiftNameUnique(candidate))) {
      candidate = `${baseName}（複製 ${suffix}）`;
      suffix += 1;
    }

    const now = String(Date.now());
    const body = { ...(source.body ?? {}) };
    const row = this.repo.create({
      id: this.generateShiftId(),
      name: candidate,
      publishStatus: OperationShiftPublishStatus.DRAFT,
      usageStatus: OperationShiftUsageStatus.IDLE,
      body,
      createdAt: now,
      updatedAt: now,
    });

    const saved = await this.repo.save(row);
    return toOperationShiftListItem(saved);
  }

  /**
   * 參數生成班表 → 複製成手動製作草稿。
   * 不修改來源資料；新草稿 body.creationMode = 'manual'。
   */
  async duplicateAsManualDraft(id: string): Promise<OperationShiftListItem> {
    const source = await this.getShiftById(id);
    const sourceBody = source.body ?? {};
    if (sourceBody.creationMode === 'manual') {
      throw new BadRequestException('手動製作的班表無法再複製成手動製作');
    }

    const baseName = source.name.trim() || UNTITLED_OPERATION_SHIFT_NAME;
    let candidate = `${baseName}(手動)`;
    let suffix = 2;
    while (!(await this.isShiftNameUnique(candidate))) {
      candidate = `${baseName}(手動 ${suffix})`;
      suffix += 1;
    }

    const now = String(Date.now());
    const body: Record<string, unknown> = {
      ...(JSON.parse(JSON.stringify(sourceBody)) as Record<string, unknown>),
      creationMode: 'manual',
    };
    const row = this.repo.create({
      id: this.generateShiftId(),
      name: candidate,
      publishStatus: OperationShiftPublishStatus.DRAFT,
      usageStatus: OperationShiftUsageStatus.IDLE,
      body,
      createdAt: now,
      updatedAt: now,
    });

    const saved = await this.repo.save(row);
    return toOperationShiftListItem(saved);
  }

  async deleteShift(id: string): Promise<void> {
    const row = await this.getShiftById(id);
    if (row.usageStatus === OperationShiftUsageStatus.IN_USE) {
      throw new BadRequestException('使用中的班表無法刪除');
    }
    await this.repo.delete({ id });
  }

  /** 發布班表（供站顯／外部系統讀取 timetable） */
  async publishShift(id: string): Promise<OperationShiftListItem> {
    const row = await this.getShiftById(id);
    if (!this.bodyHasPlan(row.body ?? {})) {
      throw new BadRequestException('此班表尚無排班產出（scheduleOutput.plan），無法發布');
    }
    row.publishStatus = OperationShiftPublishStatus.PUBLISHED;
    row.updatedAt = String(Date.now());
    const saved = await this.repo.save(row);
    return toOperationShiftListItem(saved);
  }

  /** 部署為執行班表：此班表 in_use，其餘改 idle，並一併發布 */
  async deployShift(
    id: string,
    options?: { reviewerName?: string },
  ): Promise<OperationShiftListItem> {
    const row = await this.getShiftById(id);
    if (!this.bodyHasPlan(row.body ?? {})) {
      throw new BadRequestException('此班表尚無排班產出（scheduleOutput.plan），無法部署');
    }

    const now = String(Date.now());
    await this.repo
      .createQueryBuilder()
      .update(OperationShift)
      .set({
        usageStatus: OperationShiftUsageStatus.IDLE,
        updatedAt: now,
      })
      .where('usage_status = :us', { us: OperationShiftUsageStatus.IN_USE })
      .andWhere('shift_id != :id', { id })
      .execute();

    const reviewer = String(options?.reviewerName ?? '').trim();
    row.usageStatus = OperationShiftUsageStatus.IN_USE;
    row.publishStatus = OperationShiftPublishStatus.PUBLISHED;
    row.body = {
      ...(row.body ?? {}),
      deployment: {
        deployedAt: Number(now),
        deployedBy: reviewer || null,
      },
    };
    row.updatedAt = now;
    const saved = await this.repo.save(row);
    return toOperationShiftListItem(saved);
  }

  async getTimetableTrips(query: {
    from?: string;
    to?: string;
  }): Promise<{
    meta: TimetableSourceMeta;
    filter: { from: string; to: string; from_second: number; to_second: number };
    trip_count: number;
    trips: TimetableTripDto[];
  }> {
    const { row, source } = await this.resolveTimetableShift();
    const range = parseTimeRangeQuery({ from: query.from, to: query.to });
    const body = row.body ?? {};
    const trips = expandTimetableTrips({ body, range, passengerOnly: false });
    return {
      meta: this.toTimetableMeta(row, source),
      filter: {
        from: formatSecondToHms(range.fromSecond),
        to: formatSecondToHms(range.toSecond),
        from_second: range.fromSecond,
        to_second: range.toSecond,
      },
      trip_count: trips.length,
      trips,
    };
  }

  /**
   * 取<strong>目前部署中</strong>的班表並展開成班次。
   *
   * 與 {@link getTimetableTrips} 的差別是解析對象：那一支給對外查詢用，讀的是
   * 「最新已發布」；這一支給即時調度用，讀的是 <code>usage_status = in_use</code>
   * ——也就是使用者按下「部署」的那一份。兩者通常是同一份，但不保證：可以先發布
   * 新版本供對外預覽，稍後才部署。<strong>下訂單一定要照部署中的那份</strong>，
   * 否則車輛會去執行還沒上線的班表。
   *
   * 展開走的是同一支 {@link expandTimetableTrips}，所以調度下的訂單時刻與對外
   * 介面查到的計畫時刻必然一致——不會出現「API 說 09:00 發車、車卻 09:02 動」。
   */
  async getDeployedTrips(): Promise<{
    shiftId: string;
    shiftName: string;
    trips: TimetableTripDto[];
    /** 原始計畫內容。空車移動卡的起訖點只存在這裡，班次展開結果不含。 */
    body: Record<string, unknown>;
  } | null> {
    const deployed = await this.getDeployedShift();
    if (!deployed) return null;

    const range = parseTimeRangeQuery({});
    return {
      ...deployed,
      trips: expandTimetableTrips({
        body: deployed.body,
        range,
        passengerOnly: false,
      }),
    };
  }

  /**
   * 部署中的那一份班表（不展開班次）。只要設定內容的地方（例如整備分佈要知道
   * 有哪些整備區塊、各用哪些格位）用這一支，不必為了讀設定展開整天的班次。
   */
  async getDeployedShift(): Promise<{
    shiftId: string;
    shiftName: string;
    body: Record<string, unknown>;
  } | null> {
    const rows = await this.repo.find({
      where: { usageStatus: OperationShiftUsageStatus.IN_USE },
      order: { updatedAt: 'DESC' },
      take: 5,
    });
    const deployed = rows.find((row) => this.bodyHasPlan(row.body ?? {}));
    if (!deployed) return null;
    return { shiftId: deployed.id, shiftName: deployed.name, body: deployed.body ?? {} };
  }

  async getStationEtas(query: {
    from?: string;
    to?: string;
    station_id?: string;
  }): Promise<{
    meta: TimetableSourceMeta;
    filter: {
      from: string;
      to: string;
      from_second: number;
      to_second: number;
      station_id: string | null;
      passenger_stops_only: boolean;
    };
    eta_count: number;
    etas: StationEtaEventDto[];
    stations: Array<{
      station_id: string;
      station_alias: string;
      station_name: string;
      eta_count: number;
      etas: StationEtaEventDto[];
    }>;
  }> {
    const { row, source } = await this.resolveTimetableShift();
    const range = parseTimeRangeQuery({ from: query.from, to: query.to });
    const body = row.body ?? {};
    const etas = expandStationEtas({
      body,
      range,
      stationId: query.station_id,
      passengerStopsOnly: true,
    });
    const { mapDocument } = loadMapDocumentForShift(body);
    return {
      meta: this.toTimetableMeta(row, source),
      filter: {
        from: formatSecondToHms(range.fromSecond),
        to: formatSecondToHms(range.toSecond),
        from_second: range.fromSecond,
        to_second: range.toSecond,
        station_id: query.station_id?.trim() || null,
        passenger_stops_only: true,
      },
      eta_count: etas.length,
      etas,
      /** 地圖全部停靠點別名（含 0 筆）；另含班表有、地圖無的站 */
      stations: groupStationEtasIncludingMapAliases({
        etas,
        mapDocument,
        stationId: query.station_id,
      }),
    };
  }

  private async resolveTimetableShift(): Promise<{
    row: OperationShift;
    source: 'published' | 'draft_fallback';
  }> {
    const published = await this.repo.find({
      where: { publishStatus: OperationShiftPublishStatus.PUBLISHED },
      order: { updatedAt: 'DESC' },
      take: 20,
    });
    const publishedWithPlan = published.find((row) => this.bodyHasPlan(row.body ?? {}));
    if (publishedWithPlan) {
      return { row: publishedWithPlan, source: 'published' };
    }

    const drafts = await this.repo.find({
      order: { updatedAt: 'DESC' },
      take: 40,
    });
    const draftWithPlan = drafts.find((row) => this.bodyHasPlan(row.body ?? {}));
    if (draftWithPlan) {
      return { row: draftWithPlan, source: 'draft_fallback' };
    }

    throw new NotFoundException(
      '找不到可讀取的班表：請先產生排班並儲存，或 POST …/detail/:id/publish 發布',
    );
  }

  private bodyHasPlan(body: Record<string, unknown>): boolean {
    const output = body.scheduleOutput;
    if (!output || typeof output !== 'object' || Array.isArray(output)) return false;
    const plan = (output as Record<string, unknown>).plan;
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return false;
    const timelines = (plan as Record<string, unknown>).timelines;
    return Array.isArray(timelines) && timelines.length > 0;
  }

  private toTimetableMeta(
    row: OperationShift,
    source: 'published' | 'draft_fallback',
  ): TimetableSourceMeta {
    const body = row.body ?? {};
    const output = body.scheduleOutput;
    let generatedAt: string | null = null;
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      const ga = (output as Record<string, unknown>).generatedAt;
      if (typeof ga === 'string') generatedAt = ga;
      const plan = (output as Record<string, unknown>).plan;
      if (!generatedAt && plan && typeof plan === 'object' && !Array.isArray(plan)) {
        const pga = (plan as Record<string, unknown>).generatedAt;
        if (typeof pga === 'string') generatedAt = pga;
      }
    }
    return {
      shift_id: row.id,
      name: row.name,
      publish_status: row.publishStatus,
      source,
      generated_at: generatedAt,
      updated_at: row.updatedAt,
      map_id: resolveMapIdFromShiftBody(body),
    };
  }

  private generateShiftId(): string {
    const suffix = Date.now().toString(36).toUpperCase().slice(-8);
    return `OS-DRAFT-${suffix}`;
  }

  private resolveDraftName(name: string | undefined): string {
    const trimmed = String(name ?? '').trim();
    return trimmed || UNTITLED_OPERATION_SHIFT_NAME;
  }
}
