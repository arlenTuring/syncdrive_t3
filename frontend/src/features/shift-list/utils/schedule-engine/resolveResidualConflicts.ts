import { resolveSelectedRouteInstanceId, type ShiftScheduleSelectedRoute } from '../../types/create';
import {
  buildBlockStationDepartures,
  resolveBlockDurationBounds,
  resolveBlockDwellSlackBreakdown,
  resolveBlockStationDwellInputs,
  resolveRouteForBlock,
} from '../buildBlockStationDepartures';
import { rebuildRowHoldCards } from '../fillYardHoldGaps';
import {
  collectStationBerthOccupancies,
  findStationBerthCollisions,
  type StationBerthCollision,
} from '../stationBerthOccupancy';
import {
  collectPlanViolations,
  compareViolations,
  type PlanEvaluationContext,
  type PlanViolation,
} from './evaluatePlan';
import {
  applyStationDwellWithSlack,
  isClockAlignedSeconds,
  resolveInterTripGapSeconds,
  shouldIncludeRecoveryForRouteSwitch,
  snapUpToClockAlignSeconds,
} from './physics';
import type {
  DwellSlackAdjustment,
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
} from './types';
import { minuteToSecond } from './types';
import { resolvePairHeadwayTarget } from './validate';

/**
 * 殘留衝突修復：依衝突本身推導候選，在副本上整組驗證，失敗回滾
 * ==========================================================
 *
 * 前面的處理跑完之後，還剩的站位衝突在這裡逐筆處理。不指定要動哪一台車、
 * 也不寫死要挪多少秒：
 *
 * 1. <strong>找出衝突的邊界</strong>：前車實際離站＋保護何時結束、後車何時到站，
 *    兩個方向的差額（後車要晚多少／前車要早走多少；或反過來讓後車整個先過）。
 * 2. <strong>雙方都試</strong>：佔用那一趟本身、這一台車下一趟（決定它何時離站）、
 *    上一趟（決定它何時到站），每一趟都試整趟平移、只挪發車（壓縮行駛）、只挪到站
 *    （拉長行駛）。可不可行看同一份合法時長（{@link resolveBlockDurationBounds}）與
 *    前後任務的恢復／換線間隔，不另寫規則。
 * 3. <strong>整組驗證</strong>：副本上改完、重建那一列的暫停卡，用跟最終驗證同一套
 *    限制（{@link collectPlanViolations}）比較；沒有新增任何硬錯誤或安全簽章、
 *    整體變好才採用（{@link compareViolations}）。
 * 4. <strong>聯動</strong>：候選只差「引出新衝突」時，往下一層對新衝突再產生候選，
 *    整串完成後比原本好才採用；深度與評估次數有上限，用盡會記錄下來。
 *
 * 差額只是候選的起點，不是直接寫進班次的答案——每一個都要能由合法行駛時間或
 * 實際等待承接，並且完整驗證過。
 */

/** 讓站「暫停放」卡：跟著車的空等長出來，改時刻時可以拆掉重排 */
export function isRemovableParkCard(block: GeneratedScheduleBlock): boolean {
  return (
    block.id.startsWith('berthpark-in-')
    || block.id.startsWith('berthpark-stay-')
    || block.id.startsWith('berthpark-out-')
  );
}

/**
 * 改完某幾列之後，重排那幾列的讓站（由呼叫端提供，通常是
 * relievePlatformIdleWithFacilityPark 的 onlyRows 模式）。回傳新版面與它寫的訊息。
 */
export type ReplanRows = (
  timelines: GeneratedSchedulePlan['timelines'],
  rows: ReadonlySet<number>,
) => { timelines: GeneratedSchedulePlan['timelines']; warnings: FeasibilityIssue[] };

export type ResidualRepairBudget = {
  /** 聯動最多往下幾層 */
  maxDepth: number;
  /** 一個候選引出幾筆以內的新衝突，還值得往下一層找 */
  maxIntroducedPerStep: number;
  /** 每一層最多展開幾個聯動候選 */
  maxFollowUpsPerStep: number;
  /** 整個修復最多做幾次完整評估 */
  maxEvaluations: number;
};

export const DEFAULT_RESIDUAL_REPAIR_BUDGET: ResidualRepairBudget = {
  maxDepth: 3,
  maxIntroducedPerStep: 4,
  maxFollowUpsPerStep: 8,
  maxEvaluations: 3000,
};

export type TripEdit = {
  timelineRow: number;
  /** 這一步改了哪幾趟（整串推移時不只一趟） */
  changes: Array<{
    blockId: string;
    fromStartMinute: number;
    fromEndMinute: number;
    toStartMinute: number;
    toEndMinute: number;
  }>;
  /** 這一步是為了解哪一筆衝突 */
  targetKey: string;
  description: string;
};

export type ConflictAttempt = {
  targetKey: string;
  code: string;
  resource: string;
  blockIds: string[];
  outcome: 'resolved' | 'not_found';
  candidatesTried: number;
  /** 被拒絕的候選各自引出什麼（前幾筆） */
  rejectedSamples: string[];
};

export type ResidualRepairResult = {
  timelines: GeneratedSchedulePlan['timelines'];
  applied: TripEdit[];
  /** 採用的候選重排讓站時寫的訊息（沒採用的不留） */
  warnings: FeasibilityIssue[];
  attempts: ConflictAttempt[];
  evaluations: number;
  budgetExhausted: boolean;
};

type Plan = GeneratedSchedulePlan['timelines'];

function clonePlan(timelines: Plan): Plan {
  return timelines.map((timeline) => ({
    ...timeline,
    blocks: timeline.blocks.map((block) => ({ ...block })),
  }));
}

function isTrip(block: GeneratedScheduleBlock): boolean {
  return block.taskType === 'passenger';
}

/** 同一列的實際任務依時間排好（不含暫停卡與可重排的暫停放卡——兩者都跟著卡片重建） */
function rowTasks(timelines: Plan, row: number): GeneratedScheduleBlock[] {
  const timeline = timelines.find((item) => item.row === row);
  if (!timeline) return [];
  return timeline.blocks
    .filter((block) => block.source !== 'hold' && !isRemovableParkCard(block))
    .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute || a.id.localeCompare(b.id));
}

function interTripGapSeconds(
  previous: GeneratedScheduleBlock,
  next: GeneratedScheduleBlock,
  selectedRoutes: ShiftScheduleSelectedRoute[],
  minimumRecoveryTimeSeconds: number,
): number {
  if (!isTrip(previous) || !isTrip(next)) return 0;
  const previousRoute = resolveRouteForBlock(previous, selectedRoutes);
  const nextRoute = resolveRouteForBlock(next, selectedRoutes);
  if (!previousRoute || !nextRoute) return minimumRecoveryTimeSeconds;
  return resolveInterTripGapSeconds({
    minimumRecoveryTimeSeconds,
    previousRouteSwitchBufferSeconds: previousRoute.switchBufferAfterSeconds,
    isRouteSwitch: previousRoute.routeId !== nextRoute.routeId,
    includeRecovery: shouldIncludeRecoveryForRouteSwitch({
      previousRoute,
      nextRoute,
      rotationRoutes: selectedRoutes,
    }),
    previousRoute,
    nextRoute,
  });
}

/** 一趟改成 [start, end] 本身合不合法：發車對齊刻度、時長在合法最短與最長之間 */
function tripShapeIsLegal(
  block: GeneratedScheduleBlock,
  startMinute: number,
  endMinute: number,
  ctx: PlanEvaluationContext,
  addSlackSeconds = 0,
): boolean {
  const startSecond = minuteToSecond(startMinute);
  const endSecond = minuteToSecond(endMinute);
  if (!isClockAlignedSeconds(Math.round(startSecond))) return false;
  const route = resolveRouteForBlock(block, ctx.selectedRoutes);
  if (!route) return false;
  const bounds = resolveBlockDurationBounds(
    withAddedSlack({ ...block, plannedStartMinute: startMinute, plannedEndMinute: endMinute }, addSlackSeconds),
    route,
  );
  const duration = endSecond - startSecond;
  if (!bounds || duration < bounds.minSeconds - 1e-6) return false;
  // 拉長也有上限：原本就比上限長的（例如手動製作）只准不再變長
  const originalDuration = minuteToSecond(block.plannedEndMinute - block.plannedStartMinute)
    + addSlackSeconds * countSlackStations(block, ctx);
  return duration <= Math.max(bounds.maxSeconds, originalDuration) + 1e-6;
}

function withAddedSlack(block: GeneratedScheduleBlock, addSlackSeconds: number): GeneratedScheduleBlock {
  if (addSlackSeconds <= 0) return block;
  const previous = block.dwellSlackAdjustment;
  return {
    ...block,
    dwellSlackAdjustment: {
      ...(previous ?? {
        baseSlackSeconds: 0,
        reason: { code: '', resourceId: '', resourceLabel: '', counterpartBlockIds: [], message: '' },
        affectedStops: [],
        blockBefore: { startMinute: block.plannedStartMinute, endMinute: block.plannedEndMinute },
      }),
      addedSeconds: (previous?.addedSeconds ?? 0) + addSlackSeconds,
    },
  };
}

/** 這一趟有幾站適用靠站緩衝（首站、途經、不停靠、換線、0 秒停靠都不加） */
function countSlackStations(block: GeneratedScheduleBlock, ctx: PlanEvaluationContext): number {
  const route = resolveRouteForBlock(block, ctx.selectedRoutes);
  const inputs = resolveBlockStationDwellInputs(block, route);
  if (!inputs) return 0;
  return inputs.stations.filter((station, index) => applyStationDwellWithSlack(station, 1, index) > 0).length;
}

/** 候選：同一列裡哪幾趟改成什麼起訖 */
type TripCandidate = {
  row: number;
  changes: Array<{
    blockId: string;
    toStartMinute: number;
    toEndMinute: number;
    /** 這一趟再增加的靠站緩衝（秒，每個適用站都加） */
    addSlackSeconds?: number;
  }>;
  description: string;
  /** 增加緩衝時：為了哪一筆衝突（寫進調整紀錄） */
  slackReason?: DwellSlackAdjustment['reason'];
  /** 改時刻時：為了哪一筆衝突（寫進 conflictRetime） */
  retimeReason?: DwellSlackAdjustment['reason'];
};

/**
 * 把一趟改成 [start+Δs, end+Δe]，後面的班次只在「空檔 − 必要恢復／換線」吸收不了時
 * 才跟著往後推（整串推移），前面只准在既有空檔內往前。推到非載客的固定任務
 * （整備、移動卡）還吸收不完就不合法。可重排的暫停放卡不算阻擋——改完會重排。
 */
function buildShiftCandidate(
  timelines: Plan,
  trip: GeneratedScheduleBlock,
  startShiftMinutes: number,
  endShiftMinutes: number,
  ctx: PlanEvaluationContext,
  description: string,
  addSlackSeconds = 0,
): TripCandidate | null {
  const tasks = rowTasks(timelines, trip.timelineRow);
  const index = tasks.findIndex((block) => block.id === trip.id);
  if (index < 0) return null;
  const changes: TripCandidate['changes'] = [];
  const toStart = trip.plannedStartMinute + startShiftMinutes;
  const toEnd = trip.plannedEndMinute + endShiftMinutes;
  if (!tripShapeIsLegal(trip, toStart, toEnd, ctx, addSlackSeconds)) return null;
  const prev = index > 0 ? tasks[index - 1]! : null;
  if (prev) {
    const gap = interTripGapSeconds(prev, trip, ctx.selectedRoutes, ctx.minimumRecoveryTimeSeconds);
    if (minuteToSecond(toStart) < minuteToSecond(prev.plannedEndMinute) + gap - 1e-6) return null;
  }
  changes.push({
    blockId: trip.id,
    toStartMinute: toStart,
    toEndMinute: toEnd,
    ...(addSlackSeconds > 0 ? { addSlackSeconds } : {}),
  });

  let previousOriginal = trip;
  let previousEnd = toEnd;
  for (let k = index + 1; k < tasks.length; k += 1) {
    const next = tasks[k]!;
    const required = interTripGapSeconds(previousOriginal, next, ctx.selectedRoutes, ctx.minimumRecoveryTimeSeconds);
    const needShift = minuteToSecond(previousEnd) + required - minuteToSecond(next.plannedStartMinute);
    if (needShift <= 1e-6) break;
    if (!isTrip(next)) return null;
    const shiftMinutes = snapUpToClockAlignSeconds(needShift) / 60;
    const nextStart = next.plannedStartMinute + shiftMinutes;
    const nextEnd = next.plannedEndMinute + shiftMinutes;
    if (!tripShapeIsLegal(next, nextStart, nextEnd, ctx)) return null;
    changes.push({ blockId: next.id, toStartMinute: nextStart, toEndMinute: nextEnd });
    previousOriginal = next;
    previousEnd = nextEnd;
  }
  const pushed = changes.length - 1;
  return {
    row: trip.timelineRow,
    changes,
    description: `時間線 ${trip.timelineRow} ${description}${pushed > 0 ? `（後面 ${pushed} 趟跟著推）` : ''}`,
  };
}

/**
 * 一筆站位衝突的候選。兩個方向的差額都算：後車晚到（或前車早走）d1，
 * 以及前車整個讓後車先過 d2。每一個差額都套到雙方的相關班次上。
 */
function stationConflictCandidates(
  timelines: Plan,
  collision: StationBerthCollision,
  ctx: PlanEvaluationContext,
): TripCandidate[] {
  const blockById = new Map(
    timelines.flatMap((timeline) => timeline.blocks).map((block) => [block.id, block] as const),
  );
  const deficits = [
    // 後車到站要晚到「前車離站＋保護」
    minuteToSecond(collision.earlier.protectedUntilMinute - collision.later.startMinute),
    // 或前車整個晚到「後車離站＋保護」之後（兩車換順序）
    minuteToSecond(collision.later.protectedUntilMinute - collision.earlier.startMinute),
  ]
    .filter((value) => value > 1e-6)
    .map((value) => snapUpToClockAlignSeconds(value));

  // 雙方各自：佔用那一趟、同列上一趟（決定何時到）、下一趟（決定何時走）
  const trips = new Map<string, GeneratedScheduleBlock>();
  for (const occupancy of [collision.earlier, collision.later]) {
    const tasks = rowTasks(timelines, occupancy.timelineRow);
    const own = blockById.get(occupancy.blockId);
    if (!own) continue;
    let index = tasks.findIndex((block) => block.id === own.id);
    if (index < 0) {
      // 佔用是暫停卡／待命：找它前後最近的載客
      index = tasks.findIndex((block) => block.plannedStartMinute >= own.plannedStartMinute - 1e-9);
    }
    for (const k of [index - 1, index, index + 1]) {
      const candidate = k >= 0 ? tasks[k] : undefined;
      if (candidate && isTrip(candidate)) trips.set(candidate.id, candidate);
    }
  }

  const reason: DwellSlackAdjustment['reason'] = {
    code: collision.kind === 'overlap' ? 'STATION_BERTH_COLLISION' : 'STATION_BERTH_PROTECTION_GAP',
    resourceId: collision.stationId,
    resourceLabel: collision.stationName,
    counterpartBlockIds: [collision.earlier.blockId, collision.later.blockId],
    message:
      `「${collision.stationName}」站位${collision.kind === 'overlap' ? '重疊' : '碰撞保護不足'}：`
      + `時間線 ${collision.earlier.timelineRow} 待到 ${formatClock(collision.earlier.actualDepartMinute)}、`
      + `時間線 ${collision.later.timelineRow} ${formatClock(collision.later.startMinute)} 就到`,
  };
  const out: TripCandidate[] = [];
  for (const trip of trips.values()) {
    for (const deficit of deficits) {
      const d = deficit / 60;
      const variants: Array<[number, number, string]> = [
        [d, d, `整趟晚 ${deficit} 秒`],
        [-d, -d, `整趟早 ${deficit} 秒`],
        [d, 0, `晚 ${deficit} 秒發車、壓縮行駛（到站不變）`],
        [-d, 0, `早 ${deficit} 秒發車、拉長行駛（到站不變）`],
        [0, d, `發車不變、拉長行駛晚 ${deficit} 秒到`],
        [0, -d, `發車不變、壓縮行駛早 ${deficit} 秒到`],
      ];
      for (const [startShift, endShift, description] of variants) {
        const candidate = buildShiftCandidate(timelines, trip, startShift, endShift, ctx, description);
        if (candidate) out.push({ ...candidate, retimeReason: reason });
      }
    }
  }

  /**
   * 增加前方停靠緩衝：讓某一方<strong>晚一點到</strong>衝突的那一站，發車不動。
   * 只有這一站之前有適用緩衝的站才做得到；每站增加量取能補上差額的最小值（對齊刻度），
   * 所有適用站都會加（不能假裝只改一站），卡尾跟著延長、後面班次只在空檔吸收不了時推。
   */
  for (const occupancy of [collision.earlier, collision.later]) {
    const trip = blockById.get(occupancy.blockId);
    if (!trip || !isTrip(trip)) continue;
    const route = resolveRouteForBlock(trip, ctx.selectedRoutes);
    const inputs = resolveBlockStationDwellInputs(trip, route);
    if (!route || !inputs) continue;
    const stops = buildBlockStationDepartures(trip, route);
    const targetIndex = stops.findIndex(
      (stop) =>
        stop.stationId === occupancy.stationId
        && Math.abs(stop.arrivalMinute - occupancy.startMinute) < 1e-6,
    );
    if (targetIndex <= 0) continue;
    const applicable = inputs.stations.map((station, index) => applyStationDwellWithSlack(station, 1, index) > 0);
    const before = applicable.slice(0, targetIndex).filter(Boolean).length;
    const total = applicable.filter(Boolean).length;
    if (before === 0) continue;
    const counterpart = occupancy === collision.earlier ? collision.later : collision.earlier;
    const deficit = occupancy === collision.later
      ? minuteToSecond(collision.earlier.protectedUntilMinute - collision.later.startMinute)
      : minuteToSecond(collision.later.protectedUntilMinute - collision.earlier.startMinute);
    if (deficit <= 1e-6) continue;
    const perStation = snapUpToClockAlignSeconds(deficit / before);
    const endShift = (perStation * total) / 60;
    const candidate = buildShiftCandidate(
      timelines,
      trip,
      0,
      endShift,
      ctx,
      `增加靠站緩衝每站 ${perStation} 秒（${total} 站適用），晚 ${perStation * before} 秒到「${occupancy.stationName}」`,
      perStation,
    );
    if (!candidate) continue;
    candidate.slackReason = {
      code: collision.kind === 'overlap' ? 'STATION_BERTH_COLLISION' : 'STATION_BERTH_PROTECTION_GAP',
      resourceId: occupancy.stationId,
      resourceLabel: occupancy.stationName,
      counterpartBlockIds: [counterpart.blockId],
      message:
        `「${occupancy.stationName}」站位${collision.kind === 'overlap' ? '重疊' : '碰撞保護不足'}：`
        + `原本 ${formatClock(occupancy.startMinute)} 到站，另一方（時間線 ${counterpart.timelineRow}）`
        + `要到 ${formatClock(counterpart.protectedUntilMinute)} 才讓出`,
    };
    out.push(candidate);
  }
  return out;
}

function formatClock(minute: number): string {
  const total = Math.round(minuteToSecond(minute));
  const day = ((total % 86400) + 86400) % 86400;
  return [Math.floor(day / 3600), Math.floor(day / 60) % 60, day % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

/**
 * 寫這一趟的緩衝調整紀錄：原始緩衝、系統增加量、原因、每個適用站調整前後的到發。
 * before／after 都用同一支逐站時刻計算，數值跟畫面、後端展開一致。
 */
function buildSlackAdjustmentRecord(
  before: GeneratedScheduleBlock,
  after: GeneratedScheduleBlock,
  reason: DwellSlackAdjustment['reason'],
  ctx: PlanEvaluationContext,
): DwellSlackAdjustment {
  const route = resolveRouteForBlock(after, ctx.selectedRoutes);
  const breakdown = resolveBlockDwellSlackBreakdown(after, route);
  const beforeStops = buildBlockStationDepartures(before, route);
  const afterStops = buildBlockStationDepartures(after, route);
  const inputs = resolveBlockStationDwellInputs(after, route);
  const affectedStops: DwellSlackAdjustment['affectedStops'] = [];
  for (const [index, stop] of afterStops.entries()) {
    const station = inputs?.stations[index];
    if (!station || applyStationDwellWithSlack(station, 1, index) <= 0) continue;
    const previous = beforeStops[index];
    affectedStops.push({
      order: stop.order,
      stationId: stop.stationId,
      stationName: stop.stationName,
      baseDwellSeconds: stop.baseDwellSeconds,
      dwellBeforeSeconds: previous?.dwellSeconds ?? stop.dwellSeconds,
      dwellAfterSeconds: stop.dwellSeconds,
      arrivalBeforeMinute: previous?.arrivalMinute ?? stop.arrivalMinute,
      departureBeforeMinute: previous?.departureMinute ?? stop.departureMinute,
      arrivalAfterMinute: stop.arrivalMinute,
      departureAfterMinute: stop.departureMinute,
    });
  }
  return {
    baseSlackSeconds: breakdown.baseSlackSeconds,
    addedSeconds: breakdown.addedSeconds,
    reason,
    affectedStops,
    blockBefore: before.dwellSlackAdjustment?.blockBefore
      ?? { startMinute: before.plannedStartMinute, endMinute: before.plannedEndMinute },
  };
}

/**
 * 在副本上把一趟改成 [start+Δs, end+Δe]（後面的班次只在空檔吸收不了時跟著推），
 * 不重排讓站、不重建暫停卡——給還沒跑到那兩步的階段用（例如轉場卡之前）。
 * 不合法回傳 null。
 */
export function shiftTripInCopy(
  timelines: Plan,
  blockId: string,
  startShiftMinutes: number,
  endShiftMinutes: number,
  ctx: PlanEvaluationContext,
  description: string,
): { timelines: Plan; description: string } | null {
  const trip = timelines.flatMap((timeline) => timeline.blocks).find((block) => block.id === blockId);
  if (!trip || !isTrip(trip)) return null;
  const candidate = buildShiftCandidate(timelines, trip, startShiftMinutes, endShiftMinutes, ctx, description);
  if (!candidate) return null;
  const copy = clonePlan(timelines);
  const timeline = copy.find((item) => item.row === candidate.row)!;
  for (const change of candidate.changes) {
    const block = timeline.blocks.find((item) => item.id === change.blockId)!;
    block.anchorStartMinute += change.toStartMinute - block.plannedStartMinute;
    block.plannedStartMinute = change.toStartMinute;
    block.plannedEndMinute = change.toEndMinute;
  }
  return { timelines: copy, description: candidate.description };
}

/**
 * 換成另一條已允許的路線（同終點、關聯圖上的下游相同）在副本上跑同一趟。
 *
 * 起點站不同，車要去的地方就不同——出廠卡擠不過轉折點、或起點站位被佔時，換個起點
 * 常常就過得去。判準跟「車在哪就從哪發」同一條：終點與下游不變，交路後段完全不受
 * 影響；時刻不動，只在新路線的合法行駛範圍內才成立。回傳每個可行替代各一份副本。
 */
export function rerouteTripInCopy(
  timelines: Plan,
  blockId: string,
  ctx: PlanEvaluationContext,
): Array<{ timelines: Plan; description: string; fromRoute: ShiftScheduleSelectedRoute; toRoute: ShiftScheduleSelectedRoute }> {
  const policy = ctx.successorPolicy?.valid ? ctx.successorPolicy : null;
  const trip = timelines.flatMap((timeline) => timeline.blocks).find((block) => block.id === blockId);
  if (!policy || !trip || !isTrip(trip)) return [];
  const current = resolveRouteForBlock(trip, ctx.selectedRoutes);
  if (!current) return [];
  const currentId = trip.routeInstanceId?.trim() || resolveSelectedRouteInstanceId(current);
  const originOf = (route: ShiftScheduleSelectedRoute) => route.stationIds?.[0]?.trim() || null;
  const destinationOf = (route: ShiftScheduleSelectedRoute) => route.stationIds?.at(-1)?.trim() || null;
  const successorOf = (instanceId: string) => policy.prioritySuccessors.get(instanceId)?.[0] ?? null;
  const out: ReturnType<typeof rerouteTripInCopy> = [];
  for (const [candidateId, candidate] of policy.routesByInstanceId) {
    if (candidateId === currentId) continue;
    if (originOf(candidate) === originOf(current)) continue;
    if (destinationOf(candidate) !== destinationOf(current)) continue;
    if (successorOf(candidateId) !== successorOf(currentId)) continue;
    const rerouted: GeneratedScheduleBlock = {
      ...trip,
      routeId: candidate.routeId,
      routeInstanceId: candidateId,
      routeCode: candidate.routeCode ?? trip.routeCode,
      routeName: candidate.routeName ?? trip.routeName,
    };
    if (!tripShapeIsLegal(rerouted, trip.plannedStartMinute, trip.plannedEndMinute, ctx)) continue;
    const copy = clonePlan(timelines);
    for (const timeline of copy) {
      const index = timeline.blocks.findIndex((block) => block.id === blockId);
      if (index >= 0) timeline.blocks[index] = { ...timeline.blocks[index]!, ...rerouted };
    }
    out.push({
      timelines: copy,
      description: `下一班改跑同終點的「${candidate.routeName ?? candidate.routeId}」`
        + `（從「${candidate.stationDwells?.[0]?.stationName?.trim() || originOf(candidate)}」發）`,
      fromRoute: current,
      toRoute: candidate,
    });
  }
  return out;
}

/**
 * 在副本上套用候選：拆掉這一列受影響時段裡的暫停放卡（它們是跟著舊的空等長出來的）、
 * 改時刻、重排這一列的讓站、重建暫停卡。其他列一張卡都不動。
 */
function applyCandidate(
  timelines: Plan,
  candidate: TripCandidate,
  ctx: PlanEvaluationContext,
  replanRows: ReplanRows | undefined,
  warningsSink: FeasibilityIssue[],
): Plan {
  let copy = clonePlan(timelines);
  const timeline = copy.find((item) => item.row === candidate.row)!;
  const byId = new Map(timeline.blocks.map((block) => [block.id, block] as const));
  let windowStart = Number.POSITIVE_INFINITY;
  let windowEnd = Number.NEGATIVE_INFINITY;
  for (const change of candidate.changes) {
    const block = byId.get(change.blockId)!;
    const before = { ...block };
    windowStart = Math.min(windowStart, block.plannedStartMinute, change.toStartMinute);
    windowEnd = Math.max(windowEnd, block.plannedEndMinute, change.toEndMinute);
    block.anchorStartMinute += change.toStartMinute - block.plannedStartMinute;
    block.plannedStartMinute = change.toStartMinute;
    block.plannedEndMinute = change.toEndMinute;
    if (change.addSlackSeconds && candidate.slackReason) {
      const withSlack = withAddedSlack(block, change.addSlackSeconds);
      block.dwellSlackAdjustment = buildSlackAdjustmentRecord(before, withSlack, candidate.slackReason, ctx);
    } else {
      const reason = candidate.retimeReason ?? candidate.slackReason;
      if (reason) {
        block.conflictRetime = {
          // 已經被調過的沿用最初的時刻，不拿中間狀態當「原本」
          blockBefore: before.conflictRetime?.blockBefore
            ?? { startMinute: before.plannedStartMinute, endMinute: before.plannedEndMinute },
          description: candidate.description,
          reason,
        };
      }
    }
  }
  // 受影響時段：改動的最早到最晚，再往外含到前後最近的實際任務
  const tasks = rowTasks(copy, candidate.row);
  const before = [...tasks].reverse().find((block) => block.plannedEndMinute <= windowStart + 1e-9);
  const after = tasks.find((block) => block.plannedStartMinute >= windowEnd - 1e-9);
  const from = before?.plannedEndMinute ?? Number.NEGATIVE_INFINITY;
  const to = after?.plannedStartMinute ?? Number.POSITIVE_INFINITY;
  const stripped = timeline.blocks.filter(
    (block) =>
      isRemovableParkCard(block)
      && block.plannedEndMinute > from - 1e-9
      && block.plannedStartMinute < to + 1e-9,
  );
  if (stripped.length > 0) {
    const strippedIds = new Set(stripped.map((block) => block.id));
    timeline.blocks = timeline.blocks.filter((block) => !strippedIds.has(block.id));
  }
  rebuildRowHoldCards(timeline, ctx.selectedRoutes);
  // 只有拆掉了暫停放卡才需要重排讓站；沒拆的話別列的讓站本來就沒動
  if (replanRows && stripped.length > 0) {
    const replanned = replanRows(copy, new Set([candidate.row]));
    copy = replanned.timelines;
    warningsSink.push(...replanned.warnings);
    rebuildRowHoldCards(copy.find((item) => item.row === candidate.row)!, ctx.selectedRoutes);
  }
  return copy;
}

function describeViolation(violation: PlanViolation): string {
  return `${violation.code}（${violation.resource}）`;
}

/**
 * 候選排序用：越小越好。能解掉衝突的候選之間，先比硬錯誤、安全問題、班距（服務品質），
 * 再比改動大小——動發車時刻（乘客看得到的班距）比只動到站、只加緩衝代價高。
 */
/**
 * 班距規律：同一路線相鄰發車「超出目標」的秒數加總。
 *
 * 違反清單只抓得到「太擠」；整趟往後挪會讓前一個空隙變大、看起來跳過一班，
 * 那是服務變差，排序時要看得到。目標用跟驗證同一支（交路起班當下的班距）。
 */
function headwayOverGapSeconds(plan: Plan, ctx: PlanEvaluationContext): number {
  const byRoute = new Map<string, GeneratedScheduleBlock[]>();
  for (const timeline of plan) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger' || block.source !== 'template_bar' || !block.routeId) continue;
      const list = byRoute.get(block.routeId) ?? [];
      list.push(block);
      byRoute.set(block.routeId, list);
    }
  }
  let total = 0;
  for (const list of byRoute.values()) {
    list.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    for (let index = 1; index < list.length; index += 1) {
      const earlier = list[index - 1]!;
      const later = list[index]!;
      const target = resolvePairHeadwayTarget(earlier, later, ctx.intervals, ctx.attributes);
      if (target == null || target <= 0) continue;
      const gap = minuteToSecond(later.plannedStartMinute - earlier.plannedStartMinute);
      if (gap > target) total += gap - target;
    }
  }
  return total;
}

function rankCandidate(
  violations: PlanViolation[],
  edit: TripEdit,
  slackSeconds: number,
  overGapSeconds: number,
): number[] {
  let hard = 0;
  let safety = 0;
  let quality = 0;
  for (const item of violations) {
    if (item.severity === 'hard') hard += 1;
    else if (item.severity === 'safety') safety += 1;
    else quality += 1;
  }
  let departureShift = 0;
  let arrivalShift = 0;
  for (const change of edit.changes) {
    departureShift += Math.abs(change.toStartMinute - change.fromStartMinute) * 60;
    arrivalShift += Math.abs(change.toEndMinute - change.fromEndMinute) * 60;
  }
  return [hard, safety, quality, overGapSeconds, departureShift, slackSeconds, arrivalShift];
}

function lexLess(a: number[], b: number[]): boolean {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]!;
  }
  return false;
}

export function resolveResidualConflicts(args: {
  timelines: Plan;
  ctx: PlanEvaluationContext;
  replanRows?: ReplanRows;
  budget?: ResidualRepairBudget;
}): ResidualRepairResult {
  const { ctx, replanRows } = args;
  const budget = args.budget ?? DEFAULT_RESIDUAL_REPAIR_BUDGET;
  let evaluations = 0;
  let budgetExhausted = false;
  const evaluate = (candidate: Plan): PlanViolation[] => {
    evaluations += 1;
    return collectPlanViolations(ctx, candidate);
  };

  let current = clonePlan(args.timelines);
  let currentViolations = evaluate(current);
  const applied: TripEdit[] = [];
  const adoptedWarnings: FeasibilityIssue[] = [];
  const attempts: ConflictAttempt[] = [];
  const settled = new Set<string>();

  const collisionsOf = (plan: Plan) =>
    findStationBerthCollisions(
      collectStationBerthOccupancies(plan, ctx.selectedRoutes, {
        collisionProtectionSeconds: ctx.collisionProtectionSeconds,
      }),
      ctx.selectedRoutes,
    );
  const keyOf = (collision: StationBerthCollision) => {
    const code = collision.kind === 'overlap' ? 'STATION_BERTH_COLLISION' : 'STATION_BERTH_PROTECTION_GAP';
    const ids = [collision.earlier.blockId, collision.later.blockId].sort();
    return `${code}|${collision.stationId}|${ids.join('+')}`;
  };

  type Found = { plan: Plan; violations: PlanViolation[]; edits: TripEdit[]; warnings: FeasibilityIssue[] };

  /**
   * 在 plan 上嘗試解掉 target：回傳改完（含聯動）的版面與步驟；解不掉回傳 null。
   * base 是最外層比較的基準——聯動的中間步驟可以暫時變差，完成後要比 base 好。
   */
  const search = (
    plan: Plan,
    planViolations: PlanViolation[],
    target: StationBerthCollision,
    depth: number,
    base: PlanViolation[],
    rejected: string[],
    counter: { tried: number },
  ): Found | null => {
    const targetKey = keyOf(target);
    let best: (Found & { rank: number[] }) | null = null;
    const followUps: Array<Found & { introduced: PlanViolation[] }> = [];
    const blockById = new Map(plan.flatMap((timeline) => timeline.blocks).map((block) => [block.id, block] as const));

    for (const candidate of stationConflictCandidates(plan, target, ctx)) {
      if (evaluations >= budget.maxEvaluations) {
        budgetExhausted = true;
        break;
      }
      counter.tried += 1;
      const sink: FeasibilityIssue[] = [];
      const next = applyCandidate(plan, candidate, ctx, replanRows, sink);
      // 快篩：先只看站位。目標沒解、或引出的新站位衝突多到不值得聯動，就不做完整評估
      const stationKeys = new Set(collisionsOf(next).map(keyOf));
      if (stationKeys.has(targetKey)) {
        if (rejected.length < 6) rejected.push(`${candidate.description}：衝突仍在`);
        continue;
      }
      const planStationKeys = new Set(
        planViolations.filter((item) => item.code.startsWith('STATION_BERTH_')).map((item) => item.key),
      );
      const newStation = [...stationKeys].filter((key) => !planStationKeys.has(key));
      if (newStation.length > budget.maxIntroducedPerStep) {
        if (rejected.length < 6) rejected.push(`${candidate.description}：引出 ${newStation.length} 筆新的站位衝突`);
        continue;
      }
      const nextViolations = evaluate(next);
      const edit: TripEdit = {
        timelineRow: candidate.row,
        changes: candidate.changes.map((change) => {
          const block = blockById.get(change.blockId)!;
          return {
            blockId: change.blockId,
            fromStartMinute: block.plannedStartMinute,
            fromEndMinute: block.plannedEndMinute,
            toStartMinute: change.toStartMinute,
            toEndMinute: change.toEndMinute,
          };
        }),
        targetKey,
        description: candidate.description,
      };
      const stillThere = nextViolations.some((item) => item.key === targetKey);
      const comparison = compareViolations(base, nextViolations);
      if (!stillThere && comparison.better) {
        const slackSeconds = candidate.changes.reduce((sum, change) => sum + (change.addSlackSeconds ?? 0), 0);
        const rank = rankCandidate(nextViolations, edit, slackSeconds, headwayOverGapSeconds(next, ctx));
        if (!best || lexLess(rank, best.rank)) {
          best = { plan: next, violations: nextViolations, edits: [edit], warnings: sink, rank };
        }
        continue;
      }
      const introduced = compareViolations(planViolations, nextViolations).introduced;
      if (rejected.length < 6) {
        rejected.push(
          `${candidate.description}：`
          + (stillThere ? '衝突仍在' : `引出 ${introduced.map(describeViolation).join('、') || '其他問題'}`),
        );
      }
      const stationOnly = introduced.every((item) => item.code.startsWith('STATION_BERTH_'));
      if (!stillThere && introduced.length > 0 && introduced.length <= budget.maxIntroducedPerStep && stationOnly) {
        followUps.push({ plan: next, violations: nextViolations, edits: [edit], warnings: sink, introduced });
      }
    }
    if (best) return best;
    if (depth >= budget.maxDepth || budgetExhausted) return null;

    // 聯動：這一步解了目標但引出新的站位衝突，往下一層處理那幾筆，整串完成後比 base 好才算。
    // 引出越少的越有希望，先試；每層展開數有上限
    followUps.sort((a, b) => a.introduced.length - b.introduced.length);
    for (const followUp of followUps.slice(0, budget.maxFollowUpsPerStep)) {
      if (evaluations >= budget.maxEvaluations) {
        budgetExhausted = true;
        break;
      }
      let plan2 = followUp.plan;
      let violations2 = followUp.violations;
      const edits = [...followUp.edits];
      const warnings = [...followUp.warnings];
      let ok = true;
      for (const intro of followUp.introduced) {
        const collision = collisionsOf(plan2).find((item) => keyOf(item) === intro.key);
        if (!collision) continue;
        const deeper = search(plan2, violations2, collision, depth + 1, violations2, rejected, counter);
        if (!deeper) {
          ok = false;
          break;
        }
        plan2 = deeper.plan;
        violations2 = deeper.violations;
        edits.push(...deeper.edits);
        warnings.push(...deeper.warnings);
      }
      if (ok && compareViolations(base, violations2).better) {
        return { plan: plan2, violations: violations2, edits, warnings };
      }
    }
    return null;
  };

  for (;;) {
    const pending = collisionsOf(current).filter((collision) => !settled.has(keyOf(collision)));
    if (pending.length === 0 || budgetExhausted) break;
    // 實體重疊先處理，同級依差得多的先
    pending.sort((a, b) =>
      (a.kind === 'overlap' ? 0 : 1) - (b.kind === 'overlap' ? 0 : 1)
      || b.protectionShortfallSeconds - a.protectionShortfallSeconds);
    const target = pending[0]!;
    const key = keyOf(target);
    settled.add(key);
    const rejected: string[] = [];
    const counter = { tried: 0 };
    const found = search(current, currentViolations, target, 1, currentViolations, rejected, counter);
    attempts.push({
      targetKey: key,
      code: target.kind === 'overlap' ? 'STATION_BERTH_COLLISION' : 'STATION_BERTH_PROTECTION_GAP',
      resource: target.stationId,
      blockIds: [target.earlier.blockId, target.later.blockId],
      outcome: found ? 'resolved' : 'not_found',
      candidatesTried: counter.tried,
      rejectedSamples: rejected,
    });
    if (found) {
      current = found.plan;
      currentViolations = found.violations;
      applied.push(...found.edits);
      adoptedWarnings.push(...found.warnings);
    }
  }

  return {
    timelines: current,
    applied,
    warnings: adoptedWarnings,
    attempts,
    evaluations,
    budgetExhausted,
  };
}

export function formatTripEdit(edit: TripEdit): string {
  const fmt = (minute: number) => {
    const total = Math.round(minuteToSecond(minute));
    const day = ((total % 86400) + 86400) % 86400;
    return [Math.floor(day / 3600), Math.floor(day / 60) % 60, day % 60]
      .map((value) => String(value).padStart(2, '0'))
      .join(':');
  };
  const first = edit.changes[0];
  if (!first) return edit.description;
  return `${edit.description}（${fmt(first.fromStartMinute)}–${fmt(first.fromEndMinute)} → `
    + `${fmt(first.toStartMinute)}–${fmt(first.toEndMinute)}）`;
}
