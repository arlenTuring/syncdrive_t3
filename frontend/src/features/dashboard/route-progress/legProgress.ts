import type { RouteStation } from '../types';

/**
 * 班次卡軌道上的車輛位置：以「同一張單、同一段」為單位推進。
 * ================================================
 *
 * 以前用 1 − ETA／leg_eta_max 算，會來回跳：
 * - ETA 是預測時間，會隨速度、停等、倍速改變；分母又是另一個基準（排班的營運秒數 vs 倍速下車端的實際秒數）。
 * - 分母從 SQL 輪詢來，剛進入新的一段時還沒有，位置就退回這一段的起點；下一輪 SQL 刷新又跳到別處。
 * - MQTT 超過 4 秒沒更新就改用 SQL 另一套算法；元件重建時「最後位置」也跟著遺失。
 *
 * 現在的規則：
 * - 進度＝上一站錨點 + (1 − 到目標站距離／這一段的距離分母) × 段長。距離分母是這張單在這一段觀測到的
 *   最大距離（車端一進入新的一段就回報，第一筆就是整段長；後端也存一份 payload.leg_distance_max_m），
 *   只在換段或換單時重設，輪詢不會改它。
 * - 回報必須是同一張單（order_id）；比上一筆舊的回報（亂序、retain、重送）不採用。
 * - 目標站以穩定站點 ID 對應，不看站名；同一站在路線上出現兩次時，取「不早於目前這一段」的那一次。
 * - 暫時沒有回報、缺欄位、SQL 刷新：保留最後有效位置並標示資料狀態，不跳回起點。
 * - 狀態依單號存在模組裡，卡片元件重建也接得上；換單才從頭開始。
 */

export type LegProgressBasis =
  /** 依距離推算 */
  | 'distance'
  /** 已到站（距離 0、ETA 0） */
  | 'arrived'
  /** 剛進入這一段、還沒有距離分母：放在這一段的起點 */
  | 'leg-start'
  /** 暫時沒有可用回報：保留最後有效位置 */
  | 'held'
  /** 這張單還沒有任何車端回報，用 SQL 的同一套距離進度 */
  | 'sql'
  /** 什麼都沒有：路線起點 */
  | 'origin';

export type LegProgressState = {
  orderId: string;
  legIndex: number;
  target: string | null;
  /** 這一段的距離分母（公尺）；0＝還不知道 */
  legDistanceMax: number;
  percent: number;
  /** 最後採用的回報時間（車端 timestamp） */
  reportTs: number | null;
  basis: LegProgressBasis;
};

export type LegReport = {
  orderId: string | null;
  ts: number | null;
  target: string | null;
  distanceM: number | null;
  etaSeconds: number | null;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function stationKey(station: RouteStation): string {
  return String(station.stationId ?? '').trim();
}

/** 目標站在站序裡的位置：只比站點 ID；從 fromIndex 起找（同一站出現兩次時不往回跳） */
export function stationIndexForTarget(stations: RouteStation[], target: string, fromIndex = 0): number {
  const t = target.trim();
  if (!t) return -1;
  const hasIds = stations.some((station) => stationKey(station));
  const matches = (station: RouteStation) => (hasIds ? stationKey(station) === t : station.id === t);
  for (let i = Math.max(0, fromIndex); i < stations.length; i += 1) {
    if (matches(stations[i])) return i;
  }
  return stations.findIndex(matches);
}

export function percentWithinLeg(stations: RouteStation[], legIndex: number, remainingFraction: number): number {
  const target = stations[legIndex]?.value ?? 0;
  const previous = legIndex > 0 ? stations[legIndex - 1].value : target;
  return clamp(previous + (1 - clamp(remainingFraction, 0, 1)) * (target - previous), 0, 100);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** MQTT operation/update → 這一段的回報 */
export function legReportFromPayload(payload: Record<string, unknown> | null | undefined): LegReport | null {
  if (!payload) return null;
  const leg = payload.current_leg && typeof payload.current_leg === 'object'
    ? (payload.current_leg as Record<string, unknown>)
    : null;
  return {
    orderId: typeof payload.order_id === 'string' ? payload.order_id : null,
    ts: num(payload.timestamp ?? payload.updated_at),
    target: leg && leg.target_station_id != null ? String(leg.target_station_id).trim() || null : null,
    distanceM: leg ? num(leg.distance_to_target_m) : null,
    etaSeconds: leg ? num(leg.eta_seconds) : null,
  };
}

export function parseLegDistanceMax(raw: unknown): Record<string, number> {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  const out: Record<string, number> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const n = num(v);
      if (n != null && n > 0) out[key] = n;
    }
  }
  return out;
}

/**
 * 推進一步（純函式）：上一個狀態 + 這張單的最新回報（可能沒有）→ 新狀態。
 * sqlRemainPct：SQL 依同一套距離算的「這一段還剩幾 %」（未知為 null），只在這張單還沒有任何回報時用。
 */
export function advanceLegProgress(
  previous: LegProgressState | undefined,
  input: {
    orderId: string;
    stations: RouteStation[];
    report: LegReport | null;
    backendLegDistanceMax: Record<string, number>;
    sql: { segmentIndex: number | null; remainPct: number | null } | null;
  },
): LegProgressState {
  const { orderId, stations } = input;
  const prev = previous && previous.orderId === orderId ? previous : undefined;
  const origin: LegProgressState = {
    orderId, legIndex: 0, target: null, legDistanceMax: 0,
    percent: stations[0]?.value ?? 0, reportTs: null, basis: 'origin',
  };
  const held = (state: LegProgressState): LegProgressState => ({ ...state, basis: 'held' });

  const report = input.report && input.report.orderId === orderId ? input.report : null;
  const isNewer = report && (prev?.reportTs == null || report.ts == null || report.ts > prev.reportTs);
  if (!report || !isNewer || !report.target) {
    if (prev && prev.reportTs != null) return prev.basis === 'held' ? prev : held(prev);
    // 這張單還沒有車端回報：SQL 的距離進度（同一套基準）；也沒有就保留／起點
    const segment = input.sql?.segmentIndex;
    const remain = input.sql?.remainPct;
    if (segment != null && remain != null && stations.length >= 2) {
      const legIndex = clamp(Math.floor(segment) + 1, 1, stations.length - 1);
      return { ...origin, legIndex, percent: percentWithinLeg(stations, legIndex, remain / 100), basis: 'sql' };
    }
    return prev ?? origin;
  }

  const legIndex = stationIndexForTarget(stations, report.target, prev?.legIndex ?? 0);
  if (legIndex < 0) return prev ? held(prev) : origin;
  const newLeg = !prev || prev.legIndex !== legIndex || prev.target !== report.target;
  const legDistanceMax = Math.max(
    newLeg ? 0 : prev.legDistanceMax,
    input.backendLegDistanceMax[report.target] ?? 0,
    report.distanceM ?? 0,
  );
  const base = { orderId, legIndex, target: report.target, legDistanceMax, reportTs: report.ts };

  if (legIndex === 0) return { ...base, percent: stations[0]?.value ?? 0, basis: 'arrived' };
  if (report.distanceM === 0 && (report.etaSeconds ?? 0) <= 0) {
    return { ...base, percent: stations[legIndex].value, basis: 'arrived' };
  }
  if (report.distanceM != null && legDistanceMax > 0) {
    return { ...base, percent: percentWithinLeg(stations, legIndex, report.distanceM / legDistanceMax), basis: 'distance' };
  }
  // 有這一段、但缺距離：新的一段放在起點（剛離開上一站），同一段保留最後位置
  return newLeg
    ? { ...base, percent: percentWithinLeg(stations, legIndex, 1), basis: 'leg-start' }
    : { ...base, percent: prev.percent, basis: 'held' };
}

/** 依單號保存最後狀態：卡片元件重建（重新排序、SQL 刷新）也接得上 */
const states = new Map<string, LegProgressState>();
const MAX_STATES = 400;

export function rememberLegProgress(state: LegProgressState): LegProgressState {
  states.delete(state.orderId);
  states.set(state.orderId, state);
  while (states.size > MAX_STATES) {
    const oldest = states.keys().next().value;
    if (oldest === undefined) break;
    states.delete(oldest);
  }
  return state;
}

export function recallLegProgress(orderId: string): LegProgressState | undefined {
  return states.get(orderId);
}

/** 測試用 */
export function clearLegProgressMemory(): void {
  states.clear();
}
