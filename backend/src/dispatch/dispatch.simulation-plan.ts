import { createHash } from 'node:crypto';
import type { PlannedDispatch } from './dispatch.plan';

/**
 * 模擬器依「指定班表」載入時的檢查與身分摘要（純函式，不碰資料庫）。
 *
 * <h3>為什麼要獨立一份</h3>
 * 正式調度只看部署中的班表、只發得出去的訂單；模擬器要的是「使用者選的那一份」能不能
 * 完整跑、跑的是不是同一個版本。所以這裡只做三件事：
 *   1. 找出班表引用的地圖（不拿目前啟用地圖代替）。
 *   2. 檢查計畫裡每個站點、設施都能在那份地圖解析，任務有沒有被略過。
 *   3. 用內容摘要標出這次載入的身分，之後啟動時比對有沒有換版。
 */

export type SimulationMapDocument = Record<string, unknown>;

export type SimulationReadiness = {
  simulatable: boolean;
  /** 不能模擬的原因；有任何一項 simulatable 就是 false */
  blockingReasons: string[];
  /** 可以模擬但要讓使用者知道的事（例如無法保證歷史版本一致） */
  warnings: string[];
};

/** 穩定序列化：鍵排序，讓同樣內容永遠得到同樣的摘要 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function contentDigest(value: unknown): string {
  return createHash('sha256')
    .update(stableStringify(value))
    .digest('hex')
    .slice(0, 16);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 班表引用的地圖與路線（只讀班表自己存的引用） */
export function readShiftMapReference(body: Record<string, unknown>): {
  mapId: string | null;
  selectedRouteIds: string[];
} {
  const output = asRecord(body.scheduleOutput);
  const ref = asRecord(output?.routeGroupsRef);
  const fromRef = typeof ref?.mapId === 'string' ? ref.mapId.trim() : '';
  const fromBody =
    typeof body.routeGroupsMapId === 'string'
      ? body.routeGroupsMapId.trim()
      : '';
  const routes = Array.isArray(ref?.selectedRouteIds)
    ? (ref.selectedRouteIds as unknown[]).filter(
        (id): id is string => typeof id === 'string' && !!id.trim(),
      )
    : [];
  return { mapId: fromRef || fromBody || null, selectedRouteIds: routes };
}

/** 地圖文件裡可以解析的站點 ID（拓樸節點綁的站點＋路線站序） */
export function mapStationIds(doc: SimulationMapDocument): Set<string> {
  const ids = new Set<string>();
  const topology = asRecord(doc.pointTopology);
  for (const node of Array.isArray(topology?.nodes)
    ? (topology.nodes as unknown[])
    : []) {
    const stationId = asRecord(node)?.stationId;
    if (typeof stationId === 'string' && stationId) ids.add(stationId);
  }
  for (const route of Array.isArray(doc.routes)
    ? (doc.routes as unknown[])
    : []) {
    const stationIds = asRecord(route)?.stationIds;
    for (const id of Array.isArray(stationIds) ? stationIds : []) {
      if (typeof id === 'string' && id) ids.add(id);
    }
  }
  return ids;
}

export function mapRouteIds(doc: SimulationMapDocument): Set<string> {
  const ids = new Set<string>();
  for (const route of Array.isArray(doc.routes)
    ? (doc.routes as unknown[])
    : []) {
    const id = asRecord(route)?.routeId;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

/**
 * 判斷能不能模擬。只要有一項無法處理就不能宣稱「完整載入」：
 * 沒有排班結果、發布檢查有阻擋、引用的地圖不存在、站點／設施／路線解析不到、
 * 任務因為沒有車或缺起訖點被略過。
 */
export function assessSimulationReadiness(input: {
  hasSchedulePlan: boolean;
  publishBlockReason: string | null;
  mapId: string | null;
  mapDocument: SimulationMapDocument | null;
  mapLookupError: string | null;
  selectedRouteIds: string[];
  planned: PlannedDispatch[];
  skipped: Array<{ tripCode: string; reason: string }>;
  resolveFacility: (facilityId: string) => boolean;
  generatedAt: string | null;
  mapUpdatedAt: string | null;
}): SimulationReadiness & {
  unresolvedStations: string[];
  unresolvedFacilities: string[];
  missingRoutes: string[];
} {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  const unresolvedStations = new Set<string>();
  const unresolvedFacilities = new Set<string>();
  const missingRoutes: string[] = [];

  if (!input.hasSchedulePlan) {
    blockingReasons.push(
      '此班表沒有排班結果（scheduleOutput.plan），沒有可以模擬的任務',
    );
  }
  if (input.publishBlockReason) {
    blockingReasons.push(
      `排班結果有阻擋執行的問題：${input.publishBlockReason}`,
    );
  }
  if (!input.mapId) {
    blockingReasons.push(
      '班表沒有記錄使用的地圖（routeGroupsRef.mapId），無法確定圖資；不會改用目前啟用的地圖',
    );
  } else if (!input.mapDocument) {
    blockingReasons.push(
      `班表引用的地圖「${input.mapId}」在伺服器上找不到${input.mapLookupError ? `（${input.mapLookupError}）` : ''}；不會改用其他地圖`,
    );
  }

  if (input.mapDocument) {
    const stations = mapStationIds(input.mapDocument);
    const routes = mapRouteIds(input.mapDocument);
    for (const routeId of input.selectedRouteIds) {
      if (!routes.has(routeId)) missingRoutes.push(routeId);
    }
    const checkPoint = (point: { id: string; kind: string } | null) => {
      if (!point?.id) return;
      if (point.kind === 'facility') {
        if (!input.resolveFacility(point.id))
          unresolvedFacilities.add(point.id);
      } else if (!stations.has(point.id)) {
        unresolvedStations.add(point.id);
      }
    };
    for (const item of input.planned) {
      checkPoint(item.origin);
      checkPoint(item.destination);
      for (const station of item.stations) {
        if (station.stationId && !stations.has(station.stationId))
          unresolvedStations.add(station.stationId);
      }
    }
    if (missingRoutes.length) {
      blockingReasons.push(
        `班表選用的路線在地圖「${input.mapId}」找不到：${missingRoutes.join('、')}`,
      );
    }
    if (unresolvedStations.size) {
      blockingReasons.push(
        `任務引用的站點在地圖上解析不到：${[...unresolvedStations].join('、')}`,
      );
    }
    if (unresolvedFacilities.size) {
      blockingReasons.push(
        `任務引用的設施在地圖上解析不到：${[...unresolvedFacilities].join('、')}`,
      );
    }

    // 班表只記地圖 ID、沒記當時的地圖版本：舊資料無法保證歷史一致，照實說
    warnings.push(
      '班表只記錄地圖 ID，沒有記錄製作當時的地圖版本；載入的是這份地圖目前發布的內容',
    );
    const generated = input.generatedAt ? Date.parse(input.generatedAt) : NaN;
    const mapUpdated = input.mapUpdatedAt
      ? Date.parse(input.mapUpdatedAt)
      : NaN;
    if (
      Number.isFinite(generated) &&
      Number.isFinite(mapUpdated) &&
      mapUpdated > generated
    ) {
      warnings.push(
        `地圖在班表製作之後（${input.mapUpdatedAt}）被修改過，與製作當時的圖資可能不同`,
      );
    }
  }

  if (input.skipped.length) {
    const sample = input.skipped
      .slice(0, 5)
      .map((item) => `${item.tripCode}：${item.reason}`)
      .join('；');
    blockingReasons.push(
      `有 ${input.skipped.length} 筆任務無法轉成執行計畫（${sample}${input.skipped.length > 5 ? '…' : ''}）`,
    );
  }
  if (
    input.hasSchedulePlan &&
    input.planned.length === 0 &&
    !input.skipped.length
  ) {
    blockingReasons.push('班表展開後沒有任何可執行的任務');
  }

  return {
    simulatable: blockingReasons.length === 0,
    blockingReasons,
    warnings,
    unresolvedStations: [...unresolvedStations],
    unresolvedFacilities: [...unresolvedFacilities],
    missingRoutes,
  };
}

/**
 * 模擬執行追溯：模擬器建單時在訂單 payload 帶的欄位（沿用既有 payload，不另建資料表）。
 *   sim_run_id      本次執行 ID
 *   sim_shift_id    載入的班表 ID
 *   sim_load_digest 載入身分（/dispatch/plan/shift/:id 的 identity.load_digest）
 */
export const SIM_PAYLOAD_KEYS = {
  runId: 'sim_run_id',
  shiftId: 'sim_shift_id',
  loadDigest: 'sim_load_digest',
} as const;

export type SimulationRunOrderRow = {
  status: string;
  /** 最近一次車端回報時間（payload.updated_at／actual_started_at／completed_at 取最新） */
  reportedAt: number | null;
  shiftId: string | null;
  loadDigest: string | null;
};

export type SimulationRunState =
  | 'no_orders'
  | 'waiting_vehicle_report'
  | 'running'
  | 'finished'
  | 'failed';

/**
 * 「已建立訂單」不等於「車輛已執行」：沒有任何車端回報時是 waiting_vehicle_report。
 * planned 有給時，全部結案才算 finished。
 */
export function summarizeSimulationRun(
  rows: SimulationRunOrderRow[],
  planned?: number,
) {
  const byStatus: Record<string, number> = {};
  for (const row of rows)
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  const completed = byStatus.END ?? 0;
  const faulted = byStatus.FAULTED ?? 0;
  const started = rows.filter((row) => row.status !== 'PENDING').length;
  const reported = rows.filter((row) => row.reportedAt !== null);
  const lastReportAt = reported.length
    ? Math.max(...reported.map((row) => row.reportedAt as number))
    : null;

  let state: SimulationRunState;
  if (rows.length === 0) state = 'no_orders';
  else if (reported.length === 0 && started === 0)
    state = 'waiting_vehicle_report';
  else if (
    planned !== undefined &&
    completed + faulted >= planned &&
    rows.length >= planned
  ) {
    state = faulted > 0 ? 'failed' : 'finished';
  } else state = 'running';

  return {
    state,
    orders_created: rows.length,
    planned: planned ?? null,
    started,
    completed,
    faulted,
    by_status: byStatus,
    orders_with_vehicle_report: reported.length,
    last_vehicle_report_at:
      lastReportAt === null ? null : new Date(lastReportAt).toISOString(),
    shift_ids: [
      ...new Set(
        rows.map((row) => row.shiftId).filter((id): id is string => !!id),
      ),
    ],
    load_digests: [
      ...new Set(
        rows.map((row) => row.loadDigest).filter((id): id is string => !!id),
      ),
    ],
  };
}
