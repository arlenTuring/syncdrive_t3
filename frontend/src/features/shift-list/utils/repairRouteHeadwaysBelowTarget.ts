/**
 * 站位延後／改線後，同路線相鄰發車若低於時段目標班距，
 * 在站位與同列約束允許下拉開到目標班距。
 *
 * 兩段式：
 *   Pass A（往後推）：把 later 往後推，不強求一次到位——推到「同列下一班／maxPushSeconds」
 *     允許的極限即可，不是「能全推到 target 才推，否則整段放棄」。
 *   Pass B（往前拉）：Pass A 仍推不夠時，反向從 earlier 這端要空間，但只吃 earlier
 *     自己與其上一班之間「已經比 target 寬」的既有餘裕，不倒欠新的班距債。
 */
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { resolveRouteForBlock } from './buildBlockStationDepartures';
import { sameRowPrecedingYardEndSecond } from './densifyRouteHeadwaysAfterBerth';
import {
  resolveInterTripGapSeconds,
  shouldIncludeRecoveryForRouteSwitch,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  snapDownToClockAlignSeconds,
  snapUpToClockAlignSeconds,
} from './schedule-engine/physics';
import type {
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
} from './schedule-engine/types';
import { minuteToSecond, secondToMinute } from './schedule-engine/types';
import {
  bookBerthWindowsExcept,
  movedTripLingerCollides,
  projectProtectedBerthWindowsSeconds,
  resolveBerthClearDelaySeconds,
  type BerthProtectionContext,
} from './stationBerthConstraint';
import { resolvePairHeadwayTarget } from './schedule-engine/validate';
import type { TimeSlotAttribute, TimeSlotInterval } from '../../time-templates/types/editor';

/** 修復後仍在此寬限內視為已達標，不再繼續擠壓（對齊 densify slack） */
const REPAIR_SLACK_SECONDS = 20;

function occupancySecondsOf(block: GeneratedScheduleBlock): number {
  return Math.max(
    SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
    minuteToSecond(block.plannedEndMinute) - minuteToSecond(block.plannedStartMinute),
  );
}

/**
 * 同一列（同一台車）在這張卡前面／後面緊接著的<strong>任何任務</strong>——不只正線。
 *
 * 先前這裡只在同列的「正線」卡片之間找鄰居，中間如果夾著整備、調度、暫停等非正線
 * 任務會被直接跳過——floor／ceiling 算出來的其實是「跟再前一張正線卡的空檔」，
 * 不是「車真的下一件事什麼時候開始」。班距修復把發車往前拉或往後推時，因此可能
 * 拉進車還在整備裡的時段、或推進下一件已排定任務的時段，物理上做不到。
 * 同車前後所有實際任務都要看，不能只看 passenger。
 */
function sameRowNeighborBlock(
  timelines: GeneratedSchedulePlan['timelines'],
  block: GeneratedScheduleBlock,
  side: 'prev' | 'next',
): GeneratedScheduleBlock | null {
  const row = timelines.find((t) => t.row === block.timelineRow);
  if (!row) return null;
  const ordered = [...row.blocks].sort(
    (a, b) => a.plannedStartMinute - b.plannedStartMinute || a.id.localeCompare(b.id),
  );
  const index = ordered.findIndex((b) => b.id === block.id);
  if (index < 0) return null;
  if (side === 'prev') return index > 0 ? ordered[index - 1]! : null;
  return index + 1 < ordered.length ? ordered[index + 1]! : null;
}

/** 同列前一班（同車輛，任何任務型別）結束＋轉乘空檔，之後才可發車——硬底線。 */
function sameRowVehicleFloorSeconds(
  timelines: GeneratedSchedulePlan['timelines'],
  block: GeneratedScheduleBlock,
  route: ShiftScheduleSelectedRoute,
  selectedRoutes: ShiftScheduleSelectedRoute[],
  minimumRecoveryTimeSeconds: number,
): number | null {
  const prevSameRow = sameRowNeighborBlock(timelines, block, 'prev');
  if (!prevSameRow) return null;
  const prevRoute = resolveRouteForBlock(prevSameRow, selectedRoutes);
  // 前一件不是正線（整備、調度、暫停…）：沒有換線緩衝這種概念可算，
  // 車就是得等它排定的結束時刻＋最低恢復時間，不能因為「不是正線」就當沒這回事。
  const interGap = prevRoute
    ? resolveInterTripGapSeconds({
        minimumRecoveryTimeSeconds,
        previousRouteSwitchBufferSeconds: prevRoute.switchBufferAfterSeconds,
        isRouteSwitch: prevRoute.routeId !== route.routeId,
        includeRecovery: shouldIncludeRecoveryForRouteSwitch({
          previousRoute: prevRoute,
          nextRoute: route,
          rotationRoutes: selectedRoutes,
        }),
        previousRoute: prevRoute,
        nextRoute: route,
      })
    : minimumRecoveryTimeSeconds;
  return minuteToSecond(prevSameRow.plannedEndMinute) + interGap;
}

/** 同列下一班（同車輛）發車前必須留給本班的空檔——硬頂線，換算成本班「最晚可發車秒數」。 */
function sameRowVehicleCeilingSeconds(
  timelines: GeneratedSchedulePlan['timelines'],
  block: GeneratedScheduleBlock,
  route: ShiftScheduleSelectedRoute,
  occupiedSeconds: number,
  selectedRoutes: ShiftScheduleSelectedRoute[],
  minimumRecoveryTimeSeconds: number,
): number | null {
  const nextSameRow = sameRowNeighborBlock(timelines, block, 'next');
  if (!nextSameRow) return null;
  const nextRoute = resolveRouteForBlock(nextSameRow, selectedRoutes);
  // 下一件不是正線：一樣沒有換線緩衝可算，退回最低恢復時間——不能因為「不是正線」
  // 就當它不存在，把本班往後推進下一件已排定任務（整備、調度…）的時段裡。
  const interGap = nextRoute
    ? resolveInterTripGapSeconds({
        minimumRecoveryTimeSeconds,
        previousRouteSwitchBufferSeconds: route.switchBufferAfterSeconds,
        isRouteSwitch: route.routeId !== nextRoute.routeId,
        includeRecovery: shouldIncludeRecoveryForRouteSwitch({
          previousRoute: route,
          nextRoute,
          rotationRoutes: selectedRoutes,
        }),
        previousRoute: route,
        nextRoute,
      })
    : minimumRecoveryTimeSeconds;
  const latestEnd = minuteToSecond(nextSameRow.plannedStartMinute) - interGap;
  return latestEnd - occupiedSeconds;
}

/**
 * Pass A：把 later 往目標班距推；推不到全額就推到能推的極限（同列下一班／maxPushSeconds／
 * 站位允許的最遠處），不是全有全無。
 */
function pushLaterForward(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  earlier: GeneratedScheduleBlock;
  later: GeneratedScheduleBlock;
  target: number;
  maxPushSeconds: number;
  minimumRecoveryTimeSeconds: number;
  protection: BerthProtectionContext;
}): boolean {
  const {
    timelines,
    selectedRoutes,
    earlier,
    later,
    target,
    maxPushSeconds,
    minimumRecoveryTimeSeconds,
    protection,
  } = args;

  const earlierStart = minuteToSecond(earlier.plannedStartMinute);
  const laterStart = minuteToSecond(later.plannedStartMinute);
  const route = resolveRouteForBlock(later, selectedRoutes);
  if (!route) return false;
  const occupied = occupancySecondsOf(later);

  const idealStart = snapUpToClockAlignSeconds(earlierStart + target);

  let floor = laterStart;
  const vehicleFloor = sameRowVehicleFloorSeconds(
    timelines,
    later,
    route,
    selectedRoutes,
    minimumRecoveryTimeSeconds,
  );
  if (vehicleFloor != null) {
    floor = Math.max(floor, snapUpToClockAlignSeconds(vehicleFloor));
  }

  let ceiling = laterStart + maxPushSeconds;
  const vehicleCeiling = sameRowVehicleCeilingSeconds(
    timelines,
    later,
    route,
    occupied,
    selectedRoutes,
    minimumRecoveryTimeSeconds,
  );
  if (vehicleCeiling != null) {
    ceiling = Math.min(ceiling, vehicleCeiling);
  }

  if (ceiling <= laterStart + 1e-9) return false;

  const candidate = Math.min(Math.max(idealStart, floor), ceiling);
  if (candidate <= laterStart + 1e-9) return false;

  const probe = {
    ...later,
    plannedStartMinute: secondToMinute(candidate),
    plannedEndMinute: secondToMinute(candidate + occupied),
  };
  const booked = bookBerthWindowsExcept(timelines, selectedRoutes, later.id, protection);
  const windows = projectProtectedBerthWindowsSeconds(probe, route, protection);
  const berthDelay = resolveBerthClearDelaySeconds(windows, booked);
  let finalStart = snapUpToClockAlignSeconds(candidate + berthDelay);

  if (finalStart > ceiling + 1e-9) {
    // 站位要求的空間超過同列下一班容許的頂線：退回頂線，若頂線本身仍撞站位就整段放棄
    // （寧可少推、不可硬佔造成重疊或新的站位碰撞）。
    const clampedProbe = {
      ...later,
      plannedStartMinute: secondToMinute(ceiling),
      plannedEndMinute: secondToMinute(ceiling + occupied),
    };
    const clampedWindows = projectProtectedBerthWindowsSeconds(
      clampedProbe,
      route,
      protection,
    );
    const clampedDelay = resolveBerthClearDelaySeconds(clampedWindows, booked);
    if (clampedDelay > 1e-6) return false;
    finalStart = ceiling;
  }

  if (finalStart <= laterStart + 1e-9) return false;

  /**
   * 延後發車＝車在來源站多待一段（真正到站的時刻不會跟著發車一起往後挪，只有
   * 發車晚了）。這段加長的停留也要驗證，不能只驗到 projectProtectedBerthWindowsSeconds
   * 算出來的那個窄窗——那個窗只含路線設定的靠站秒數，量不出「因為這次延後，車在
   * 來源站多佔了多久」。真的多佔的這段如果跟別台車在同一站的預約撞上，這次延後
   * 就不成立，不能假裝沒這回事直接推。
   */
  if (
    movedTripLingerCollides({
      timelines,
      selectedRoutes,
      block: later,
      route,
      newStartSecond: finalStart,
      newEndSecond: finalStart + occupied,
      booked,
      protection,
    })
  ) {
    return false;
  }

  later.plannedStartMinute = secondToMinute(finalStart);
  later.plannedEndMinute = secondToMinute(finalStart + occupied);
  return true;
}

/**
 * Pass B：Pass A 仍不夠時，把 earlier 往前拉，只花「earlier 相對於它自己上一班已經超過
 * target 的既有餘裕」，絕不把上游擠出新的 HEADWAY_BELOW_TARGET。
 */
function pullEarlierBackward(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  upstreamPredecessor: GeneratedScheduleBlock | null;
  earlier: GeneratedScheduleBlock;
  later: GeneratedScheduleBlock;
  target: number;
  minimumRecoveryTimeSeconds: number;
  protection: BerthProtectionContext;
}): boolean {
  const {
    timelines,
    selectedRoutes,
    intervals,
    attributes,
    upstreamPredecessor,
    earlier,
    later,
    target,
    minimumRecoveryTimeSeconds,
    protection,
  } = args;

  const earlierStart = minuteToSecond(earlier.plannedStartMinute);
  const laterStart = minuteToSecond(later.plannedStartMinute);
  const gap = laterStart - earlierStart;
  const needed = target - gap;
  if (needed <= 0) return false;

  const earlierRoute = resolveRouteForBlock(earlier, selectedRoutes);
  if (!earlierRoute) return false;
  const earlierOccupied = occupancySecondsOf(earlier);

  let floor = 0;
  const vehicleFloor = sameRowVehicleFloorSeconds(
    timelines,
    earlier,
    earlierRoute,
    selectedRoutes,
    minimumRecoveryTimeSeconds,
  );
  if (vehicleFloor != null) floor = Math.max(floor, vehicleFloor);

  // 不倒欠上游：earlier 不得拉進「與它自己上一班」的目標班距之內。
  if (upstreamPredecessor) {
    const upstreamStart = minuteToSecond(upstreamPredecessor.plannedStartMinute);
    const upstreamTarget = resolvePairHeadwayTarget(
      upstreamPredecessor,
      earlier,
      intervals,
      attributes,
    );
    if (upstreamTarget != null && upstreamTarget > 0) {
      floor = Math.max(floor, upstreamStart + upstreamTarget);
    }
  }

  const maxPull = Math.min(needed, earlierStart - floor);
  if (maxPull <= 1e-9) return false;

  let candidate = snapDownToClockAlignSeconds(earlierStart - maxPull);
  if (candidate < floor - 1e-9) candidate = snapUpToClockAlignSeconds(floor);
  if (candidate >= earlierStart - 1e-9) return false;

  // 不得把正線拉進同列前段整備尾巴（含跨夜晨段）
  const yardEnd = sameRowPrecedingYardEndSecond(timelines, earlier, candidate);
  if (yardEnd != null) {
    candidate = Math.max(candidate, snapUpToClockAlignSeconds(yardEnd));
  }
  if (candidate >= earlierStart - 1e-9) return false;

  const probe = {
    ...earlier,
    plannedStartMinute: secondToMinute(candidate),
    plannedEndMinute: secondToMinute(candidate + earlierOccupied),
  };
  const booked = bookBerthWindowsExcept(timelines, selectedRoutes, earlier.id, protection);
  const windows = projectProtectedBerthWindowsSeconds(probe, earlierRoute, protection);
  const berthDelay = resolveBerthClearDelaySeconds(windows, booked);
  const finalStart = snapUpToClockAlignSeconds(candidate + berthDelay);
  if (finalStart >= earlierStart - 1e-9) return false;
  // 往前拉＝終點站提早到、停更久；那段多出來的停留也要驗
  if (
    movedTripLingerCollides({
      timelines,
      selectedRoutes,
      block: earlier,
      route: earlierRoute,
      newStartSecond: finalStart,
      newEndSecond: finalStart + earlierOccupied,
      booked,
      protection,
    })
  ) {
    return false;
  }

  earlier.plannedStartMinute = secondToMinute(finalStart);
  earlier.plannedEndMinute = secondToMinute(finalStart + earlierOccupied);
  return true;
}

/**
 * 把同 routeId、跨時間線的正線發車拉開到至少目標班距。
 */
export function repairRouteHeadwaysBelowTarget(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  minimumRecoveryTimeSeconds?: number;
  /** 碰撞保護時間（秒）；預設 0＝維持舊行為 */
  collisionProtectionSeconds?: number;
  /** 單次後車最多往後推幾秒；過大易擠爆日界 */
  maxPushSeconds?: number;
}): GeneratedSchedulePlan['timelines'] {
  const {
    selectedRoutes,
    intervals,
    attributes,
    minimumRecoveryTimeSeconds = 0,
    collisionProtectionSeconds = 0,
    maxPushSeconds = 600,
  } = args;
  const timelines = args.timelines.map((timeline) => ({
    ...timeline,
    blocks: timeline.blocks.map((block) => ({ ...block })),
  }));
  // 站位求解只用「2 × 碰撞保護時間」這條約束，刻意<strong>不</strong>把末站滯留算進來：
  // 滯留長度由班距脈衝決定，往後延只會讓滯留變短、衝突照舊，卻會把班次延到上限，
  // 連帶讓 densify 拉不回班距、運能崩掉。滯留改由最終驗證回報、
  // 由整備後調度班次與站位讓渡去實際處理（詳見 BerthProtectionContext 註解）。
  const protection: BerthProtectionContext = { collisionProtectionSeconds };

  const byRoute = new Map<string, GeneratedScheduleBlock[]>();
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger') continue;
      // 整備後的調度營運班次（entry_service）刻意排除：它的任務是把車盡快送到正線
      // 起點站上工，發車時刻由正線開始時刻往回推算，不必遷就同方向班距。
      // validatePassengerHeadway 本來就只檢查 template_bar，這裡對齊，
      // 避免為了滿足一個根本沒被檢查的班距而延後調度車。
      // 註：它們仍以 bookBerthWindowsExcept／同列鄰居身分限制其他班次，物理約束不受影響。
      if (block.source !== 'template_bar') continue;
      const routeId = block.routeId?.trim();
      if (!routeId) continue;
      const list = byRoute.get(routeId) ?? [];
      list.push(block);
      byRoute.set(routeId, list);
    }
  }

  /**
   * 連環擠壓（同路線 3 班以上擠在一起）時，單輪 forward sweep 會卡死：
   * 中段那班還沒讓開，後段那班的站位探測就先撞上它，整段放棄，即使中段
   * 本身下一輪就會被推開。多輪跑到收斂（或到輪數上限）才能把整串鬆開。
   * 每輪都重新排序——block 被推／拉後時間順序可能反轉，必須用當下順序配對。
   */
  const MAX_ROUNDS = 6;
  for (const [, blocks] of byRoute) {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      blocks.sort(
        (a, b) =>
          a.plannedStartMinute - b.plannedStartMinute
          || a.timelineRow - b.timelineRow
          || a.id.localeCompare(b.id),
      );

      let changed = false;

      // Pass A：逐對往後推，就地累積（later 被推動後即成下一對的 earlier）。
      for (let i = 1; i < blocks.length; i += 1) {
        const earlier = blocks[i - 1]!;
        const later = blocks[i]!;
        const earlierStart = minuteToSecond(earlier.plannedStartMinute);
        const laterStart = minuteToSecond(later.plannedStartMinute);
        const gap = laterStart - earlierStart;
        if (gap <= 0) continue;

        const target = resolvePairHeadwayTarget(earlier, later, intervals, attributes);
        if (target == null || target <= 0) continue;
        if (gap + REPAIR_SLACK_SECONDS >= target) continue;

        if (
          pushLaterForward({
            timelines,
            selectedRoutes,
            earlier,
            later,
            target,
            maxPushSeconds,
            minimumRecoveryTimeSeconds,
            protection,
          })
        ) {
          changed = true;
        }
      }

      // Pass B：Pass A 後仍有殘餘落差的對，改從 earlier 端要既有餘裕，不倒欠上游。
      for (let i = 1; i < blocks.length; i += 1) {
        const earlier = blocks[i - 1]!;
        const later = blocks[i]!;
        const earlierStart = minuteToSecond(earlier.plannedStartMinute);
        const laterStart = minuteToSecond(later.plannedStartMinute);
        const gap = laterStart - earlierStart;
        if (gap <= 0) continue;

        const target = resolvePairHeadwayTarget(earlier, later, intervals, attributes);
        if (target == null || target <= 0) continue;
        if (gap + REPAIR_SLACK_SECONDS >= target) continue;

        if (
          pullEarlierBackward({
            timelines,
            selectedRoutes,
            intervals,
            attributes,
            upstreamPredecessor: i >= 2 ? blocks[i - 2]! : null,
            earlier,
            later,
            target,
            minimumRecoveryTimeSeconds,
            protection,
          })
        ) {
          changed = true;
        }
      }

      if (!changed) break;
    }
  }

  return timelines;
}
