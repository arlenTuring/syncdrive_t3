import type {
  ShiftScheduleSelectedRoute,
  ShiftScheduleStationDwell,
} from '../../types/create';

/** 預設路線切換緩衝（秒） */
export const SHIFT_SCHEDULE_DEFAULT_SWITCH_BUFFER_SECONDS = 0;

/** 預設靠站緩衝（%） */
export const SHIFT_SCHEDULE_DEFAULT_DWELL_SLACK_PERCENT = 0;

/** 整點對齊格位（秒）：計畫時刻須落在此格位上 */
export const SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS = 10;

/** 預設恢復時間（秒）：同一 timeline 兩趟正線之間至少保留的可吸收延誤空檔 */
export const SHIFT_SCHEDULE_DEFAULT_RECOVERY_TIME_SECONDS = 30;

export function normalizeSwitchBufferAfterSeconds(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return SHIFT_SCHEDULE_DEFAULT_SWITCH_BUFFER_SECONDS;
  }
  return Math.round(raw);
}

export function normalizeDwellSlackPercent(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return SHIFT_SCHEDULE_DEFAULT_DWELL_SLACK_PERCENT;
  }
  return Math.min(100, Math.round(raw * 10) / 10);
}

export function normalizeMinimumRecoveryTimeSeconds(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return SHIFT_SCHEDULE_DEFAULT_RECOVERY_TIME_SECONDS;
  }
  return Math.round(raw);
}

/** 單站有效停靠秒數（含靠站緩衝%，向上取整避免低估） */
export function applyDwellSlackSeconds(dwellSeconds: number, slackPercent: number): number {
  const pct = normalizeDwellSlackPercent(slackPercent);
  if (dwellSeconds <= 0) return 0;
  if (pct <= 0) return Math.round(dwellSeconds);
  return Math.ceil(dwellSeconds * (1 + pct / 100));
}

export function snapUpToClockAlignSeconds(
  seconds: number,
  gridSeconds = SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
): number {
  if (gridSeconds <= 0) return Math.round(seconds);
  return Math.ceil(seconds / gridSeconds) * gridSeconds;
}

export function isClockAlignedSeconds(
  seconds: number,
  gridSeconds = SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
): boolean {
  if (gridSeconds <= 0) return true;
  return Math.round(seconds) % gridSeconds === 0;
}

export function sortSelectedRoutesByExecutionOrder(
  routes: ShiftScheduleSelectedRoute[],
): ShiftScheduleSelectedRoute[] {
  return [...routes].sort((a, b) => {
    const aOrder = a.executionOrder > 0 ? a.executionOrder : Number.MAX_SAFE_INTEGER;
    const bOrder = b.executionOrder > 0 ? b.executionOrder : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.routeName.localeCompare(b.routeName, 'zh-Hant');
  });
}

export function sumStationDwellSeconds(dwells: ShiftScheduleStationDwell[]): number | null {
  if (dwells.length === 0) return 0;
  let total = 0;
  for (const dwell of dwells) {
    if (dwell.dwellSeconds == null || dwell.dwellSeconds <= 0) return null;
    total += dwell.dwellSeconds;
  }
  return total;
}

/** 各站停靠加總（含路線靠站緩衝%） */
export function sumStationDwellSecondsWithSlack(
  dwells: ShiftScheduleStationDwell[],
  dwellSlackPercent: number,
): number | null {
  if (dwells.length === 0) return 0;
  let total = 0;
  for (const dwell of dwells) {
    if (dwell.dwellSeconds == null || dwell.dwellSeconds <= 0) return null;
    total += applyDwellSlackSeconds(dwell.dwellSeconds, dwellSlackPercent);
  }
  return total;
}

export function areStationDwellsComplete(dwells: ShiftScheduleStationDwell[]): boolean {
  return dwells.length > 0 && dwells.every((d) => d.dwellSeconds != null && d.dwellSeconds > 0);
}

/** 行駛 + 各站有效停靠加總（缺資料時回 null） */
export function resolveRouteCycleSeconds(
  travelSeconds: number | null,
  dwells: ShiftScheduleStationDwell[],
  dwellSlackPercent = 0,
): number | null {
  if (travelSeconds == null || travelSeconds <= 0) return null;
  const dwellTotal = sumStationDwellSecondsWithSlack(dwells, dwellSlackPercent);
  if (dwellTotal == null) return null;
  return travelSeconds + dwellTotal;
}

/** 最快一圈 + 恢復時間（與折返時限比較用） */
export function resolveRouteMinTurnaroundBudgetSeconds(
  route: ShiftScheduleSelectedRoute,
  minimumRecoveryTimeSeconds: number,
): number | null {
  const cycle = resolveRouteCycleSeconds(
    route.minTravelTimeSeconds,
    route.stationDwells,
    route.dwellSlackPercent,
  );
  if (cycle == null) return null;
  return cycle + Math.max(0, minimumRecoveryTimeSeconds);
}

/**
 * 正線：最快一圈（minTravel + 停靠 + 恢復時間）不得超過車輛折返時限。
 */
export function isMainlineRouteWithinTurnaroundLimit(
  route: ShiftScheduleSelectedRoute,
  turnaroundLimitSeconds: number | null,
  minimumRecoveryTimeSeconds = 0,
): boolean {
  if (turnaroundLimitSeconds == null || turnaroundLimitSeconds <= 0) return false;
  const budget = resolveRouteMinTurnaroundBudgetSeconds(route, minimumRecoveryTimeSeconds);
  if (budget == null) return false;
  return budget <= turnaroundLimitSeconds;
}

export function resolveNextRouteInExecutionOrder(
  routes: ShiftScheduleSelectedRoute[],
  routeId: string,
): ShiftScheduleSelectedRoute | null {
  const ordered = sortSelectedRoutesByExecutionOrder(routes);
  if (ordered.length === 0) return null;
  const index = ordered.findIndex((route) => route.routeId === routeId);
  if (index < 0) return null;
  return ordered[(index + 1) % ordered.length] ?? null;
}

/** 依執行順序加總：各路線最快一圈 + 路線切換緩衝 */
export function resolveRouteRotationMinSeconds(
  routes: ShiftScheduleSelectedRoute[],
): number | null {
  const ordered = sortSelectedRoutesByExecutionOrder(routes);
  if (ordered.length === 0) return null;
  let total = 0;
  for (const route of ordered) {
    const cycle = resolveRouteCycleSeconds(
      route.minTravelTimeSeconds,
      route.stationDwells,
      route.dwellSlackPercent,
    );
    if (cycle == null) return null;
    total += cycle + normalizeSwitchBufferAfterSeconds(route.switchBufferAfterSeconds);
  }
  return total;
}

/** 路線群組物理參數指紋（新鮮度／失效判斷用） */
export function buildRouteGroupsParamsFingerprint(input: {
  minimumRecoveryTimeSeconds: number | null;
  selectedRoutes: ShiftScheduleSelectedRoute[];
}): string {
  const routes = sortSelectedRoutesByExecutionOrder(input.selectedRoutes).map((route) => ({
    routeId: route.routeId,
    executionOrder: route.executionOrder,
    avgTravelTimeSeconds: route.avgTravelTimeSeconds,
    minTravelTimeSeconds: route.minTravelTimeSeconds,
    switchBufferAfterSeconds: normalizeSwitchBufferAfterSeconds(route.switchBufferAfterSeconds),
    dwellSlackPercent: normalizeDwellSlackPercent(route.dwellSlackPercent),
    stationDwells: route.stationDwells.map((dwell) => ({
      stationId: dwell.stationId,
      dwellSeconds: dwell.dwellSeconds,
    })),
  }));
  return JSON.stringify({
    minimumRecoveryTimeSeconds: input.minimumRecoveryTimeSeconds != null
      ? normalizeMinimumRecoveryTimeSeconds(input.minimumRecoveryTimeSeconds)
      : null,
    routes,
  });
}
