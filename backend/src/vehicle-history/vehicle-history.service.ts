import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { REPLAY_STALE_AFTER_MS } from '../degraded-replay/degraded-replay.recorder';
import { MAX_SEQ, parseEpochMs, parseSeq, parseZonedDateTime } from './history-cursor';
import { HEALTH_KEEPALIVE_MS } from './vehicle-history.recorder';

/** 一次查詢最長的時間區間 */
export const MAX_RANGE_MS = 12 * 60 * 60_000;
/** 一次最多回傳幾筆（分段載入） */
export const MAX_FRAMES_PER_REQUEST = 4_000;
/** 一次要求資料的最長時間跨度（後端再依筆數截斷） */
export const MAX_FRAMES_WINDOW_MS = 30 * 60_000;
/** 起點快照往回找多久：車輛串流超過這麼久沒有資料就不算在場 */
const SNAPSHOT_LOOKBACK_MS = 6 * 60 * 60_000;
/** 訂單、站點動作只在變更時才有紀錄，往回找久一點 */
const ORDER_LOOKBACK_MS = 48 * 60 * 60_000;
/** 地圖、模型、營運時鐘參照只在變更時記錄，不限往回距離 */
const UNBOUNDED_STREAMS = new Set(['map', 'model', 'clock']);
const ORDER_STREAMS = new Set(['order', 'order_action']);
/** 調查載具自己的狀態來源（鍵＝串流|車號） */
const VEHICLE_OWN_STREAMS = ['telemetry', 'operation', 'health', 'event', 'command_ack'];
/** 逐幀序列：調查載具自己的紀錄，加上紀錄當時歸屬它的訂單與站點動作變更；系統參照與設施不算 */
const VEHICLE_STREAMS = [...VEHICLE_OWN_STREAMS, 'order', 'order_action', 'order_route'];
const VEHICLE_CACHE_MS = 30_000;
const FRAME_COLUMNS =
  'seq, stream, stream_key, vehicle_code, topic, order_id, received_at, operating_at, clock_run, vehicle_ts, source, payload, derived';

export type HistoryScope = 'vehicle' | 'background';

export type InvestigatedVehicle = {
  id: string;
  vehicle_code: string;
  display_name: string;
  is_active: boolean;
};

function toInvestigated(row: { id: string; vehicle_code: string; display_name: string | null; is_active: boolean }): InvestigatedVehicle {
  return {
    id: row.id,
    vehicle_code: row.vehicle_code,
    display_name: row.display_name?.trim() || row.vehicle_code,
    is_active: row.is_active,
  };
}

function parseScope(raw: unknown): HistoryScope {
  if (raw === undefined || raw === '' || raw === 'vehicle') return 'vehicle';
  if (raw === 'background') return 'background';
  throw new BadRequestException('scope 必須是 vehicle 或 background');
}

/**
 * 範圍條件（SQL）：vehicle＝調查載具自己的紀錄（＋快照用的系統參照由呼叫端以鍵限定）；
 * background＝不是調查載具的一切。codeParam 是車號的參數位置。
 */
function scopeClause(codeParam: string, scope: HistoryScope, forSnapshot = false): string {
  if (scope === 'background') return `vehicle_code IS DISTINCT FROM ${codeParam}`;
  const own = `(vehicle_code = ${codeParam} AND stream IN (${VEHICLE_STREAMS.map((stream) => `'${stream}'`).join(',')}))`;
  // 逐幀序列只有車自己的紀錄；起點快照另外帶地圖、模型、營運時鐘參照當基準
  return forSnapshot ? `(${own} OR stream IN ('map','model','clock'))` : own;
}

export type HistoryFrameRow = {
  seq: string;
  stream: string;
  stream_key: string;
  vehicle_code: string | null;
  topic: string | null;
  order_id: string | null;
  received_at: string;
  operating_at: string | null;
  clock_run: string | null;
  vehicle_ts: string | null;
  source: string;
  payload: Record<string, unknown>;
  derived: Record<string, unknown> | null;
};

export type CoverageGap = {
  from_real: number;
  to_real: number;
  from_operating: number | null;
  to_operating: number | null;
  reason: 'not_recorded' | 'write_failed' | 'backpressure' | 'backend_restart';
  count?: number;
  detail?: string | null;
};

export type Coverage = {
  /** none：整段都沒有錄製；partial：有缺段或未錄製的部分；complete：整段都有錄製且沒有缺段 */
  state: 'none' | 'partial' | 'complete';
  recorded: Array<{ from_real: number; to_real: number }>;
  gaps: CoverageGap[];
  health_keepalive_ms: number;
};

/**
 * 運行管理紀錄的歷史查詢。只讀：不碰營運時鐘、不寫訂單、不送 MQTT、不注入即時資料。
 * 時間軸是後端收到資料的實際時間（received_at），同一毫秒依 seq。
 */
@Injectable()
export class VehicleHistoryService {
  private readonly vehicleCache = new Map<string, { vehicle: InvestigatedVehicle; until: number }>();

  constructor(private readonly dataSource: DataSource) {}

  /** 時間區間 → 可回放範圍、錄製涵蓋、範圍內出現過的車輛與營運時鐘 */
  async resolveRange(input: { vehicle_id?: unknown; from?: unknown; to?: unknown; tz?: unknown }) {
    const vehicle = await this.requireVehicle(input.vehicle_id);
    const from = parseZonedDateTime(input.from, 'from');
    const to = parseZonedDateTime(input.to, 'to');
    if (to <= from) throw new BadRequestException('結束時間必須晚於開始時間');
    if (to - from > MAX_RANGE_MS)
      throw new BadRequestException(`一次最多查 ${MAX_RANGE_MS / 3_600_000} 小時；請縮短區間`);
    const now = Date.now();
    if (from > now) throw new BadRequestException('開始時間在未來，沒有歷史資料');
    const clampedTo = Math.min(to, now);
    const window = { from_real: from, to_real: clampedTo, requested_to_real: to, ongoing: to > now };
    return {
      mode: 'range' as const,
      vehicle,
      vehicle_records: await this.vehicleRecords(vehicle, from, clampedTo),
      timezone: typeof input.tz === 'string' && input.tz ? input.tz : 'Asia/Taipei',
      window,
      coverage: await this.coverage(from, clampedTo),
      vehicles: await this.vehiclesIn(from, clampedTo),
      clock_runs: await this.clockRunsIn(from, clampedTo),
      stale_after_ms: REPLAY_STALE_AFTER_MS,
      max_frames_per_request: MAX_FRAMES_PER_REQUEST,
    };
  }

  /**
   * 班次唯一碼 → 那一次執行的實際範圍。
   *
   * 唯一碼＝訂單號＠訂單建立時刻（operation_orders.created_at）。訂單號在資料重置後可能被
   * 重新使用，加上建立時刻才能無歧義對到「那一次」；不用目前的班表找看起來相同的班次。
   */
  async resolveShift(rawCode: unknown, rawVehicleId?: unknown) {
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';
    if (!code) throw new BadRequestException('請輸入班次唯一碼');
    const match = /^(.+)@(\d{10,16})$/.exec(code);
    const orderId = (match ? match[1] : code).trim();
    const createdAt = match ? match[2] : null;
    if (orderId.length > 120) throw new BadRequestException('班次唯一碼格式不正確');

    const instances = await this.orderInstances(orderId);
    const candidates = createdAt ? instances.filter((item) => item.created_at === createdAt) : instances;
    if (candidates.length === 0)
      return { mode: 'shift' as const, code, state: 'not_found' as const, state_label: '查無此班次', candidates: [] };
    if (candidates.length > 1)
      return {
        mode: 'shift' as const,
        code,
        state: 'ambiguous' as const,
        state_label: '這個訂單號對應到多次執行，請改用完整的班次唯一碼',
        candidates: candidates.map((item) => ({ code: `${item.order_id}@${item.created_at}`, trip_code: item.trip_code, vehicle_code: item.vehicle_code, status: item.status })),
      };
    const order = candidates[0];
    const exactCode = `${order.order_id}@${order.created_at}`;
    const base = {
      mode: 'shift' as const,
      code: exactCode,
      order_id: order.order_id,
      created_at: Number(order.created_at),
      trip_code: order.trip_code,
      vehicle_code: order.vehicle_code,
      operating_day: order.operating_day,
      plan_run_id: order.plan_run_id,
      status: order.status,
      record_source: order.from_history ? 'history' : 'orders',
      stale_after_ms: REPLAY_STALE_AFTER_MS,
      max_frames_per_request: MAX_FRAMES_PER_REQUEST,
    };
    if (order.status === 'PENDING')
      return { ...base, state: 'not_started' as const, state_label: '尚未執行：沒有實際開始時間，不以計畫時間假造軌跡', window: null, coverage: null, range_basis: null };

    const range = await this.executionRange(order);
    if (!range)
      return { ...base, state: 'no_history' as const, state_label: '無歷史資料：沒有這次執行的開始紀錄，也沒有錄到它的資料', window: null, coverage: null, range_basis: null };
    /*
     * 這次執行實際涉及的車：期間內這張單的營運回報、訂單與站點動作變更當時記錄的車，加上訂單上的車。
     * 不看目前班表或同名班次。不只一台時要使用者明確選，不自動挑第一台。
     */
    const involved = await this.executionVehicles(order, range);
    const requestedId = typeof rawVehicleId === 'string' && rawVehicleId.trim() ? rawVehicleId.trim() : null;
    let vehicle: InvestigatedVehicle | null = null;
    if (requestedId) {
      const requested = await this.requireVehicle(requestedId);
      if (!involved.some((item) => item.vehicle_code === requested.vehicle_code))
        throw new BadRequestException('指定的載具沒有參與這次執行');
      vehicle = requested;
    } else if (involved.length === 1) {
      vehicle = involved[0].vehicle;
    }
    if (involved.length === 0 || involved.every((item) => !item.vehicle))
      return { ...base, state: 'no_vehicle' as const, state_label: '找不到這次執行對應的已註冊載具，無法固定調查對象', window: null, coverage: null, range_basis: range.basis, vehicle: null, vehicle_candidates: [] };
    if (!vehicle)
      return {
        ...base,
        state: 'multi_vehicle' as const,
        state_label: `這次執行涉及 ${involved.length} 台載具，請選擇要調查的載具`,
        window: null,
        coverage: null,
        range_basis: range.basis,
        vehicle: null,
        vehicle_candidates: involved.map((item) => ({ vehicle_code: item.vehicle_code, vehicle: item.vehicle, records: item.records })),
      };
    const coverage = await this.coverage(range.from, range.to);
    const ongoing = order.status === 'PROCESSING';
    const state = coverage.state === 'none' ? 'no_history' : ongoing ? 'running' : coverage.state === 'partial' ? 'partial' : 'complete';
    const labels: Record<string, string> = {
      no_history: '無歷史資料：這段期間沒有錄製',
      running: '執行中：只載入目前已保存的範圍',
      partial: '部分錄製：有未錄製或缺段的區間',
      complete: '已完整錄製',
    };
    return {
      ...base,
      state,
      state_label: labels[state],
      window: { from_real: range.from, to_real: range.to, ongoing },
      range_basis: range.basis,
      coverage,
      vehicle,
      vehicle_records: await this.vehicleRecords(vehicle, range.from, range.to),
      vehicle_candidates: involved.map((item) => ({ vehicle_code: item.vehicle_code, vehicle: item.vehicle, records: item.records })),
    };
  }

  /** 這次執行期間，可靠歸屬到這張單的車（依紀錄當時的車號），對應到已註冊的載具 */
  private async executionVehicles(order: { order_id: string; vehicle_code: string | null }, range: { from: number; to: number }) {
    const rows = await this.dataSource.query<Array<{ vehicle_code: string; records: string }>>(
      `SELECT vehicle_code, count(*) AS records FROM vehicle_history_frames
        WHERE order_id = $1 AND vehicle_code IS NOT NULL
          AND stream IN ('operation','order','order_action')
          AND received_at BETWEEN $2 AND $3
        GROUP BY vehicle_code ORDER BY vehicle_code`,
      [order.order_id, range.from, range.to],
    );
    const counts = new Map(rows.map((row) => [row.vehicle_code, Number(row.records)]));
    if (order.vehicle_code && !counts.has(order.vehicle_code)) counts.set(order.vehicle_code, 0);
    if (counts.size === 0) return [];
    const registered = await this.dataSource.query<Array<{ id: string; vehicle_code: string; display_name: string | null; is_active: boolean }>>(
      `SELECT id, vehicle_code, display_name, is_active FROM vehicles WHERE vehicle_code = ANY($1::text[])`,
      [[...counts.keys()]],
    );
    const byCode = new Map(registered.map((row) => [row.vehicle_code, toInvestigated(row)]));
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([vehicle_code, records]) => ({ vehicle_code, records, vehicle: byCode.get(vehicle_code) ?? null }));
  }

  /** 錄製涵蓋：錄製區段的聯集以外是未錄製；區段內另有寫入失敗、背壓丟棄的缺段 */
  async coverage(from: number, to: number): Promise<Coverage> {
    const segments = await this.dataSource.query<Array<{ started_real: string; last_alive_real: string; ended_real: string | null; status: string }>>(
      `SELECT started_real, last_alive_real, ended_real, status FROM vehicle_history_segments
        WHERE started_real <= $2 AND COALESCE(ended_real, last_alive_real) >= $1 OR (status = 'recording' AND started_real <= $2)
        ORDER BY started_real`,
      [from, to],
    );
    const now = Date.now();
    const recorded = mergeRanges(
      segments.map((segment) => {
        // 錄製中的區段：心跳每 10 秒一次，現在仍在錄製就算到現在
        const end = segment.status === 'recording' ? Math.max(Number(segment.last_alive_real), Math.min(now, to)) : Number(segment.ended_real ?? segment.last_alive_real);
        return { from_real: Math.max(from, Number(segment.started_real)), to_real: Math.min(to, end) };
      }).filter((range) => range.to_real >= range.from_real),
    );
    const gaps: CoverageGap[] = [];
    let cursor = from;
    for (const range of recorded) {
      if (range.from_real > cursor) gaps.push({ from_real: cursor, to_real: range.from_real, from_operating: null, to_operating: null, reason: cursor === from ? 'not_recorded' : 'backend_restart' });
      cursor = Math.max(cursor, range.to_real);
    }
    if (cursor < to) gaps.push({ from_real: cursor, to_real: to, from_operating: null, to_operating: null, reason: recorded.length ? 'backend_restart' : 'not_recorded' });
    const failures = await this.dataSource.query<Array<{ from_real: string; to_real: string; from_operating: string | null; to_operating: string | null; reason: CoverageGap['reason']; count: number; detail: string | null }>>(
      `SELECT from_real, to_real, from_operating, to_operating, reason, count, detail FROM vehicle_history_gaps
        WHERE from_real <= $2 AND to_real >= $1 ORDER BY from_real`,
      [from, to],
    );
    for (const gap of failures)
      gaps.push({ from_real: Number(gap.from_real), to_real: Number(gap.to_real), from_operating: numberOrNull(gap.from_operating), to_operating: numberOrNull(gap.to_operating), reason: gap.reason, count: gap.count, detail: gap.detail });
    gaps.sort((a, b) => a.from_real - b.from_real);
    const covered = recorded.reduce((sum, range) => sum + (range.to_real - range.from_real), 0);
    const state = recorded.length === 0 || covered === 0 ? 'none' : gaps.length > 0 ? 'partial' : 'complete';
    return { state, recorded, gaps, health_keepalive_ms: HEALTH_KEEPALIVE_MS };
  }

  /**
   * 調查載具：前端只送穩定的車輛識別（vehicles.id），這裡換成通訊代號（vehicle_code，建立後不變），
   * 每支調查 API 都重新驗證，不接受直接指定代號或名稱。停用（is_active=false）的車仍可調查。
   */
  async requireVehicle(rawId: unknown): Promise<InvestigatedVehicle> {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) throw new BadRequestException('請指定調查載具');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new BadRequestException('調查載具識別格式不正確');
    const cached = this.vehicleCache.get(id);
    if (cached && cached.until > Date.now()) return cached.vehicle;
    const [row] = await this.dataSource.query<Array<{ id: string; vehicle_code: string; display_name: string | null; is_active: boolean }>>(
      `SELECT id, vehicle_code, display_name, is_active FROM vehicles WHERE id = $1`,
      [id],
    );
    if (!row) throw new NotFoundException('找不到這台載具');
    const vehicle = toInvestigated(row);
    if (this.vehicleCache.size > 500) this.vehicleCache.clear();
    this.vehicleCache.set(id, { vehicle, until: Date.now() + VEHICLE_CACHE_MS });
    return vehicle;
  }

  /** 可調查的載具：已註冊的全部（含停用），附上有沒有歷史紀錄 */
  async listVehicles() {
    const rows = await this.dataSource.query<Array<{ id: string; vehicle_code: string; display_name: string | null; is_active: boolean; first_real: string | null; last_real: string | null }>>(
      `SELECT v.id, v.vehicle_code, v.display_name, v.is_active, h.first_real, h.last_real
         FROM vehicles v
         LEFT JOIN LATERAL (
           SELECT MIN(first_real) AS first_real, MAX(last_real) AS last_real
             FROM vehicle_history_stream_keys k WHERE k.vehicle_code = v.vehicle_code
         ) h ON true
        ORDER BY v.is_active DESC, v.vehicle_code`,
    );
    return {
      items: rows.map((row) => ({
        ...toInvestigated(row),
        history_first_real: numberOrNull(row.first_real),
        history_last_real: numberOrNull(row.last_real),
      })),
    };
  }

  /** 調查載具在範圍內有幾筆自己的紀錄（不含其他車、不含系統參照），以及範圍前最後一筆 */
  async vehicleRecords(vehicle: InvestigatedVehicle, from: number, to: number) {
    const [row] = await this.dataSource.query<Array<{ count: string; first: string | null; last: string | null }>>(
      `SELECT count(*) AS count, MIN(received_at) AS first, MAX(received_at) AS last
         FROM vehicle_history_frames
        WHERE vehicle_code = $1 AND stream = ANY($4::text[]) AND received_at BETWEEN $2 AND $3`,
      [vehicle.vehicle_code, from, to, VEHICLE_STREAMS],
    );
    const [before] = await this.dataSource.query<Array<{ received_at: string }>>(
      `SELECT received_at FROM vehicle_history_frames
        WHERE vehicle_code = $1 AND stream = ANY($3::text[]) AND received_at < $2
        ORDER BY received_at DESC, seq DESC LIMIT 1`,
      [vehicle.vehicle_code, from, VEHICLE_STREAMS],
    );
    return {
      count: Number(row?.count ?? 0),
      first_real: numberOrNull(row?.first),
      last_real: numberOrNull(row?.last),
      last_before_real: numberOrNull(before?.received_at),
    };
  }

  /**
   * 游標當下的起點狀態：每個狀態來源「不晚於游標」的最後一筆；游標之後的一筆都不給。
   *
   * scope=vehicle：調查載具自己的紀錄（遙測、營運、健康、事件、指令回應、紀錄當時指派給它的
   * 訂單與站點動作），另附地圖、模型、營運時鐘參照當畫面基準（只是狀態基準，不是收到的紀錄）。
   * scope=background：調查載具以外的一切（其他車、場站設施、地圖參照），地圖背景用。
   */
  async snapshot(input: { vehicle_id?: unknown; scope?: unknown; at?: unknown; seq?: unknown }) {
    const vehicle = await this.requireVehicle(input.vehicle_id);
    const scope = parseScope(input.scope);
    const at = parseEpochMs(input.at, 'at');
    const seq = parseSeq(input.seq) ?? MAX_SEQ;
    const code = vehicle.vehicle_code;
    let keys: Array<{ stream_key: string; stream: string }>;
    if (scope === 'vehicle') {
      // 訂單、站點動作的鍵：只取紀錄當時就屬於這台車的（frames.vehicle_code），不看目前指派
      const orderKeys = await this.dataSource.query<Array<{ stream_key: string; stream: string }>>(
        `SELECT DISTINCT stream_key, stream FROM vehicle_history_frames
          WHERE vehicle_code = $1 AND stream IN ('order','order_action')
            AND received_at BETWEEN $2::bigint - $3::bigint AND $2::bigint`,
        [code, at, ORDER_LOOKBACK_MS],
      );
      keys = [
        ...VEHICLE_OWN_STREAMS.map((stream) => ({ stream_key: `${stream}|${code}`, stream })),
        ...orderKeys,
        ...[...UNBOUNDED_STREAMS].map((stream) => ({ stream_key: stream === 'clock' ? 'clock|run' : `${stream}|active`, stream })),
      ];
    } else {
      keys = await this.dataSource.query<Array<{ stream_key: string; stream: string }>>(
        `SELECT stream_key, stream FROM vehicle_history_stream_keys
          WHERE first_real <= $1
            AND (stream IN ('map','model','clock')
                 OR (stream IN ('order','order_action') AND last_real >= $1 - $3::bigint)
                 OR last_real >= $1 - $2::bigint)
            AND NOT (stream = ANY($5::text[]) AND vehicle_code = $4)`,
        [at, SNAPSHOT_LOOKBACK_MS, ORDER_LOOKBACK_MS, code, VEHICLE_OWN_STREAMS],
      );
    }
    const rows: HistoryFrameRow[] = [];
    for (const part of chunk(keys, 200)) {
      const lookbacks = part.map((key) =>
        UNBOUNDED_STREAMS.has(key.stream) ? 0 : at - (ORDER_STREAMS.has(key.stream) ? ORDER_LOOKBACK_MS : SNAPSHOT_LOOKBACK_MS),
      );
      // 每個鍵各走一次索引（stream_key, received_at, seq）；車輛歸屬在同一個條件裡篩
      const found = await this.dataSource.query<HistoryFrameRow[]>(
        `SELECT f.* FROM unnest($1::text[], $2::bigint[]) AS k(stream_key, since)
           CROSS JOIN LATERAL (
             SELECT ${FRAME_COLUMNS}
               FROM vehicle_history_frames
              WHERE stream_key = k.stream_key
                AND (received_at, seq) <= ($3::bigint, $4::bigint)
                AND received_at >= k.since
                AND ${scopeClause('$5', scope, true)}
              ORDER BY received_at DESC, seq DESC
              LIMIT 1
           ) f`,
        [part.map((key) => key.stream_key), lookbacks, at, seq, code],
      );
      rows.push(...found);
    }
    // 參照時刻：這個範圍裡不晚於游標的最後一筆（系統參照不算）
    const [reference] = await this.dataSource.query<Array<{ received_at: string; seq: string }>>(
      scope === 'vehicle'
        ? `SELECT received_at, seq FROM vehicle_history_frames
            WHERE vehicle_code = $3 AND stream = ANY($5::text[])
              AND (received_at, seq) <= ($1::bigint, $2::bigint) AND received_at >= $1 - $4::bigint
            ORDER BY received_at DESC, seq DESC LIMIT 1`
        : `SELECT received_at, seq FROM vehicle_history_frames
            WHERE vehicle_code IS DISTINCT FROM $3 AND source = 'mqtt'
              AND (received_at, seq) <= ($1::bigint, $2::bigint) AND received_at >= $1 - $4::bigint
            ORDER BY received_at DESC, seq DESC LIMIT 1`,
      scope === 'vehicle' ? [at, seq, code, SNAPSHOT_LOOKBACK_MS, VEHICLE_STREAMS] : [at, seq, code, SNAPSHOT_LOOKBACK_MS],
    );
    return {
      vehicle,
      scope,
      at,
      seq: seq === MAX_SEQ ? null : seq,
      frames: rows.map(frameResponse),
      reference: reference ? { t: Number(reference.received_at), received_at: Number(reference.received_at), seq: reference.seq } : null,
    };
  }

  /**
   * 一段時間內的資料，依 (received_at, seq)；有界、沒拿完回傳 next 游標。
   * 先依範圍（調查載具／背景）篩選，再套筆數上限，其他車不會占滿調查載具的頁面。
   */
  async frames(input: { vehicle_id?: unknown; scope?: unknown; from?: unknown; to?: unknown; after_t?: unknown; after_seq?: unknown; limit?: unknown }) {
    const vehicle = await this.requireVehicle(input.vehicle_id);
    const scope = parseScope(input.scope);
    const from = parseEpochMs(input.from, 'from');
    const to = parseEpochMs(input.to, 'to');
    if (to < from) throw new BadRequestException('to 不能早於 from');
    if (to - from > MAX_FRAMES_WINDOW_MS) throw new BadRequestException(`一次最多查 ${MAX_FRAMES_WINDOW_MS / 60_000} 分鐘的資料`);
    const afterT = input.after_t === undefined || input.after_t === '' ? from : parseEpochMs(input.after_t, 'after_t');
    const afterSeq = parseSeq(input.after_seq, 'after_seq') ?? MAX_SEQ;
    const limit = Math.min(MAX_FRAMES_PER_REQUEST, Math.max(1, Math.floor(Number(input.limit)) || MAX_FRAMES_PER_REQUEST));
    const rows = await this.dataSource.query<HistoryFrameRow[]>(
      `SELECT ${FRAME_COLUMNS}
         FROM vehicle_history_frames
        WHERE (received_at, seq) > ($1::bigint, $2::bigint) AND received_at <= $3
          AND ${scopeClause('$5', scope)}
        ORDER BY received_at, seq
        LIMIT $4`,
      [afterT, afterSeq, to, limit + 1, vehicle.vehicle_code],
    );
    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      vehicle,
      scope,
      from,
      to,
      frames: page.map(frameResponse),
      covered_to: truncated && last ? Number(last.received_at) : to,
      next: truncated && last ? { t: Number(last.received_at), seq: last.seq } : null,
    };
  }

  /** 調查載具在游標前一筆／後一筆自己的紀錄（逐幀跨出已載入範圍時用）；沒有就回 null */
  async neighbor(input: { vehicle_id?: unknown; at?: unknown; seq?: unknown; dir?: unknown; min?: unknown; max?: unknown }) {
    const vehicle = await this.requireVehicle(input.vehicle_id);
    const at = parseEpochMs(input.at, 'at');
    const seq = parseSeq(input.seq) ?? MAX_SEQ;
    const dir = input.dir === 'prev' ? 'prev' : input.dir === 'next' ? 'next' : null;
    if (!dir) throw new BadRequestException('dir 必須是 prev 或 next');
    const min = input.min === undefined ? at - MAX_RANGE_MS : parseEpochMs(input.min, 'min');
    const max = input.max === undefined ? at + MAX_RANGE_MS : parseEpochMs(input.max, 'max');
    const [row] = await this.dataSource.query<HistoryFrameRow[]>(
      dir === 'prev'
        ? `SELECT ${FRAME_COLUMNS}
             FROM vehicle_history_frames
            WHERE vehicle_code = $4 AND stream = ANY($5::text[])
              AND (received_at, seq) < ($1::bigint, $2::bigint) AND received_at >= $3
            ORDER BY received_at DESC, seq DESC LIMIT 1`
        : `SELECT ${FRAME_COLUMNS}
             FROM vehicle_history_frames
            WHERE vehicle_code = $4 AND stream = ANY($5::text[])
              AND (received_at, seq) > ($1::bigint, $2::bigint) AND received_at <= $3
            ORDER BY received_at, seq LIMIT 1`,
      [at, seq, dir === 'prev' ? min : max, vehicle.vehicle_code, VEHICLE_STREAMS],
    );
    return { vehicle, frame: row ? frameResponse(row) : null };
  }

  /** 當時那一份地圖（依內容雜湊） */
  async map(hash: unknown) {
    const mapHash = typeof hash === 'string' ? hash.trim() : '';
    if (!/^[0-9a-f]{64}$/.test(mapHash)) throw new BadRequestException('地圖雜湊格式不正確');
    const [row] = await this.dataSource.query<Array<{ map_id: string; map_hash: string; map_version: string | null; document: unknown }>>(
      `SELECT map_id, map_hash, map_version, document FROM degraded_replay_maps WHERE map_hash = $1`,
      [mapHash],
    );
    if (!row) throw new NotFoundException('當時的地圖快照不存在');
    return { map_id: row.map_id, map_hash: row.map_hash, version: row.map_version, document: row.document };
  }

  /** 選取車輛截至游標已發生的事件與指令（既有的事件／指令紀錄，不另外推算） */
  async vehicleEvents(input: { vehicle_id?: unknown; from?: unknown; to?: unknown }) {
    const vehicle = (await this.requireVehicle(input.vehicle_id)).vehicle_code;
    const from = parseEpochMs(input.from, 'from');
    const to = parseEpochMs(input.to, 'to');
    if (to < from || to - from > MAX_RANGE_MS) throw new BadRequestException('時間範圍不正確');
    const events = await this.dataSource.query(
      `SELECT event_id, event_code::text AS event_code, severity::text AS severity, category_label, display_message,
              sub_label, detail, location, params, is_acknowledged,
              COALESCE(received_at, created_at) AS at
         FROM security_event_logs
        WHERE vehicle_code = $1 AND COALESCE(received_at, created_at) BETWEEN $2 AND $3
        ORDER BY COALESCE(received_at, created_at) DESC LIMIT 200`,
      [vehicle, from, to],
    );
    const commands = await this.dataSource.query(
      `SELECT command_id, action::text AS action, params, is_acked, sent_at, acked_at
         FROM command_logs
        WHERE vehicle_code = $1 AND sent_at BETWEEN $2 AND $3
        ORDER BY sent_at DESC LIMIT 200`,
      [vehicle, from, to],
    );
    return {
      vehicle,
      events: (events as Array<Record<string, unknown>>).map((row) => ({ ...row, at: numberOrNull(row.at) })),
      // 已回應的指令：回應時刻晚於游標的，在游標當下還沒回應
      commands: (commands as Array<Record<string, unknown>>).map((row) => {
        const ackedAt = numberOrNull(row.acked_at);
        const acked = row.is_acked === true && ackedAt != null && ackedAt <= to;
        return { ...row, sent_at: numberOrNull(row.sent_at), acked_at: acked ? ackedAt : null, is_acked: acked };
      }),
    };
  }

  private async vehiclesIn(from: number, to: number) {
    const rows = await this.dataSource.query<Array<{ vehicle_code: string; streams: string[]; first_real: string; last_real: string }>>(
      `SELECT vehicle_code, array_agg(DISTINCT stream ORDER BY stream) AS streams, MIN(first_real) AS first_real, MAX(last_real) AS last_real
         FROM vehicle_history_stream_keys
        WHERE vehicle_code IS NOT NULL AND first_real <= $2 AND last_real >= $1
          AND stream IN ('telemetry','operation','health','event','command_ack')
        GROUP BY vehicle_code ORDER BY vehicle_code`,
      [from, to],
    );
    return rows.map((row) => ({ vehicle_code: row.vehicle_code, streams: row.streams, first_real: Number(row.first_real), last_real: Number(row.last_real) }));
  }

  /** 範圍內出現過的營運時鐘（模擬重播時營運時間與實際時間不同；不同輪次各自標示） */
  private async clockRunsIn(from: number, to: number) {
    const rows = await this.dataSource.query<Array<{ received_at: string; payload: Record<string, unknown> }>>(
      `(SELECT received_at, payload FROM vehicle_history_frames
         WHERE stream_key = 'clock|run' AND received_at <= $1 ORDER BY received_at DESC, seq DESC LIMIT 1)
       UNION ALL
       (SELECT received_at, payload FROM vehicle_history_frames
         WHERE stream_key = 'clock|run' AND received_at > $1 AND received_at <= $2 ORDER BY received_at, seq)`,
      [from, to],
    );
    return rows.map((row, index) => ({
      clock_run: String(row.payload.clock_run ?? ''),
      mode: row.payload.mode ?? null,
      run_id: row.payload.run_id ?? null,
      from_real: Math.max(from, Number(row.received_at)),
      to_real: index + 1 < rows.length ? Number(rows[index + 1].received_at) : to,
    }));
  }

  /** 這個訂單號出現過的每一次執行（目前的訂單主檔＋歷史中的訂單紀錄，依建立時刻區分） */
  private async orderInstances(orderId: string) {
    const current = await this.dataSource.query<Array<Record<string, string | null>>>(
      `SELECT order_id, trip_code, vehicle_code, status::text AS status, created_at, completed_at, payload
         FROM operation_orders WHERE order_id = $1`,
      [orderId],
    );
    const history = await this.dataSource.query<Array<{ payload: Record<string, unknown>; received_at: string }>>(
      `SELECT DISTINCT ON (payload->>'created_at') payload, received_at
         FROM vehicle_history_frames
        WHERE stream = 'order' AND order_id = $1
        ORDER BY payload->>'created_at', received_at DESC, seq DESC`,
      [orderId],
    );
    type Instance = {
      order_id: string;
      created_at: string;
      trip_code: string | null;
      vehicle_code: string | null;
      status: string;
      completed_at: string | null;
      operating_day: string | null;
      plan_run_id: string | null;
      payload: Record<string, unknown>;
      from_history: boolean;
    };
    const byCreated = new Map<string, Instance>();
    for (const row of history) {
      const payload = row.payload;
      const createdAt = payload.created_at == null ? null : String(payload.created_at);
      if (!createdAt) continue;
      byCreated.set(createdAt, {
        order_id: orderId,
        created_at: createdAt,
        trip_code: (payload.trip_code as string) ?? null,
        vehicle_code: (payload.vehicle_code as string) ?? null,
        status: String(payload.status ?? ''),
        completed_at: payload.completed_at == null ? null : String(payload.completed_at),
        operating_day: (payload.operating_day as string) ?? null,
        plan_run_id: (payload.plan_run_id as string) ?? null,
        payload,
        from_history: true,
      });
    }
    // 訂單主檔還在的那一筆以主檔為準（最新狀態）
    for (const row of current) {
      const payload = (row.payload ?? {}) as unknown as Record<string, unknown>;
      const createdAt = String(row.created_at);
      byCreated.set(createdAt, {
        order_id: orderId,
        created_at: createdAt,
        trip_code: row.trip_code,
        vehicle_code: row.vehicle_code,
        status: String(row.status),
        completed_at: row.completed_at,
        operating_day: (payload.operating_day as string) ?? null,
        plan_run_id: (payload.plan_run_id as string) ?? null,
        payload,
        from_history: false,
      });
    }
    return [...byCreated.values()].sort((a, b) => Number(a.created_at) - Number(b.created_at));
  }

  /**
   * 這次執行有據的時間範圍（實際時間）。優先用車端回報的開始／結束；缺的那一端用歷史中這張單
   * 的第一筆／最後一筆營運回報，並在 basis 說明採用了什麼。都沒有就回 null（不用計畫時間）。
   */
  private async executionRange(order: { order_id: string; created_at: string; status: string; completed_at: string | null; payload: Record<string, unknown> }) {
    const payload = order.payload;
    const progress = (payload.vehicle_progress_at ?? {}) as Record<string, unknown>;
    const createdAt = Number(order.created_at);
    let from = numberOrNull(payload.actual_started_at) ?? numberOrNull(progress.PROCESSING);
    let fromBasis = from != null ? 'actual_start' : null;
    let to =
      numberOrNull(progress.END) ??
      numberOrNull(progress.FAULTED) ??
      numberOrNull(progress.CANCELLED) ??
      numberOrNull(order.completed_at) ??
      numberOrNull((payload.cancel_requested_at as unknown) ?? null);
    let toBasis = to != null ? 'actual_end' : null;
    if (from == null || (to == null && order.status !== 'PROCESSING')) {
      // 同一個訂單號可能有前一次執行：只看這次建立之後的回報
      const [bounds] = await this.dataSource.query<Array<{ first: string | null; last: string | null }>>(
        `SELECT MIN(received_at) AS first, MAX(received_at) AS last FROM vehicle_history_frames
          WHERE order_id = $1 AND stream = 'operation' AND received_at >= $2`,
        [order.order_id, createdAt],
      );
      if (from == null && bounds?.first) {
        from = Number(bounds.first);
        fromBasis = 'first_operation_report';
      }
      if (to == null && order.status !== 'PROCESSING' && bounds?.last) {
        to = Number(bounds.last);
        toBasis = 'last_operation_report';
      }
    }
    if (from == null) return null;
    if (order.status === 'PROCESSING') {
      to = Date.now();
      toBasis = 'now_running';
    }
    if (to == null || to < from) return null;
    return { from, to, basis: { from: fromBasis, to: toBasis } };
  }
}

export function frameResponse(row: HistoryFrameRow) {
  return {
    seq: String(row.seq),
    t: Number(row.received_at),
    stream: row.stream,
    stream_key: row.stream_key,
    vehicle_code: row.vehicle_code,
    topic: row.topic,
    order_id: row.order_id,
    received_at: Number(row.received_at),
    operating_at: numberOrNull(row.operating_at),
    clock_run: row.clock_run,
    vehicle_ts: numberOrNull(row.vehicle_ts),
    source: row.source,
    payload: row.payload,
    derived: row.derived,
  };
}

export function mergeRanges(ranges: Array<{ from_real: number; to_real: number }>) {
  const sorted = [...ranges].sort((a, b) => a.from_real - b.from_real);
  const out: Array<{ from_real: number; to_real: number }> = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last && range.from_real <= last.to_real) last.to_real = Math.max(last.to_real, range.to_real);
    else out.push({ ...range });
  }
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
