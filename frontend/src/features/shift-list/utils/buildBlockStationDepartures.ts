import type {
  ShiftScheduleSelectedRoute,
  ShiftScheduleStationDwell,
} from '../types/create';
import { resolveSelectedRouteInstanceId } from '../types/create';
import {
  applyStationDwellWithSlack,
  normalizeDwellSlackSeconds,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  STATION_ARRIVAL_MAX_AVG_STRETCH,
  isClockAlignedSeconds,
  resolveStationDwellMode,
  snapDownToClockAlignSeconds,
  snapUpToClockAlignSeconds,
} from './schedule-engine/physics';
import { routeForJoinedBlock } from './joinedRouteSegment';
import type { GeneratedScheduleBlock } from './schedule-engine/types';
import { minuteToSecond, secondToMinute } from './schedule-engine/types';
import {
  resolveEffectiveRouteTravelSeconds,
  resolveLegTravelSecondsForBudget,
  type ShiftScheduleStationLegTravel,
} from './stationLegTravel';

export type BlockStationStopTime = {
  order: number;
  stationId: string;
  stationName: string;
  /** 該站設定的靠站秒數（不含緩衝） */
  baseDwellSeconds: number;
  /** 該站有效停靠秒數（靠站 + 緩衝；停靠為 0 時不加緩衝） */
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
  // 可比平均慢，但最多約 1.3 倍；至少多留一格 10 秒供對齊
  const maxTravel = Math.max(
    avgTravel,
    avgTravel * STATION_ARRIVAL_MAX_AVG_STRETCH,
    avgTravel + SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
    preferredTravel,
  );
  return { minTravel, avgTravel, maxTravel };
}

export type BlockStationDepartureFeasibility =
  | {
      feasible: true;
      availableTravelSeconds: number;
      minRequiredTravelSeconds: number;
      allocatedTravelSeconds: number;
    }
  | {
      feasible: false;
      reason: 'block_ends_before_aligned_start' | 'insufficient_travel_budget';
      availableTravelSeconds: number;
      minRequiredTravelSeconds: number;
      shortfallSeconds: number;
    };

type BlockStationTimingPlan = {
  feasibility: BlockStationDepartureFeasibility;
  stations: ShiftScheduleStationDwell[];
  baseDwells: number[];
  dwells: number[];
  startSecond: number;
  legTravelSeconds: number[];
  /** 各段放寬上限加總（對齊後） */
  maxTravelSeconds: number;
};

function resolveBlockStationTimingPlan(
  block: GeneratedScheduleBlock,
  route: ShiftScheduleSelectedRoute | null | undefined,
): BlockStationTimingPlan | null {
  route = routeForJoinedBlock(block, route);
  const dwellInputs = resolveBlockStationDwellInputs(block, route);
  if (!dwellInputs) return null;

  const { stations, dwellSlackSeconds: slackSeconds } = dwellInputs;
  const baseDwells = stations.map((station) => {
    const mode = resolveStationDwellMode(station);
    if (mode === 'no_stop' || mode === 'line_change') return 0;
    return Math.max(0, station.dwellSeconds ?? 0);
  });
  const extraDwells = resolveBlockStationExtraDwellSeconds(block, stations);
  const dwells = stations.map((station, index) =>
    applyStationDwellWithSlack(station, slackSeconds, index) + (extraDwells[index] ?? 0),
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
    // arrival 必須在 10 秒格；前站 arrival 已對齊，因此每段可用 travel
    // 只會相差整格。把物理上下限轉成實際可配置的格位。
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
  const minRequiredTravelSeconds = bounds.reduce(
    (sum, bound) => sum + bound.minTravel,
    0,
  );
  const maxTravelSeconds = bounds.reduce((sum, bound) => sum + bound.maxTravel, 0);

  if (endSecond < startSecond) {
    return {
      feasibility: {
        feasible: false,
        reason: 'block_ends_before_aligned_start',
        availableTravelSeconds,
        minRequiredTravelSeconds,
        shortfallSeconds: startSecond - endSecond,
      },
      stations,
      baseDwells,
      dwells,
      startSecond,
      legTravelSeconds: [],
      maxTravelSeconds,
    };
  }
  if (availableTravelSeconds < minRequiredTravelSeconds) {
    return {
      feasibility: {
        feasible: false,
        reason: 'insufficient_travel_budget',
        availableTravelSeconds,
        minRequiredTravelSeconds,
        shortfallSeconds: minRequiredTravelSeconds - availableTravelSeconds,
      },
      stations,
      baseDwells,
      dwells,
      startSecond,
      legTravelSeconds: [],
      maxTravelSeconds,
    };
  }

  const legTravelSeconds = bounds.map((bound) => bound.minTravel);
  const targetTravelSeconds =
    minRequiredTravelSeconds
    + Math.floor(
      (Math.min(availableTravelSeconds, maxTravelSeconds) - minRequiredTravelSeconds)
      / SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
    ) * SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS;
  let remaining = targetTravelSeconds - minRequiredTravelSeconds;

  // 每次配置一格給「最能接近偏好值」的 leg；全域共用同一預算，
  // 避免逐站 snap↑ 各自增加秒數，最終超出 plannedEnd。
  while (remaining >= SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS) {
    let bestIndex = -1;
    let bestImprovement = Number.NEGATIVE_INFINITY;
    for (const [index, bound] of bounds.entries()) {
      const current = legTravelSeconds[index]!;
      if (current + SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS > bound.maxTravel) continue;
      const improvement =
        Math.abs(current - bound.preferred)
        - Math.abs(current + SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS - bound.preferred);
      if (improvement > bestImprovement) {
        bestImprovement = improvement;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    legTravelSeconds[bestIndex] =
      legTravelSeconds[bestIndex]! + SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS;
    remaining -= SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS;
  }

  const allocatedTravelSeconds = legTravelSeconds.reduce((sum, value) => sum + value, 0);
  return {
    feasibility: {
      feasible: true,
      availableTravelSeconds,
      minRequiredTravelSeconds,
      allocatedTravelSeconds,
    },
    stations,
    baseDwells,
    dwells,
    startSecond,
    legTravelSeconds,
    maxTravelSeconds,
  };
}

/**
 * 一趟班次卡在目前停靠設定下的<strong>合法時長</strong>（秒）。
 *
 * 最短＝各站有效停靠＋各段最快行駛（對齊 10 秒到站）；再短就塞不下。
 * 最長＝各站有效停靠＋各段平均行駛的放寬上限。候選改時刻一律拿這個判斷，不另外寫一套。
 */
export function resolveBlockDurationBounds(
  block: GeneratedScheduleBlock,
  route: ShiftScheduleSelectedRoute | null | undefined,
): { minSeconds: number; maxSeconds: number; maxTravelSeconds: number; dwellSeconds: number } | null {
  route = routeForJoinedBlock(block, route);
  const plan = resolveBlockStationTimingPlan(block, route);
  if (!plan) return null;
  const dwellSeconds = plan.dwells.reduce((sum, value) => sum + value, 0);
  /**
   * 行駛最長可以拉到多少：由<strong>路線設定的平均行駛</strong>推（各段平均 × 放寬倍率，
   * 至少多一格對齊），跟這張卡本身多長無關。逐站配置在缺站間資料時會把卡片預算當成
   * 平均，那樣卡拉多長行駛就多長，等於沒有上限——候選不能拿那個當合法範圍。
   */
  const effective = route ? resolveEffectiveRouteTravelSeconds(route) : null;
  const legCount = Math.max(0, plan.stations.length - 1);
  let legalMaxTravelSeconds = plan.maxTravelSeconds;
  if (effective && legCount > 0) {
    const avgLegs = resolveLegTravelSecondsForBudget({
      stationIds: plan.stations.map((station) => station.stationId),
      legs: route?.stationLegTravels,
      travelBudgetSeconds: effective.avgTravelTimeSeconds,
    });
    legalMaxTravelSeconds = avgLegs.reduce((sum, avg) => {
      const stretched = Math.max(avg * STATION_ARRIVAL_MAX_AVG_STRETCH, avg + SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS);
      return sum + snapDownToClockAlignSeconds(stretched);
    }, 0);
  }
  return {
    minSeconds: dwellSeconds + plan.feasibility.minRequiredTravelSeconds,
    maxSeconds: dwellSeconds + Math.max(plan.feasibility.minRequiredTravelSeconds, legalMaxTravelSeconds),
    maxTravelSeconds: legalMaxTravelSeconds,
    dwellSeconds,
  };
}

/** 檢查 block 是否容得下完整 dwell、各 leg 最快時間及 10 秒到站對齊。 */
export function resolveBlockStationDepartureFeasibility(
  block: GeneratedScheduleBlock,
  route: ShiftScheduleSelectedRoute | null | undefined,
): BlockStationDepartureFeasibility | null {
  return resolveBlockStationTimingPlan(block, route)?.feasibility ?? null;
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
 * 班次卡的靠站緩衝怎麼來的（秒）：原始設定＋系統增加＝實際採用。
 *
 * 站點設定與緩衝<strong>分開解析</strong>：單班明確給了 dwellSlackSeconds（含 0）就用單班，
 * 不管有沒有覆寫站點；沒給時，有覆寫站點沿用既有相容行為（0），沒覆寫就用路線設定。
 * 系統增加量只加在緩衝上，不動基本停靠秒數。
 */
export function resolveBlockDwellSlackBreakdown(
  block: Pick<GeneratedScheduleBlock, 'stationDwells' | 'dwellSlackSeconds' | 'dwellSlackAdjustment'>,
  route: Pick<ShiftScheduleSelectedRoute, 'dwellSlackSeconds'> | null | undefined,
): { baseSlackSeconds: number; addedSeconds: number; effectiveSlackSeconds: number; source: 'block' | 'route' } {
  const hasStationOverride = Boolean(block.stationDwells && block.stationDwells.length > 0);
  const explicit = typeof block.dwellSlackSeconds === 'number' && Number.isFinite(block.dwellSlackSeconds);
  const baseSlackSeconds = explicit
    ? normalizeDwellSlackSeconds(block.dwellSlackSeconds)
    : hasStationOverride
      ? 0
      : normalizeDwellSlackSeconds(route?.dwellSlackSeconds);
  const addedSeconds = Math.max(0, Math.round(block.dwellSlackAdjustment?.addedSeconds ?? 0));
  // 指定站的增加量不算進「每站都加」的緩衝，另外加在那一站（見 resolveBlockStationExtraDwellSeconds）
  const perStationAdded = block.dwellSlackAdjustment?.stationIndex != null ? 0 : addedSeconds;
  return {
    baseSlackSeconds,
    addedSeconds,
    effectiveSlackSeconds: baseSlackSeconds + perStationAdded,
    source: explicit || hasStationOverride ? 'block' : 'route',
  };
}

/**
 * 系統只在指定站增加的等待（秒），依站序排列；沒有指定站時全是 0。
 * 只有適用緩衝的站（有停靠、不是首站／途經／換線）才會加。
 */
export function resolveBlockStationExtraDwellSeconds(
  block: Pick<GeneratedScheduleBlock, 'dwellSlackAdjustment'>,
  stations: ShiftScheduleStationDwell[],
): number[] {
  const extra = stations.map(() => 0);
  const adjustment = block.dwellSlackAdjustment;
  const index = adjustment?.stationIndex;
  if (adjustment == null || index == null || index < 0 || index >= stations.length) return extra;
  if (applyStationDwellWithSlack(stations[index]!, 1, index) <= 0) return extra;
  extra[index] = Math.max(0, Math.round(adjustment.addedSeconds));
  return extra;
}

/**
 * 班次卡靠站來源：站點用卡上覆寫的 stationDwells（手動製作），否則路線群組預設；
 * 緩衝另外解析（{@link resolveBlockDwellSlackBreakdown}），兩者互不綁定。
 */
export function resolveBlockStationDwellInputs(
  block: GeneratedScheduleBlock,
  route: ShiftScheduleSelectedRoute | null | undefined,
): {
  stations: ShiftScheduleStationDwell[];
  dwellSlackSeconds: number;
} | null {
  route = routeForJoinedBlock(block, route);
  const stationSource = block.stationDwells && block.stationDwells.length > 0
    ? block.stationDwells
    : route?.stationDwells;
  if (!stationSource || stationSource.length === 0) return null;
  return {
    stations: stationSource.map((station) => ({ ...station })),
    dwellSlackSeconds: resolveBlockDwellSlackBreakdown(block, route).effectiveSlackSeconds,
  };
}

/**
 * 依班次卡與路線站序，推算各站抵達／出發時刻。
 *
 * 模型（與佔用時間 = 行駛 + 各站停靠 一致）：
 * - 出發 = 抵達 + 該站有效停靠（含開關門緩衝）
 * - 站間行駛：優先依拓撲站間時間比例分配班次實際行駛秒數；缺 leg 時均分
 * - **到站時刻對齊 10 秒格**；可比拓撲平均略慢（≤ 1.3×）以利班距，但不可誇張拖延
 * - 卡尾剩餘秒數併入末站停靠，使末站「靠站完成」＝卡結束
 * - 同站折返貼齊時：下一卡首站出發＝卡開始＝上一卡末站靠站完成（不把上一卡抵達鏡到下一卡）
 */
export function buildBlockStationDepartures(
  block: GeneratedScheduleBlock,
  route: ShiftScheduleSelectedRoute | null | undefined,
  _options?: {
    previousBlock?: GeneratedScheduleBlock | null;
    previousRoute?: ShiftScheduleSelectedRoute | null;
  },
): BlockStationStopTime[] {
  const plan = resolveBlockStationTimingPlan(block, route);
  if (!plan || !plan.feasibility.feasible) return [];

  const { stations, baseDwells, dwells, startSecond, legTravelSeconds } = plan;
  const endSecond = minuteToSecond(block.plannedEndMinute);
  const legCount = Math.max(0, stations.length - 1);
  const draft: Array<{
    order: number;
    stationId: string;
    stationName: string;
    baseDwellSeconds: number;
    dwellSeconds: number;
    arrivalSecond: number;
    departureSecond: number;
  }> = [];

  let nextArrivalSecond = startSecond;
  for (const [index, station] of stations.entries()) {
    const baseDwellSeconds = baseDwells[index] ?? 0;
    const dwellSeconds = dwells[index] ?? 0;
    const arrivalSecond = nextArrivalSecond;
    const departureSecond = arrivalSecond + dwellSeconds;
    draft.push({
      order: index + 1,
      stationId: station.stationId,
      stationName: station.stationName || station.stationId,
      baseDwellSeconds,
      dwellSeconds,
      arrivalSecond,
      departureSecond,
    });
    if (index < legCount) {
      nextArrivalSecond = departureSecond + legTravelSeconds[index]!;
    }
  }

  // 卡尾幽靈秒數併入末站：靠站完成對齊卡結束。
  const last = draft[draft.length - 1];
  if (last && last.departureSecond < endSecond) {
    last.departureSecond = endSecond;
    last.dwellSeconds = Math.max(0, endSecond - last.arrivalSecond);
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
      baseDwellSeconds: stop.baseDwellSeconds,
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
  if (block.routeInstanceId?.trim()) {
    const instanceId = block.routeInstanceId.trim();
    const byInstance = selectedRoutes.find(
      (route) => resolveSelectedRouteInstanceId(route) === instanceId,
    );
    if (byInstance) return routeForJoinedBlock(block, byInstance);
  }
  if (block.routeId) {
    const byId = selectedRoutes.find((route) => route.routeId === block.routeId);
    if (byId) return routeForJoinedBlock(block, byId);
  }
  if (block.routeName) {
    const byName = selectedRoutes.find((route) => route.routeName === block.routeName);
    if (byName) return byName;
  }
  return null;
}
