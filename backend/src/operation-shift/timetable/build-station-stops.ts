import {
  CLOCK_ALIGN_SECONDS,
  STATION_ARRIVAL_MAX_AVG_STRETCH,
  isClockAlignedSeconds,
  minuteToSecond,
  secondToMinute,
  snapDownToClockAlignSeconds,
  snapUpToClockAlignSeconds,
} from './clock';

export type TimetableStationDwell = {
  stationId: string;
  stationName?: string;
  dwellSeconds?: number | null;
  dwellRequired?: boolean;
  dwellMode?: 'seconds' | 'no_stop' | 'line_change';
};

export type TimetableStationLegTravel = {
  fromStationId: string;
  toStationId: string;
  avgTravelTimeSeconds: number;
  minTravelTimeSeconds: number;
};

export type TimetableRoute = {
  routeId: string;
  routeName?: string;
  routeCode?: string;
  cardLabel?: string;
  stationIds: string[];
  stationDwells: TimetableStationDwell[];
  stationLegTravels: TimetableStationLegTravel[];
  avgTravelTimeSeconds?: number;
  minTravelTimeSeconds?: number;
  dwellSlackSeconds?: number;
};

export type TimetableBlock = {
  id: string;
  timelineRow: number;
  taskType: string;
  label?: string;
  routeId?: string;
  routeName?: string;
  routeCode?: string;
  plannedStartMinute: number;
  plannedEndMinute: number;
  source?: string;
  entryServiceSectionCode?: string;
  stationDwells?: TimetableStationDwell[];
  dwellSlackSeconds?: number;
};

export type TimetableStationStop = {
  order: number;
  stationId: string;
  stationName: string;
  baseDwellSeconds: number;
  dwellSeconds: number;
  arrivalSecond: number;
  departureSecond: number;
  travelToNextSeconds: number | null;
};

function normalizeDwellSlackSeconds(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.round(raw);
}

function looksLikeCrossoverPortal(stationId: string): boolean {
  return /^xo_\d+_[ab]$/i.test(stationId.trim());
}

function isStationDwellRequired(dwell: TimetableStationDwell): boolean {
  if (dwell.dwellRequired === false) return false;
  if (dwell.dwellRequired === true) return true;
  return !looksLikeCrossoverPortal(dwell.stationId);
}

function resolveStationDwellMode(
  dwell: TimetableStationDwell,
): 'seconds' | 'no_stop' | 'line_change' {
  if (dwell.dwellMode === 'no_stop' || dwell.dwellMode === 'line_change') {
    return dwell.dwellMode;
  }
  return 'seconds';
}

function applyStationDwellWithSlack(
  dwell: TimetableStationDwell,
  dwellSlackSeconds: number,
  index: number,
): number {
  if (index === 0) return 0;
  if (!isStationDwellRequired(dwell)) return 0;
  const mode = resolveStationDwellMode(dwell);
  if (mode === 'no_stop' || mode === 'line_change') return 0;
  const seconds = dwell.dwellSeconds;
  if (seconds == null || seconds <= 0) return 0;
  const slack = normalizeDwellSlackSeconds(dwellSlackSeconds);
  return Math.round(seconds) + slack;
}

function areStationLegTravelsComplete(
  stationIds: string[],
  legs: TimetableStationLegTravel[] | null | undefined,
): boolean {
  const expected = Math.max(0, stationIds.length - 1);
  if (expected === 0) return true;
  if (!legs || legs.length !== expected) return false;
  for (let i = 0; i < expected; i += 1) {
    const leg = legs[i]!;
    if (leg.fromStationId !== stationIds[i] || leg.toStationId !== stationIds[i + 1]) {
      return false;
    }
    if (
      !Number.isFinite(leg.avgTravelTimeSeconds)
      || leg.avgTravelTimeSeconds < 0
      || !Number.isFinite(leg.minTravelTimeSeconds)
      || leg.minTravelTimeSeconds < 0
      || leg.minTravelTimeSeconds > leg.avgTravelTimeSeconds
    ) {
      return false;
    }
  }
  return true;
}

function resolveLegTravelSecondsForBudget(args: {
  stationIds: string[];
  legs: TimetableStationLegTravel[] | null | undefined;
  travelBudgetSeconds: number;
}): number[] {
  const { stationIds, legs, travelBudgetSeconds } = args;
  const legCount = Math.max(0, stationIds.length - 1);
  if (legCount === 0) return [];
  const budget = Math.max(0, travelBudgetSeconds);
  if (areStationLegTravelsComplete(stationIds, legs) && legs && legs.length === legCount) {
    const weights = legs.map((leg) => Math.max(0, leg.avgTravelTimeSeconds));
    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    if (weightSum > 0) {
      const raw = weights.map((weight) => (budget * weight) / weightSum);
      const allocated: number[] = [];
      let used = 0;
      for (let i = 0; i < legCount; i += 1) {
        if (i === legCount - 1) {
          allocated.push(Math.max(0, budget - used));
        } else {
          allocated.push(raw[i]!);
          used += raw[i]!;
        }
      }
      return allocated;
    }
  }
  const equal = budget / legCount;
  return Array.from({ length: legCount }, () => equal);
}

function resolveLegBounds(
  legs: TimetableStationLegTravel[] | null | undefined,
  legIndex: number,
  preferredTravel: number,
  fallbackMinTravel: number,
): { minTravel: number; avgTravel: number; maxTravel: number } {
  const leg = legs?.[legIndex];
  const avgTravel =
    leg != null && Number.isFinite(leg.avgTravelTimeSeconds) && leg.avgTravelTimeSeconds > 0
      ? leg.avgTravelTimeSeconds
      : Math.max(0, preferredTravel);
  const minTravel =
    leg != null && Number.isFinite(leg.minTravelTimeSeconds) && leg.minTravelTimeSeconds >= 0
      ? leg.minTravelTimeSeconds
      : Math.max(0, fallbackMinTravel);
  const maxTravel = Math.max(
    avgTravel,
    avgTravel * STATION_ARRIVAL_MAX_AVG_STRETCH,
    avgTravel + CLOCK_ALIGN_SECONDS,
    preferredTravel,
  );
  return { minTravel, avgTravel, maxTravel };
}

function resolveBlockStationDwellInputs(
  block: TimetableBlock,
  route: TimetableRoute | null | undefined,
): { stations: TimetableStationDwell[]; dwellSlackSeconds: number } | null {
  if (block.stationDwells && block.stationDwells.length > 0) {
    return {
      stations: block.stationDwells.map((station) => ({ ...station })),
      dwellSlackSeconds: normalizeDwellSlackSeconds(block.dwellSlackSeconds ?? 0),
    };
  }
  if (!route || route.stationDwells.length === 0) return null;
  return {
    stations: route.stationDwells.map((station) => ({ ...station })),
    dwellSlackSeconds: normalizeDwellSlackSeconds(route.dwellSlackSeconds ?? 0),
  };
}

/**
 * 與前端 `buildBlockStationDepartures` 相同模型：
 * 首站靠站 0；卡尾零頭併入末站；出發／靠站完成對齊卡起迄。
 */
export function buildTimetableStationStops(
  block: TimetableBlock,
  route: TimetableRoute | null | undefined,
): TimetableStationStop[] {
  const dwellInputs = resolveBlockStationDwellInputs(block, route);
  if (!dwellInputs) return [];

  const { stations, dwellSlackSeconds: slackSeconds } = dwellInputs;
  const baseDwells = stations.map((station) => {
    const mode = resolveStationDwellMode(station);
    if (mode === 'no_stop' || mode === 'line_change') return 0;
    return Math.max(0, station.dwellSeconds ?? 0);
  });
  const dwells = stations.map((station, index) =>
    applyStationDwellWithSlack(station, slackSeconds, index),
  );
  const dwellTotal = dwells.reduce((sum, value) => sum + value, 0);
  const startSecond = snapUpToClockAlignSeconds(minuteToSecond(block.plannedStartMinute));
  const endSecond = minuteToSecond(block.plannedEndMinute);
  const availableTravelSeconds = endSecond - startSecond - dwellTotal;
  const legCount = Math.max(0, stations.length - 1);
  const stationIds = stations.map((station) => station.stationId);
  const preferredLegs = resolveLegTravelSecondsForBudget({
    stationIds,
    legs: route?.stationLegTravels,
    travelBudgetSeconds: Math.max(0, availableTravelSeconds),
  });
  const fallbackMinLegs = resolveLegTravelSecondsForBudget({
    stationIds,
    legs: route?.stationLegTravels,
    travelBudgetSeconds: Math.max(0, route?.minTravelTimeSeconds ?? 0),
  });

  const bounds = Array.from({ length: legCount }, (_, index) => {
    const preferred = preferredLegs[index] ?? 0;
    const { minTravel, maxTravel } = resolveLegBounds(
      route?.stationLegTravels,
      index,
      preferred,
      fallbackMinLegs[index] ?? 0,
    );
    const departureOffset = dwells[index] ?? 0;
    const minAligned =
      snapUpToClockAlignSeconds(departureOffset + minTravel) - departureOffset;
    const maxAligned =
      snapDownToClockAlignSeconds(departureOffset + Math.max(minTravel, maxTravel))
      - departureOffset;
    return {
      preferred,
      minTravel: minAligned,
      maxTravel: Math.max(minAligned, maxAligned),
    };
  });
  const minRequiredTravelSeconds = bounds.reduce((sum, bound) => sum + bound.minTravel, 0);

  if (endSecond < startSecond || availableTravelSeconds < minRequiredTravelSeconds) {
    return [];
  }

  const legTravelSeconds = bounds.map((bound) => bound.minTravel);
  const maxTravelSeconds = bounds.reduce((sum, bound) => sum + bound.maxTravel, 0);
  const targetTravelSeconds =
    minRequiredTravelSeconds
    + Math.floor(
      (Math.min(availableTravelSeconds, maxTravelSeconds) - minRequiredTravelSeconds)
      / CLOCK_ALIGN_SECONDS,
    ) * CLOCK_ALIGN_SECONDS;
  let remaining = targetTravelSeconds - minRequiredTravelSeconds;

  while (remaining >= CLOCK_ALIGN_SECONDS) {
    let bestIndex = -1;
    let bestImprovement = Number.NEGATIVE_INFINITY;
    for (const [index, bound] of bounds.entries()) {
      const current = legTravelSeconds[index]!;
      if (current + CLOCK_ALIGN_SECONDS > bound.maxTravel) continue;
      const improvement =
        Math.abs(current - bound.preferred)
        - Math.abs(current + CLOCK_ALIGN_SECONDS - bound.preferred);
      if (improvement > bestImprovement) {
        bestImprovement = improvement;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    legTravelSeconds[bestIndex] =
      legTravelSeconds[bestIndex]! + CLOCK_ALIGN_SECONDS;
    remaining -= CLOCK_ALIGN_SECONDS;
  }

  const draft: TimetableStationStop[] = [];
  let nextArrivalSecond = startSecond;
  for (const [index, station] of stations.entries()) {
    const arrivalSecond = nextArrivalSecond;
    const dwellSeconds = dwells[index] ?? 0;
    const departureSecond = arrivalSecond + dwellSeconds;
    draft.push({
      order: index + 1,
      stationId: station.stationId,
      stationName: station.stationName || station.stationId,
      baseDwellSeconds: baseDwells[index] ?? 0,
      dwellSeconds,
      arrivalSecond,
      departureSecond,
      travelToNextSeconds: null,
    });
    if (index < legCount) {
      nextArrivalSecond = departureSecond + legTravelSeconds[index]!;
    }
  }

  const last = draft[draft.length - 1];
  if (last && last.departureSecond < endSecond) {
    last.departureSecond = endSecond;
    last.dwellSeconds = Math.max(0, endSecond - last.arrivalSecond);
  }

  for (let index = 0; index < draft.length - 1; index += 1) {
    draft[index]!.travelToNextSeconds = Math.max(
      0,
      draft[index + 1]!.arrivalSecond - draft[index]!.departureSecond,
    );
  }

  // 確保到站在 10 秒格（配置過程已對齊；防禦性檢查）
  for (const stop of draft) {
    if (!isClockAlignedSeconds(stop.arrivalSecond)) {
      stop.arrivalSecond = snapUpToClockAlignSeconds(stop.arrivalSecond);
    }
  }

  return draft;
}

export function resolveRouteForBlock(
  block: TimetableBlock,
  routes: TimetableRoute[],
): TimetableRoute | null {
  if (!routes.length) return null;
  if (block.routeId) {
    const byId = routes.find((route) => route.routeId === block.routeId);
    if (byId) return byId;
  }
  if (block.routeName) {
    const byName = routes.find((route) => route.routeName === block.routeName);
    if (byName) return byName;
  }
  return null;
}

/** 供擴充測試：秒 ↔ 分鐘 */
export { secondToMinute, minuteToSecond };
