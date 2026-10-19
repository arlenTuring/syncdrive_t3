import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUser } from '../access-control/auth.service';
import { redact } from '../audit/audit-catalog';
import { AuditService } from '../audit/audit.service';
import { ActionResult } from '../database/entities/operator-action-log.entity';
import { EventCode, Severity } from '../database/entities/security-event-log.entity';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import { SystemFoundationSettingsService } from '../system-health/system-foundation-settings.service';
import { toCsv, formatInZone, type CsvColumn } from './csv';
import { DEFAULT_TIME_ZONE, EVENT_PAGE_SIZE, EXPORT_LIMIT, REPLAY_AFTER_MS, REPLAY_BEFORE_MS } from './event-log.constants';
import { boolParam, enumParam, pageParams, rangeParams, rejectUnknown, textParam } from './query-params';

export const EVENT_SORTS = ['occurred_at', 'received_at', 'event_code', 'vehicle_code', 'severity'] as const;
const SORT_SQL: Record<(typeof EVENT_SORTS)[number], string> = {
  occurred_at: 'e.created_at',
  received_at: 'e.received_at',
  event_code: 'e.event_code',
  vehicle_code: 'e.vehicle_code',
  severity: 'e.severity',
};
const SOURCE_TYPES = ['VEHICLE', 'FACILITY', 'SYSTEM'] as const;
const QUERY_KEYS = ['from', 'to', 'vehicleCode', 'eventCode', 'severity', 'sourceType', 'acknowledged', 'page', 'pageSize', 'sortBy', 'direction', 'snapshot'];

export const EVENT_CODE_LABEL: Record<string, string> = {
  UNSCHEDULED_DOOR_OPEN: '非預期開門',
  OBSTACLE_DETECTED: '偵測到障礙物',
  PATH_BLOCKED: '路徑受阻',
  DIRECTION_VIOLATION: '行向偏離',
  INTERLOCK_REQ: '路口聯鎖請求',
  SYSTEM_HEALTH_DEGRADED: '車載系統健康度下降',
};
export const SEVERITY_LABEL: Record<string, string> = { INFO: '資訊', WARNING: '警告', CRITICAL: '嚴重' };
export const SOURCE_TYPE_LABEL: Record<string, string> = { VEHICLE: '載具', FACILITY: '設施', SYSTEM: '系統' };

export type EventFilters = {
  from: number;
  to: number;
  vehicleCode?: string;
  eventCode?: string;
  severity?: string;
  sourceType?: string;
  acknowledged?: boolean;
  sortBy: (typeof EVENT_SORTS)[number];
  direction: 'asc' | 'desc';
  snapshot?: string;
};

type EventRow = {
  id: string;
  event_id: string;
  source_type: string;
  source_id: string | null;
  source_name_snapshot: string | null;
  origin: string;
  vehicle_code: string | null;
  event_code: string;
  severity: string;
  created_at: string;
  occurred_at_valid: boolean | null;
  received_at: string | null;
  display_message: string | null;
  detail: string | null;
  is_acknowledged: boolean;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
};

const LIST_COLUMNS = `e.id::text AS id, e.event_id, e.source_type, e.source_id, e.source_name_snapshot, e.origin, e.vehicle_code,
  e.event_code::text AS event_code, e.severity::text AS severity, e.created_at, e.occurred_at_valid, e.received_at,
  e.display_message, e.detail, e.is_acknowledged, e.acknowledged_at, e.acknowledged_by_name`;

/**
 * 事件資訊清單／歷史事件／事件報表共用的查詢。資料真相只有 security_event_logs。
 *
 * - 清單與 CSV 用同一個條件建構器；排序以主鍵打破平手（同時刻不重複、不漏列）。
 * - snapshot（查詢上界 ID）讓翻頁與匯出期間新進的事件不插隊。
 * - 人工確認只改中心端閱覽狀態：不下發車控、不清除故障、不解除降級，也不代表設備恢復。
 */
@Injectable()
export class EventsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @Optional() private readonly settings?: SystemFoundationSettingsService,
    @Optional() private readonly invalidation?: DatasourceInvalidationService,
  ) {}

  async timeZone() {
    try {
      return (await this.settings?.get())?.locale?.timeZone || DEFAULT_TIME_ZONE;
    } catch {
      return DEFAULT_TIME_ZONE;
    }
  }

  parseFilters(query: Record<string, unknown>): EventFilters & { page: number; pageSize: number } {
    rejectUnknown(query, QUERY_KEYS);
    const { from, to } = rangeParams(query.from, query.to);
    const vehicleCode = textParam(query.vehicleCode, '載具', 64);
    const snapshot = textParam(query.snapshot, '查詢上界', 20);
    if (snapshot && !/^\d+$/.test(snapshot)) throw new BadRequestException('查詢上界不正確');
    return {
      from,
      to,
      vehicleCode,
      eventCode: enumParam(query.eventCode, Object.values(EventCode), '事件類型'),
      severity: enumParam(query.severity, Object.values(Severity), '嚴重度'),
      sourceType: enumParam(query.sourceType, SOURCE_TYPES, '來源'),
      acknowledged: boolParam(query.acknowledged, '確認狀態'),
      sortBy: enumParam(query.sortBy, EVENT_SORTS, '排序欄位') ?? 'occurred_at',
      direction: enumParam(query.direction, ['asc', 'desc'] as const, '排序方向') ?? 'desc',
      snapshot,
      ...pageParams(query.page, query.pageSize, EVENT_PAGE_SIZE),
    };
  }

  private where(filters: EventFilters, snapshotId: string | null) {
    const clauses = ['e.created_at >= $1', 'e.created_at < $2'];
    const params: unknown[] = [filters.from, filters.to];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      clauses.push(sql.replace('?', `$${params.length}`));
    };
    if (snapshotId) add('e.id <= ?::bigint', snapshotId);
    if (filters.vehicleCode) add('upper(e.vehicle_code) = upper(?)', filters.vehicleCode);
    if (filters.eventCode) add('e.event_code::text = ?', filters.eventCode);
    if (filters.severity) add('e.severity::text = ?', filters.severity);
    if (filters.sourceType) add('e.source_type = ?', filters.sourceType);
    if (filters.acknowledged !== undefined) add('e.is_acknowledged = ?', filters.acknowledged);
    return { sql: clauses.join(' AND '), params };
  }

  private orderBy(filters: EventFilters) {
    const dir = filters.direction === 'asc' ? 'ASC' : 'DESC';
    return `${SORT_SQL[filters.sortBy]} ${dir} NULLS LAST, e.id ${dir}`;
  }

  private async snapshotId(filters: EventFilters) {
    if (filters.snapshot) return filters.snapshot;
    const [row] = await this.dataSource.query(`SELECT COALESCE(max(id), 0)::text AS id FROM security_event_logs`);
    return row.id as string;
  }

  async list(query: Record<string, unknown>) {
    const filters = this.parseFilters(query);
    const snapshot = await this.snapshotId(filters);
    const where = this.where(filters, snapshot);
    const offset = (filters.page - 1) * filters.pageSize;
    const [rows, [{ total }]] = await Promise.all([
      this.dataSource.query(
        `SELECT ${LIST_COLUMNS} FROM security_event_logs e WHERE ${where.sql} ORDER BY ${this.orderBy(filters)} LIMIT ${filters.pageSize} OFFSET ${offset}`,
        where.params,
      ) as Promise<EventRow[]>,
      this.dataSource.query(`SELECT count(*)::int AS total FROM security_event_logs e WHERE ${where.sql}`, where.params),
    ]);
    return {
      items: rows.map((row) => this.present(row)),
      total: Number(total),
      page: filters.page,
      pageSize: filters.pageSize,
      snapshot,
      range: { from: filters.from, to: filters.to },
      timeZone: await this.timeZone(),
    };
  }

  private present(row: EventRow) {
    return {
      id: row.id,
      eventId: row.event_id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceName: row.source_name_snapshot,
      origin: row.origin,
      vehicleCode: row.vehicle_code,
      eventCode: row.event_code,
      eventLabel: EVENT_CODE_LABEL[row.event_code] ?? row.event_code,
      severity: row.severity,
      occurredAt: Number(row.created_at),
      // null＝舊資料（未知）；false＝來源沒給時間，以接收時間代替
      occurredAtValid: row.occurred_at_valid,
      receivedAt: row.received_at === null ? null : Number(row.received_at),
      summary: row.display_message || row.detail || '',
      acknowledged: row.is_acknowledged,
      acknowledgedAt: row.acknowledged_at === null ? null : Number(row.acknowledged_at),
      acknowledgedByName: row.acknowledged_by_name,
      // 設備恢復狀態只接受有契約的真實來源；目前沒有，一律未知
      recoveryStatus: 'UNKNOWN' as const,
    };
  }

  private parseId(id: string) {
    if (!/^\d{1,19}$/.test(id)) throw new NotFoundException('找不到事件');
    return id;
  }

  async detail(id: string) {
    const [row] = await this.dataSource.query(
      `SELECT ${LIST_COLUMNS}, e.location, e.params, e.acknowledged_by, e.acknowledgement_note, e.category_label, e.sub_label
         FROM security_event_logs e WHERE e.id = $1::bigint`,
      [this.parseId(id)],
    );
    if (!row) throw new NotFoundException('找不到事件（可能已依保存政策移除）');
    const trail = await this.dataSource.query(
      `SELECT id::text, action_type, operator_id, operator_name_snapshot, source_ip, result, failure_reason, action_detail, created_at
         FROM operator_action_logs WHERE target_type = 'EVENT' AND target_id = $1 ORDER BY created_at ASC, id ASC LIMIT 50`,
      [id],
    );
    return {
      ...this.present(row),
      location: redact(row.location),
      params: redact(row.params),
      detail: row.detail,
      acknowledgementNote: row.acknowledgement_note,
      trail: trail.map((t: Record<string, unknown>) => ({
        id: t.id,
        action: t.action_type,
        operatorName: t.operator_name_snapshot ?? null,
        sourceIp: t.source_ip,
        result: t.result,
        failureReason: t.failure_reason,
        note: (t.action_detail as { note?: string } | null)?.note ?? null,
        at: Number(t.created_at),
      })),
    };
  }

  /**
   * 人工確認：條件更新（只更新尚未確認的列），同一交易寫操作稽核。
   * 兩人同時確認時只有先到者成功；後到者拿到目前狀態與 alreadyAcknowledged=true，不偽造第二次成功。
   */
  async acknowledge(id: string, noteRaw: unknown, actor: AuthUser, client: { ip?: string; userAgent?: string | null }) {
    if (noteRaw !== undefined && noteRaw !== null && typeof noteRaw !== 'string') throw new BadRequestException('備註格式不正確');
    const note = typeof noteRaw === 'string' ? noteRaw.trim() : '';
    if (note.length > 500) throw new BadRequestException('備註最多 500 字');
    const eventId = this.parseId(id);
    const updated = await this.dataSource.transaction(async (manager) => {
      const rows: Array<{ id: string }> = await manager.query(
        `UPDATE security_event_logs
            SET is_acknowledged = true, acknowledged_by = $2, acknowledged_by_name = $3, acknowledged_at = $4, acknowledgement_note = $5
          WHERE id = $1::bigint AND is_acknowledged = false
          RETURNING id::text`,
        [eventId, actor.id, actor.display_name, Date.now(), note || null],
      );
      const changed = (Array.isArray(rows[0]) ? rows[0] : rows).length > 0;
      if (!changed) {
        const [exists] = await manager.query(`SELECT 1 FROM security_event_logs WHERE id = $1::bigint`, [eventId]);
        if (!exists) throw new NotFoundException('找不到事件');
        return false;
      }
      await this.audit.record(
        {
          operatorId: actor.id,
          operatorName: actor.display_name,
          sourceIp: client.ip,
          userAgent: client.userAgent ?? null,
          actionType: 'EVENT_ACKNOWLEDGE',
          targetType: 'EVENT',
          targetId: eventId,
          actionDetail: note ? { note } : {},
          result: ActionResult.SUCCESS,
          correlationId: eventId,
        },
        manager,
      );
      return true;
    });
    if (updated) this.invalidation?.emitEventCenter();
    return { ...(await this.detail(eventId)), alreadyAcknowledged: !updated };
  }

  /** 事件回放時間窗（事件前 30 秒到後 30 秒）與目標載具；軌跡由運行紀錄回放 API 取得 */
  async playback(id: string) {
    const event = await this.detail(id);
    const vehicle = event.vehicleCode
      ? ((await this.dataSource.query(
          `SELECT id::text, vehicle_code, display_name, is_active FROM vehicles WHERE upper(vehicle_code) = upper($1) ORDER BY is_active DESC, updated_at DESC NULLS LAST LIMIT 1`,
          [event.vehicleCode],
        )) as Array<{ id: string; vehicle_code: string; display_name: string | null; is_active: boolean }>)[0] ?? null
      : null;
    return {
      event: { id: event.id, eventCode: event.eventCode, eventLabel: event.eventLabel, occurredAt: event.occurredAt, occurredAtValid: event.occurredAtValid, vehicleCode: event.vehicleCode },
      window: { from: event.occurredAt - REPLAY_BEFORE_MS, to: event.occurredAt + REPLAY_AFTER_MS, beforeMs: REPLAY_BEFORE_MS, afterMs: REPLAY_AFTER_MS },
      // 沒有車號（設施／系統事件）不顯示載具軌跡；車輛已刪除時仍回車號，由回放 API 判斷有無資料
      vehicle: vehicle
        ? { id: vehicle.id, vehicleCode: vehicle.vehicle_code, displayName: vehicle.display_name?.trim() || vehicle.vehicle_code, active: vehicle.is_active }
        : null,
      trajectoryAvailable: Boolean(event.vehicleCode),
      timeZone: await this.timeZone(),
    };
  }

  /** CSV：同一條件與排序，固定查詢上界，最多 1,000 筆；總數另外回傳給畫面顯示截斷提示 */
  async exportCsv(query: Record<string, unknown>) {
    const filters = this.parseFilters({ ...query, page: undefined, pageSize: undefined });
    const snapshot = await this.snapshotId(filters);
    const where = this.where(filters, snapshot);
    const [rows, [{ total }]] = await Promise.all([
      this.dataSource.query(
        `SELECT ${LIST_COLUMNS}, e.location FROM security_event_logs e WHERE ${where.sql} ORDER BY ${this.orderBy(filters)} LIMIT ${EXPORT_LIMIT}`,
        where.params,
      ) as Promise<Array<EventRow & { location: unknown }>>,
      this.dataSource.query(`SELECT count(*)::int AS total FROM security_event_logs e WHERE ${where.sql}`, where.params),
    ]);
    const tz = await this.timeZone();
    const columns: CsvColumn<EventRow & { location: unknown }>[] = [
      { header: '中心端事件ID', value: (r) => r.id, raw: true },
      { header: '來源事件ID', value: (r) => r.event_id, raw: true },
      { header: `發生時間（${tz}）`, value: (r) => formatInZone(Number(r.created_at), tz) },
      { header: '發生時間有效', value: (r) => (r.occurred_at_valid === null ? '未知' : r.occurred_at_valid ? '是' : '否（以接收時間代替）') },
      { header: `接收時間（${tz}）`, value: (r) => formatInZone(r.received_at === null ? null : Number(r.received_at), tz) },
      { header: '發生時間epoch毫秒', value: (r) => r.created_at, raw: true },
      { header: '來源類型', value: (r) => SOURCE_TYPE_LABEL[r.source_type] ?? r.source_type },
      { header: '來源ID', value: (r) => r.source_id, raw: true },
      { header: '來源名稱（當時）', value: (r) => r.source_name_snapshot },
      { header: '載具ID', value: (r) => r.vehicle_code ?? '不適用', raw: true },
      { header: '事件類型代碼', value: (r) => r.event_code, raw: true },
      { header: '事件類型', value: (r) => EVENT_CODE_LABEL[r.event_code] ?? r.event_code },
      { header: '嚴重度', value: (r) => SEVERITY_LABEL[r.severity] ?? r.severity },
      { header: '人工確認', value: (r) => (r.is_acknowledged ? '已確認' : '未確認') },
      { header: '確認人', value: (r) => r.acknowledged_by_name },
      { header: `確認時間（${tz}）`, value: (r) => formatInZone(r.acknowledged_at === null ? null : Number(r.acknowledged_at), tz) },
      { header: '設備恢復狀態', value: () => '未知' },
      { header: '摘要', value: (r) => r.display_message || r.detail },
      { header: '位置', value: (r) => r.location },
    ];
    return {
      csv: toCsv(rows, columns),
      total: Number(total),
      exported: rows.length,
      snapshot,
      timeZone: tz,
      sort: `${filters.sortBy} ${filters.direction}, id ${filters.direction}`,
    };
  }

  /** 篩選選項：歷史出現過的載具（含已刪除車輛）與事件類型 */
  async options() {
    const vehicles = await this.dataSource.query(
      `SELECT x.code AS vehicle_code, v.display_name, COALESCE(v.is_active, false) AS active
         FROM (SELECT DISTINCT vehicle_code AS code FROM security_event_logs WHERE vehicle_code IS NOT NULL
               UNION SELECT vehicle_code FROM vehicles) x
         LEFT JOIN LATERAL (SELECT display_name, is_active FROM vehicles WHERE upper(vehicle_code) = upper(x.code) ORDER BY is_active DESC LIMIT 1) v ON true
        ORDER BY x.code`,
    );
    return {
      vehicles: vehicles.map((v: { vehicle_code: string; display_name: string | null; active: boolean }) => ({
        vehicleCode: v.vehicle_code,
        displayName: v.display_name?.trim() || v.vehicle_code,
        active: v.active,
      })),
      eventCodes: Object.values(EventCode).map((code) => ({ value: code, label: EVENT_CODE_LABEL[code] ?? code })),
      severities: Object.values(Severity).map((value) => ({ value, label: SEVERITY_LABEL[value] })),
      sourceTypes: SOURCE_TYPES.map((value) => ({ value, label: SOURCE_TYPE_LABEL[value] })),
      timeZone: await this.timeZone(),
      pageSize: EVENT_PAGE_SIZE,
      exportLimit: EXPORT_LIMIT,
    };
  }
}
