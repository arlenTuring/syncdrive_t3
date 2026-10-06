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

/**
 * 地圖文件裡可以解析的點位 ID。
 *
 * 任務的站序與起訖點會用到四種 ID，車端（模擬器 mapSource.js 也是）都只靠地圖檔解析：
 * 拓樸節點綁的站點別名、路線站序、區域裡的元件（設施、停靠點、途經點）的 id／代號／
 * 途經點代號、渡線 portal 的途經點代號。只認前兩種的話，入出場任務的停靠點（096）、
 * 區域入口途經點（161）、格位設施（149＝E3）都會被誤判成解析不到。
 */
export function mapStationIds(doc: SimulationMapDocument): Set<string> {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value) ids.add(value);
    else if (typeof value === 'number') ids.add(String(value));
  };
  for (const area of Array.isArray(doc.areas) ? (doc.areas as unknown[]) : []) {
    const facilities = asRecord(area)?.facilities;
    for (const facility of Array.isArray(facilities) ? facilities : []) {
      const record = asRecord(facility);
      if (!record) continue;
      const parameters = asRecord(record.parameters);
      add(record.id);
      add(record.customName);
      add(parameters?.waypointCode);
      const portals = asRecord(parameters?.trackCrossoverPortals);
      for (const key of ['a', 'b']) add(asRecord(portals?.[key])?.waypointCode);
    }
  }
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
        // 設施中心查不到時，地圖上有這個元件（例如停靠點）也算解析得到
        if (!input.resolveFacility(point.id) && !stations.has(point.id))
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
 * 展開後計畫的版本摘要。只看每一筆在當天的相對時刻與內容，不看是哪一天——同一份班表
 * 展開到不同營運日，摘要相同。模擬器載入身分（identity.plan_digest）、每日計畫採用紀錄、
 * 訂單 payload.plan_digest 都用這一支，三者才對得起來。
 */
export function planDigestOf(planned: PlannedDispatch[]): string {
  return contentDigest(planned.map(planIdentityOf));
}

function planIdentityOf(item: PlannedDispatch) {
  const dayStart = new Date(item.departAt);
  dayStart.setHours(0, 0, 0, 0);
  const base = dayStart.getTime();
  return {
    tripCode: item.tripCode,
    kind: item.kind,
    taskType: item.taskType,
    vehicleCode: item.vehicleCode,
    timelineRow: item.timelineRow,
    routeCode: item.routeCode,
    depart: (item.departAt - base) / 1000,
    arrive: (item.arriveAt - base) / 1000,
    origin: item.origin?.id ?? null,
    destination: item.destination?.id ?? null,
    stations: item.stations.map((station) => [
      station.stationId,
      station.dwellSeconds,
    ]),
    maintenance: item.maintenance?.yardSlotId ?? null,
  };
}
