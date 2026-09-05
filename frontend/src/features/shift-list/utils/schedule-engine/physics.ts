import i18n from '../../../../i18n';
import type {
  ShiftScheduleSelectedRoute,
  ShiftScheduleStationDwell,
} from '../../types/create';
import {
  resolveEffectiveRouteTravelSeconds,
  resolveLegTravelSecondsForBudget,
} from '../stationLegTravel';

/** 預設路線切換緩衝（秒） */
export const SHIFT_SCHEDULE_DEFAULT_SWITCH_BUFFER_SECONDS = 0;

/** 預設靠站緩衝（秒）：加到各站停靠時間 */
export const SHIFT_SCHEDULE_DEFAULT_DWELL_SLACK_SECONDS = 0;

/** 整點對齊格位（秒）：計畫時刻須落在此格位上 */
export const SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS = 10;

/** 預設恢復時間（秒）：同一 timeline 兩趟正線之間至少保留的可吸收延誤空檔 */
export const SHIFT_SCHEDULE_DEFAULT_RECOVERY_TIME_SECONDS = 30;

/**
 * 預設碰撞保護時間（秒）。
 *
 * 意義：A 車從某站位發車後，要多久才確定已經駛離「會互相碰撞的那一段空間」。
 * 反過來看，B 車也要花同樣的時間，才能從那一段空間的外緣開進站位。
 * 所以兩台車在同一個站位的最小間隔是<strong>兩倍</strong>這個值：
 *
 *   B 車到站時刻 ≥ A 車實際離站時刻 + 2 × 碰撞保護時間
 *
 * 「A 車實際離站時刻」是排班上真的開走的那一刻——A 車如果因為調度關係要在
 * 站上滯留到下一個任務才走，就以那個滯留結束時刻為準，不是它跑完這一趟的時刻。
 *
 * 這是<strong>防碰撞下限</strong>，不是拉近班距的目標；班距約束照舊，兩者取較嚴的。
 */
export const SHIFT_SCHEDULE_DEFAULT_COLLISION_PROTECTION_SECONDS = 30;

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

export function normalizeCollisionProtectionSeconds(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return SHIFT_SCHEDULE_DEFAULT_COLLISION_PROTECTION_SECONDS;
  }
  return Math.round(raw);
}

/** 單站有效停靠秒數（含固定靠站緩衝秒數）；秒數≤0 時不加緩衝 */
export function applyDwellSlackSeconds(dwellSeconds: number, slackSeconds: number): number {
  const slack = normalizeDwellSlackSeconds(slackSeconds);
  if (dwellSeconds <= 0) return 0;
  return Math.round(dwellSeconds) + slack;
}

export function resolveStationDwellMode(
  dwell: Pick<ShiftScheduleStationDwell, 'dwellMode'>,
): NonNullable<ShiftScheduleStationDwell['dwellMode']> | 'seconds' {
  if (dwell.dwellMode === 'no_stop' || dwell.dwellMode === 'line_change') {
    return dwell.dwellMode;
  }
  return 'seconds';
}

/** 不停靠／換線停靠：實際 0 秒且不加靠站緩衝 */
export function stationDwellSkipsSlack(dwell: ShiftScheduleStationDwell): boolean {
  if (!isStationDwellRequired(dwell)) return true;
  const mode = resolveStationDwellMode(dwell);
  return mode === 'no_stop' || mode === 'line_change';
}

/** 單站有效停靠（含緩衝規則）；首站／途經／不停靠／換線停靠皆為 0 */
export function applyStationDwellWithSlack(
  dwell: ShiftScheduleStationDwell,
  dwellSlackSeconds: number,
  index?: number,
): number {
  if (index === 0) return 0;
  if (!isStationDwellRequired(dwell)) return 0;
  if (stationDwellSkipsSlack(dwell)) return 0;
  const seconds = dwell.dwellSeconds;
  if (seconds == null || seconds <= 0) return 0;
  return applyDwellSlackSeconds(seconds, dwellSlackSeconds);
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
  for (const [index, dwell] of dwells.entries()) {
    if (index === 0 || !isStationDwellRequired(dwell)) {
      continue;
    }
    const mode = resolveStationDwellMode(dwell);
    if (mode === 'no_stop' || mode === 'line_change') {
      continue;
    }
    if (dwell.dwellSeconds == null || dwell.dwellSeconds <= 0) return null;
    total += dwell.dwellSeconds;
  }
  return total;
}

/** 各站停靠加總（含路線靠站緩衝秒數；不停靠／換線停靠不加緩衝） */
export function sumStationDwellSecondsWithSlack(
  dwells: ShiftScheduleStationDwell[],
  dwellSlackSeconds: number,
): number | null {
  if (dwells.length === 0) return 0;
  let total = 0;
  for (const [index, dwell] of dwells.entries()) {
    if (index === 0 || !isStationDwellRequired(dwell)) {
      continue;
    }
    const mode = resolveStationDwellMode(dwell);
    if (mode === 'no_stop' || mode === 'line_change') {
      continue;
    }
    if (dwell.dwellSeconds == null || dwell.dwellSeconds <= 0) return null;
    total += applyDwellSlackSeconds(dwell.dwellSeconds, dwellSlackSeconds);
  }
  return total;
}

/**
 * 預設虛擬渡線端點代號（xo_N_a / xo_N_b）。
 * 自訂代號請在草稿寫入 dwellRequired: false（目錄載入時會標註）。
 */
export function looksLikeDefaultCrossoverPortalStationId(stationId: string): boolean {
  return /^xo_\d+_[ab]$/i.test(stationId.trim());
}

/** 路線起點站（站序第一站） */
export function resolveRouteOriginStationId(
  route: Pick<ShiftScheduleSelectedRoute, 'stationIds' | 'stationDwells'>,
): string | null {
  const fromIds = route.stationIds[0]?.trim();
  if (fromIds) return fromIds;
  const fromDwell = route.stationDwells[0]?.stationId?.trim();
  return fromDwell || null;
}

/** 路線終點站（站序最後一站） */
export function resolveRouteTerminalStationId(
  route: Pick<ShiftScheduleSelectedRoute, 'stationIds' | 'stationDwells'>,
): string | null {
  if (route.stationIds.length > 0) {
    const last = route.stationIds[route.stationIds.length - 1]?.trim();
    if (last) return last;
  }
  if (route.stationDwells.length > 0) {
    const last = route.stationDwells[route.stationDwells.length - 1]?.stationId?.trim();
    if (last) return last;
  }
  return null;
}

/**
 * 兩路是否在同一站折返接續（前路終點＝後路起點）。
 * 此情形關節站只有一次抵達／出發；中間不得再塞換線空檔造成第二個出發時刻。
 */
export function routesShareTurnaroundStation(
  previousRoute: Pick<ShiftScheduleSelectedRoute, 'stationIds' | 'stationDwells'>,
  nextRoute: Pick<ShiftScheduleSelectedRoute, 'stationIds' | 'stationDwells'>,
): boolean {
  const terminal = resolveRouteTerminalStationId(previousRoute);
  const origin = resolveRouteOriginStationId(nextRoute);
  return Boolean(terminal && origin && terminal === origin);
}

/** 是否需填寫停靠時間（首站／虛擬渡線端點為 false） */
export function isStationDwellRequired(dwell: ShiftScheduleStationDwell): boolean {
  if (dwell.dwellRequired === false) return false;
  if (dwell.dwellRequired === true) return true;
  return !looksLikeDefaultCrossoverPortalStationId(dwell.stationId);
}

/** 站序列 UI 角色：首站／途經僅標示，其餘可編輯停靠 */
export function resolveStationDwellListRole(
  dwell: ShiftScheduleStationDwell,
  index: number,
): 'origin' | 'pass_through' | 'editable' {
  if (index === 0) return 'origin';
  if (!isStationDwellRequired(dwell)) return 'pass_through';
  return 'editable';
}

export function formatStationDwellRoleLabel(
  role: ReturnType<typeof resolveStationDwellListRole>,
): string {
  if (role === 'origin') return i18n.t('shiftList.manualSidebar.roleOrigin');
  if (role === 'pass_through') return i18n.t('shiftList.manualSidebar.rolePassThrough');
  return i18n.t('shiftList.manualSidebar.roleStop');
}

export function isStationDwellEntryComplete(dwell: ShiftScheduleStationDwell): boolean {
  if (!isStationDwellRequired(dwell)) return true;
  const mode = resolveStationDwellMode(dwell);
  if (mode === 'no_stop' || mode === 'line_change') return true;
  return dwell.dwellSeconds != null && dwell.dwellSeconds > 0;
}

export function areStationDwellsComplete(dwells: ShiftScheduleStationDwell[]): boolean {
  const required = dwells.filter((d, index) => index > 0 && isStationDwellRequired(d));
  if (required.length === 0) return dwells.length > 0;
  return required.every((d) => isStationDwellEntryComplete(d));
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
  const ordered = sortSelectedRoutesByExecutionOrder(
    routes.filter((route) => !route.backupForInstanceId && !route.backupForRouteId),
  );
  if (ordered.length === 0) return null;
  const index = ordered.findIndex((route) => route.routeId === routeId);
  if (index < 0) return null;
  return ordered[(index + 1) % ordered.length] ?? null;
}

/**
 * 正線占用（秒）：
 * - **均**＝平常參考（預設計畫占用，向下對齊 10 秒格）
 * - **快**＝物理下限（PPHPD／班距脈衝趕不上時，可壓到此值補班）
 *
 * 平常用均；只有運能／班距不足才往快壓縮，不把運行時間墊到均之上。
 */
export function resolvePassengerRouteOccupancy(route: ShiftScheduleSelectedRoute): {
  travelSeconds: number;
  dwellSeconds: number;
  /** 預設占用（均） */
  occupancySeconds: number;
  /** 最快占用（快） */
  minOccupancySeconds: number;
} | null {
  const travel = resolveEffectiveRouteTravelSeconds(route);
  const avgTravel =
    travel?.avgTravelTimeSeconds ?? route.avgTravelTimeSeconds ?? 0;
  const minTravel =
    travel?.minTravelTimeSeconds
    ?? route.minTravelTimeSeconds
    ?? avgTravel;
  const dwellSeconds = sumStationDwellSecondsWithSlack(
    route.stationDwells,
    route.dwellSlackSeconds,
  );
  if (avgTravel <= 0 || dwellSeconds == null) return null;
  // 逐站時刻會把各 leg 最快時間對齊 10 秒格；路線級 minTravel 加總常偏短，
  // 占用下限須至少涵蓋對齊後的站間預算，否則會 STATION_TIMING_INFEASIBLE。
  const alignedMinTravel = resolveStationAlignedMinTravelSeconds(route);
  const effectiveMinTravel = Math.max(minTravel, alignedMinTravel ?? 0);
  const minOccupancySeconds = snapUpToClockAlignSeconds(
    effectiveMinTravel + dwellSeconds,
  );
  const avgOccupancySeconds = snapDownToClockAlignSeconds(avgTravel + dwellSeconds);
  return {
    travelSeconds: avgTravel,
    dwellSeconds,
    // 資料異常（最快格＞平均格）時以物理最快為準
    occupancySeconds:
      avgOccupancySeconds >= minOccupancySeconds
        ? avgOccupancySeconds
        : minOccupancySeconds,
    minOccupancySeconds,
  };
}

/**
 * 與 buildBlockStationDepartures 相同的「逐站最快行駛、對齊 10 秒格」加總。
 * 無完整站序時回 null，呼叫端退回路線級 minTravel。
 */
export function resolveStationAlignedMinTravelSeconds(
  route: ShiftScheduleSelectedRoute,
): number | null {
  const stations = route.stationDwells;
  if (!stations || stations.length < 2) return null;
  const slack = normalizeDwellSlackSeconds(route.dwellSlackSeconds);
  const dwells = stations.map((station, index) =>
    applyStationDwellWithSlack(station, slack, index),
  );
  const stationIds = stations.map((station) => station.stationId);
  const legCount = stations.length - 1;
  const fallbackMinLegs = resolveLegTravelSecondsForBudget({
    stationIds,
    legs: route.stationLegTravels,
    travelBudgetSeconds: Math.max(0, route.minTravelTimeSeconds ?? 0),
  });
  let total = 0;
  for (let index = 0; index < legCount; index += 1) {
    const leg = route.stationLegTravels?.[index];
    const preferred = fallbackMinLegs[index] ?? 0;
    const minTravel =
      leg != null && Number.isFinite(leg.minTravelTimeSeconds) && leg.minTravelTimeSeconds >= 0
        ? leg.minTravelTimeSeconds
        : Math.max(0, preferred);
    const departureOffset = dwells[index] ?? 0;
    const minAligned =
      snapUpToClockAlignSeconds(departureOffset + minTravel) - departureOffset;
    total += Math.max(0, minAligned);
  }
  return total;
}

/**
 * 在 [快, 均] 之間取占用：target 落在區間內則對齊格位夾住；
 * 小於快→快；大於均→均。供趕班距／補運能時漸進壓縮。
 */
export function resolveOccupancyClampedToTravelBounds(
  route: ShiftScheduleSelectedRoute,
  targetSeconds: number,
): number | null {
  const occ = resolvePassengerRouteOccupancy(route);
  if (!occ) return null;
  const lo = occ.minOccupancySeconds;
  const hi = occ.occupancySeconds;
  if (targetSeconds <= lo) return lo;
  if (targetSeconds >= hi) return hi;
  // 目標落在中間：向下取格且不低於快
  return Math.max(lo, snapDownToClockAlignSeconds(targetSeconds));
}

/**
 * 換線時是否應計入最低恢復。
 * - 執行順序環上中段繼任：否（與 Step 4「均」只計一次恢復一致）
 * - 折返繞回／非環上繼任：是
 */
export function shouldIncludeRecoveryForRouteSwitch(args: {
  previousRoute: Pick<ShiftScheduleSelectedRoute, 'routeId' | 'executionOrder'>;
  nextRoute: Pick<ShiftScheduleSelectedRoute, 'routeId' | 'executionOrder'>;
  rotationRoutes: Array<Pick<ShiftScheduleSelectedRoute, 'routeId' | 'executionOrder'>>;
}): boolean {
  if (args.previousRoute.routeId === args.nextRoute.routeId) return true;
  // rotationRoutes 在 graph 模式已是鎖定 successor chain；不可再依
  // executionOrder 重排，否則會把合法中段誤判成折返並多扣一次恢復。
  const ordered = args.rotationRoutes;
  if (ordered.length <= 1) return true;
  const prevIdx = ordered.findIndex((route) => route.routeId === args.previousRoute.routeId);
  const nextIdx = ordered.findIndex((route) => route.routeId === args.nextRoute.routeId);
  if (prevIdx < 0 || nextIdx < 0) return true;
  if (nextIdx === (prevIdx + 1) % ordered.length) {
    return nextIdx === 0;
  }
  return true;
}

/**
 * 同一時間線兩趟正線之間的最短空檔（秒）。
 *
 * - 同站折返接續（前路終點＝後路起點）：0（關節站只有一次出發，不另塞空檔）
 * - 同路線連續：最低恢復時間
 * - 換路線中段（導通繼任）：僅前一路線換線緩衝（與 Step 4「均」一致）
 * - 換路線折返／非繼任：最低恢復 + 換線緩衝（相加，不可取 max）
 *
 * `includeRecovery` 預設：同路線 true、換線 false；折返請傳 true
 * 或用 `shouldIncludeRecoveryForRouteSwitch`。
 */
export function resolveInterTripGapSeconds(args: {
  minimumRecoveryTimeSeconds: number;
  previousRouteSwitchBufferSeconds?: number | null;
  isRouteSwitch: boolean;
  includeRecovery?: boolean;
  /** 提供時可偵測同站折返並回傳 0 */
  previousRoute?: Pick<ShiftScheduleSelectedRoute, 'stationIds' | 'stationDwells'>;
  nextRoute?: Pick<ShiftScheduleSelectedRoute, 'stationIds' | 'stationDwells'>;
}): number {
  if (
    args.previousRoute
    && args.nextRoute
    && routesShareTurnaroundStation(args.previousRoute, args.nextRoute)
  ) {
    return 0;
  }
  const recovery = Math.max(0, Math.round(args.minimumRecoveryTimeSeconds));
  const includeRecovery = args.includeRecovery ?? !args.isRouteSwitch;
  if (!args.isRouteSwitch) return includeRecovery ? recovery : 0;
  const switchBuffer = normalizeSwitchBufferAfterSeconds(
    args.previousRouteSwitchBufferSeconds,
  );
  return (includeRecovery ? recovery : 0) + switchBuffer;
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

/** 依執行順序加總：各主路線最快一圈 + 路線切換緩衝（不含備用路線） */
export function resolveRouteRotationMinSeconds(
  routes: ShiftScheduleSelectedRoute[],
): number | null {
  const ordered = sortSelectedRoutesByExecutionOrder(
    routes.filter((route) => !route.backupForInstanceId && !route.backupForRouteId),
  );
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
  /** 改動碰撞保護時間會改變站位判定，產出必須重生成 */
  collisionProtectionSeconds?: number | null;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  routeRelationGraph?: {
    nodes: Array<{ instanceId: string; x: number; y: number }>;
    links: Array<{
      id: string;
      fromInstanceId: string;
      toInstanceId: string;
      /** priority / secondary；相容舊值 primary / backup */
      nextKind?: 'priority' | 'secondary' | 'primary' | 'backup';
    }>;
  } | null;
  throughStartStationIds?: string[];
  throughEndStationIds?: string[];
  throughAnchors?: {
    startStationIds?: string[];
    endStationIds?: string[];
    startInstanceIds?: string[];
    endInstanceIds?: string[];
  };
}): string {
  const routes = sortSelectedRoutesByExecutionOrder(input.selectedRoutes).map((route) => ({
    instanceId: route.instanceId ?? null,
    routeId: route.routeId,
    routeCode: (route.routeCode ?? '').trim().toUpperCase(),
    backupForInstanceId: route.backupForInstanceId ?? null,
    backupForRouteId: route.backupForRouteId ?? null,
    executionOrder: route.executionOrder,
    avgTravelTimeSeconds: route.avgTravelTimeSeconds,
    minTravelTimeSeconds: route.minTravelTimeSeconds,
    switchBufferAfterSeconds: normalizeSwitchBufferAfterSeconds(route.switchBufferAfterSeconds),
    dwellSlackSeconds: normalizeDwellSlackSeconds(route.dwellSlackSeconds),
    stationDwells: route.stationDwells.map((dwell) => ({
      stationId: dwell.stationId,
      dwellSeconds: dwell.dwellSeconds,
      dwellMode: resolveStationDwellMode(dwell),
      dwellRequired: isStationDwellRequired(dwell),
    })),
    stationLegTravels: route.stationLegTravels.map((leg) => ({
      fromStationId: leg.fromStationId,
      toStationId: leg.toStationId,
      avgTravelTimeSeconds: leg.avgTravelTimeSeconds,
      minTravelTimeSeconds: leg.minTravelTimeSeconds,
      distanceMeters: leg.distanceMeters ?? null,
    })),
  }));
  const relation = input.routeRelationGraph ?? { nodes: [], links: [] };
  const startStationIds =
    input.throughAnchors?.startStationIds ?? input.throughStartStationIds ?? [];
  const endStationIds =
    input.throughAnchors?.endStationIds ?? input.throughEndStationIds ?? [];
  return JSON.stringify({
    minimumRecoveryTimeSeconds: input.minimumRecoveryTimeSeconds != null
      ? normalizeMinimumRecoveryTimeSeconds(input.minimumRecoveryTimeSeconds)
      : null,
    collisionProtectionSeconds: normalizeCollisionProtectionSeconds(
      input.collisionProtectionSeconds,
    ),
    routes,
    routeRelationGraph: {
      nodes: [...relation.nodes]
        .map((node) => ({
          instanceId: node.instanceId,
          x: Math.round(node.x),
          y: Math.round(node.y),
        }))
        .sort((a, b) => a.instanceId.localeCompare(b.instanceId)),
      links: [...relation.links]
        .map((link) => ({
          id: link.id,
          fromInstanceId: link.fromInstanceId,
          toInstanceId: link.toInstanceId,
          nextKind:
            link.nextKind === 'secondary' || link.nextKind === 'backup'
              ? 'secondary'
              : 'priority',
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      throughAnchors: {
        startStationIds: [...startStationIds]
          .map((id) => id.trim())
          .filter(Boolean)
          .sort(),
        endStationIds: [...endStationIds]
          .map((id) => id.trim())
          .filter(Boolean)
          .sort(),
        startInstanceIds: [...(input.throughAnchors?.startInstanceIds ?? [])]
          .map((id) => id.trim())
          .filter(Boolean)
          .sort(),
        endInstanceIds: [...(input.throughAnchors?.endInstanceIds ?? [])]
          .map((id) => id.trim())
          .filter(Boolean)
          .sort(),
      },
    },
  });
}
