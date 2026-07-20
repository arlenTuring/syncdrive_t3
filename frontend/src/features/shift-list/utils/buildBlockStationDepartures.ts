import type { ShiftScheduleSelectedRoute } from '../types/create';
import {
  applyDwellSlackSeconds,
  normalizeDwellSlackSeconds,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  STATION_ARRIVAL_MAX_AVG_STRETCH,
  isClockAlignedSeconds,
  snapDownToClockAlignSeconds,
  snapUpToClockAlignSeconds,
} from './schedule-engine/physics';
import type { GeneratedScheduleBlock } from './schedule-engine/types';
import { minuteToSecond, secondToMinute } from './schedule-engine/types';
import {
  resolveLegTravelSecondsForBudget,
  type ShiftScheduleStationLegTravel,
} from './stationLegTravel';

export type BlockStationStopTime = {
  order: number;
  stationId: string;
  stationName: string;
  /** 該站有效停靠秒數（含靠站緩衝） */
  dwellSeconds: number;
  /**
   * 抵達時刻（自 00:00 起的分鐘，可含小數）。
   * 首站＝班次卡開始（進站／開始靠站）；其後各站＝前站出發＋站間行駛。
   * 約束：對齊 10 秒格（例 00:30:20、12:00:10）。
   */
  arrivalMinute: number;
  /**
   * 出發時刻（自 00:00 起的分鐘，可含小數）。
   * 定義：抵達後完成開關門等靠站動作，可離站的時刻（= 抵達 + 有效停靠）。
   */
  departureMinute: number;
  /** 離本站出發後至下一站抵達的行駛秒數；末站為 null */
  travelToNextSeconds: number | null;
};

/** @deprecated 使用 BlockStationStopTime */
export type BlockStationDeparture = BlockStationStopTime;

function resolveLegBounds(
  legs: ShiftScheduleStationLegTravel[] | null | undefined,
  legIndex: number,
  preferredTravel: number,
): { minTravel: number; avgTravel: number; maxTravel: number } {
  const leg = legs?.[legIndex];
  const avgTravel =
    leg != null && Number.isFinite(leg.avgTravelTimeSeconds) && leg.avgTravelTimeSeconds > 0
      ? leg.avgTravelTimeSeconds
      : Math.max(0, preferredTravel);
  const minTravel =
    leg != null && Number.isFinite(leg.minTravelTimeSeconds) && leg.minTravelTimeSeconds >= 0
      ? Math.min(leg.minTravelTimeSeconds, avgTravel)
      : 0;
  // 可比平均慢，但最多約 1.3 倍；至少多留一格 10 秒供對齊
  const maxTravel = Math.max(
    avgTravel,
    avgTravel * STATION_ARRIVAL_MAX_AVG_STRETCH,
    avgTravel + SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
    preferredTravel,
  );
  return { minTravel, avgTravel, maxTravel };
}

/**
 * 選定下一站抵達秒數：優先貼近預算分配，向上對齊 10 秒格；
 * 不低於最快行駛，不高於平均放寬上限（物理最快優先於放寬上限）。
 */
export function resolveClockAlignedArrivalSecond(args: {
  departureSecond: number;
  preferredTravelSeconds: number;
  minTravelSeconds: number;
  maxTravelSeconds: number;
}): number {
  const {
    departureSecond,
    preferredTravelSeconds,
    minTravelSeconds,
    maxTravelSeconds,
  } = args;
  const earliest = departureSecond + Math.max(0, minTravelSeconds);
  const latest = departureSecond + Math.max(Math.max(0, minTravelSeconds), maxTravelSeconds);
  const preferred = departureSecond + Math.max(0, preferredTravelSeconds);

  let arrival = snapUpToClockAlignSeconds(preferred);
  if (arrival < earliest) {
    arrival = snapUpToClockAlignSeconds(earliest);
  }
  if (arrival > latest) {
    const snappedDown = snapDownToClockAlignSeconds(latest);
    if (snappedDown >= earliest && isClockAlignedSeconds(snappedDown)) {
      arrival = snappedDown;
    } else {
      // 最快物理需求已超過放寬上限：仍對齊最快可行格，寧可略慢也不破壞最快下限
      arrival = snapUpToClockAlignSeconds(earliest);
    }
  }
  return arrival;
}

/**
 * 依班次卡與路線站序，推算各站抵達／出發時刻。
 *
 * 模型（與佔用時間 = 行駛 + 各站停靠 一致）：
 * - 每站皆有抵達與出發（含首站：先抵達再開門作業後出發）
 * - 出發 = 抵達 + 該站有效停靠（含開關門緩衝）
 * - 站間行駛：優先依拓撲站間時間比例分配班次實際行駛秒數；缺 leg 時均分
 * - **到站時刻對齊 10 秒格**；可比拓撲平均略慢（≤ 1.3×）以利班距，但不可誇張拖延
 */
export function buildBlockStationDepartures(
  block: GeneratedScheduleBlock,
  route: ShiftScheduleSelectedRoute | null | undefined,
): BlockStationStopTime[] {
  if (!route || route.stationDwells.length === 0) return [];

  const slackSeconds = normalizeDwellSlackSeconds(route.dwellSlackSeconds);
  const dwells = route.stationDwells.map((station) =>
    applyDwellSlackSeconds(Math.max(0, station.dwellSeconds ?? 0), slackSeconds),
  );
  const dwellTotal = dwells.reduce((sum, value) => sum + value, 0);
  const durationSeconds = Math.max(
    0,
    minuteToSecond(block.plannedEndMinute) - minuteToSecond(block.plannedStartMinute),
  );
  const legCount = Math.max(0, route.stationDwells.length - 1);
  const travelBudget = Math.max(0, durationSeconds - dwellTotal);
  const stationIds = route.stationDwells.map((station) => station.stationId);
  const preferredLegs = resolveLegTravelSecondsForBudget({
    stationIds,
    legs: route.stationLegTravels,
    travelBudgetSeconds: travelBudget,
  });

  const startSecond = snapUpToClockAlignSeconds(minuteToSecond(block.plannedStartMinute));
  const draft: Array<{
    order: number;
    stationId: string;
    stationName: string;
    dwellSeconds: number;
    arrivalSecond: number;
    departureSecond: number;
  }> = [];

  let nextArrivalSecond = startSecond;
  for (const [index, station] of route.stationDwells.entries()) {
    const dwellSeconds = dwells[index] ?? 0;
    const arrivalSecond = nextArrivalSecond;
    const departureSecond = arrivalSecond + dwellSeconds;
    draft.push({
      order: index + 1,
      stationId: station.stationId,
      stationName: station.stationName || station.stationId,
      dwellSeconds,
      arrivalSecond,
      departureSecond,
    });
    if (index < legCount) {
      const preferred = preferredLegs[index] ?? 0;
      const { minTravel, maxTravel } = resolveLegBounds(
        route.stationLegTravels,
        index,
        preferred,
      );
      nextArrivalSecond = resolveClockAlignedArrivalSecond({
        departureSecond,
        preferredTravelSeconds: preferred,
        minTravelSeconds: minTravel,
        maxTravelSeconds: maxTravel,
      });
    }
  }

  return draft.map((stop, index) => {
    const travelToNextSeconds =
      index < draft.length - 1
        ? Math.max(0, draft[index + 1]!.arrivalSecond - stop.departureSecond)
        : null;
    return {
      order: stop.order,
      stationId: stop.stationId,
      stationName: stop.stationName,
      dwellSeconds: stop.dwellSeconds,
      arrivalMinute: secondToMinute(stop.arrivalSecond),
      departureMinute: secondToMinute(stop.departureSecond),
      travelToNextSeconds,
    };
  });
}

export function resolveRouteForBlock(
  block: GeneratedScheduleBlock,
  selectedRoutes: ShiftScheduleSelectedRoute[] | null | undefined,
): ShiftScheduleSelectedRoute | null {
  if (!selectedRoutes?.length) return null;
  if (block.routeId) {
    const byId = selectedRoutes.find((route) => route.routeId === block.routeId);
    if (byId) return byId;
  }
  if (block.routeName) {
    const byName = selectedRoutes.find((route) => route.routeName === block.routeName);
    if (byName) return byName;
  }
  return null;
}
