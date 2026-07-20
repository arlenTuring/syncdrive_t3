import type {
  ShiftScheduleSelectedRoute,
  ShiftScheduleStationDwell,
} from '../../types/create';
import { resolveEffectiveRouteTravelSeconds } from '../stationLegTravel';

/** 預設路線切換緩衝（秒） */
export const SHIFT_SCHEDULE_DEFAULT_SWITCH_BUFFER_SECONDS = 0;

/** 預設靠站緩衝（秒）：加到各站停靠時間 */
export const SHIFT_SCHEDULE_DEFAULT_DWELL_SLACK_SECONDS = 0;

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

export function normalizeDwellSlackSeconds(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return SHIFT_SCHEDULE_DEFAULT_DWELL_SLACK_SECONDS;
  }
  return Math.round(raw);
}

export function normalizeMinimumRecoveryTimeSeconds(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return SHIFT_SCHEDULE_DEFAULT_RECOVERY_TIME_SECONDS;
  }
  return Math.round(raw);
}

/** 單站有效停靠秒數（含固定靠站緩衝秒數） */
export function applyDwellSlackSeconds(dwellSeconds: number, slackSeconds: number): number {
  const slack = normalizeDwellSlackSeconds(slackSeconds);
  if (dwellSeconds <= 0) return 0;
  return Math.round(dwellSeconds) + slack;
}

export function snapUpToClockAlignSeconds(
  seconds: number,
  gridSeconds = SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
): number {
  if (gridSeconds <= 0) return Math.round(seconds);
  return Math.ceil(seconds / gridSeconds) * gridSeconds;
}

/** 向下對齊至 10 秒格（不大於原值） */
export function snapDownToClockAlignSeconds(
  seconds: number,
  gridSeconds = SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
): number {
  if (gridSeconds <= 0) return Math.round(seconds);
  return Math.floor(seconds / gridSeconds) * gridSeconds;
}

export function isClockAlignedSeconds(
  seconds: number,
  gridSeconds = SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
): boolean {
  if (gridSeconds <= 0) return true;
  return Math.round(seconds) % gridSeconds === 0;
}

/**
 * 站間行駛相對拓撲平均的最大放寬倍率。
 * 為維持班距可略慢於平均，但不可誇張拖延。
 */
export const STATION_ARRIVAL_MAX_AVG_STRETCH = 1.3;

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

/** 各站停靠加總（含路線靠站緩衝秒數） */
export function sumStationDwellSecondsWithSlack(
  dwells: ShiftScheduleStationDwell[],
  dwellSlackSeconds: number,
): number | null {
  if (dwells.length === 0) return 0;
  let total = 0;
  for (const dwell of dwells) {
    if (dwell.dwellSeconds == null || dwell.dwellSeconds <= 0) return null;
    total += applyDwellSlackSeconds(dwell.dwellSeconds, dwellSlackSeconds);
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
  dwellSlackSeconds = 0,
): number | null {
  if (travelSeconds == null || travelSeconds <= 0) return null;
  const dwellTotal = sumStationDwellSecondsWithSlack(dwells, dwellSlackSeconds);
  if (dwellTotal == null) return null;
  return travelSeconds + dwellTotal;
}

/** 最快一圈 + 恢復時間（與折返時限比較用） */
export function resolveRouteMinTurnaroundBudgetSeconds(
  route: ShiftScheduleSelectedRoute,
  minimumRecoveryTimeSeconds: number,
): number | null {
  const travel = resolveEffectiveRouteTravelSeconds(route);
  const cycle = resolveRouteCycleSeconds(
    travel?.minTravelTimeSeconds ?? route.minTravelTimeSeconds,
    route.stationDwells,
    route.dwellSlackSeconds,
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

/**
 * 同一時間線兩趟正線之間的最短空檔（秒）。
 *
 * - 同路線連續：僅最低恢復時間
 * - 換路線：最低恢復時間 + 前一路線的換線緩衝（兩者相加，不可取 max）
 *
 * 與 Step 4「完整循環」看板一致：恢復與切換是獨立可加項。
 */
export function resolveInterTripGapSeconds(args: {
  minimumRecoveryTimeSeconds: number;
  previousRouteSwitchBufferSeconds?: number | null;
  isRouteSwitch: boolean;
}): number {
  const recovery = Math.max(0, Math.round(args.minimumRecoveryTimeSeconds));
  if (!args.isRouteSwitch) return recovery;
  const switchBuffer = normalizeSwitchBufferAfterSeconds(
    args.previousRouteSwitchBufferSeconds,
  );
  return recovery + switchBuffer;
}

/**
 * 車隊同方向物理班距下限（秒）＝ snap↑10s(單車最短一圈／時間線數)。
 * 低於此值的同方向發車在物理上無法維持。
 */
export function resolveFleetPhysicalHeadwayFloorSeconds(
  route: ShiftScheduleSelectedRoute,
  scheduleRowCount: number,
): number {
  const minTravel =
    resolveEffectiveRouteTravelSeconds(route)?.minTravelTimeSeconds
    ?? route.minTravelTimeSeconds
    ?? route.avgTravelTimeSeconds
    ?? 0;
  const dwell =
    sumStationDwellSecondsWithSlack(route.stationDwells, route.dwellSlackSeconds) ?? 0;
  if (minTravel <= 0 || scheduleRowCount <= 0) return 0;
  const singleVehicleCycle = snapUpToClockAlignSeconds(minTravel + dwell);
  return snapUpToClockAlignSeconds(singleVehicleCycle / scheduleRowCount);
}

/** 依執行順序加總：各路線最快一圈 + 路線切換緩衝 */
export function resolveRouteRotationMinSeconds(
  routes: ShiftScheduleSelectedRoute[],
): number | null {
  const ordered = sortSelectedRoutesByExecutionOrder(routes);
  if (ordered.length === 0) return null;
  let total = 0;
  for (const route of ordered) {
    const travel = resolveEffectiveRouteTravelSeconds(route);
    const cycle = resolveRouteCycleSeconds(
      travel?.minTravelTimeSeconds ?? route.minTravelTimeSeconds,
      route.stationDwells,
      route.dwellSlackSeconds,
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
    routeCode: (route.routeCode ?? '').trim().toUpperCase(),
    executionOrder: route.executionOrder,
    avgTravelTimeSeconds: route.avgTravelTimeSeconds,
    minTravelTimeSeconds: route.minTravelTimeSeconds,
    switchBufferAfterSeconds: normalizeSwitchBufferAfterSeconds(route.switchBufferAfterSeconds),
    dwellSlackSeconds: normalizeDwellSlackSeconds(route.dwellSlackSeconds),
    stationDwells: route.stationDwells.map((dwell) => ({
      stationId: dwell.stationId,
      dwellSeconds: dwell.dwellSeconds,
    })),
    stationLegTravels: route.stationLegTravels.map((leg) => ({
      fromStationId: leg.fromStationId,
      toStationId: leg.toStationId,
      avgTravelTimeSeconds: leg.avgTravelTimeSeconds,
      minTravelTimeSeconds: leg.minTravelTimeSeconds,
      distanceMeters: leg.distanceMeters ?? null,
    })),
  }));
  return JSON.stringify({
    minimumRecoveryTimeSeconds: input.minimumRecoveryTimeSeconds != null
      ? normalizeMinimumRecoveryTimeSeconds(input.minimumRecoveryTimeSeconds)
      : null,
    routes,
  });
}
