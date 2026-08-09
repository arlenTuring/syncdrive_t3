/**
 * 停靠點站位佔用約束（生成期）：
 * 1) 依發車時刻順序預約各站「到站～離站」
 * 2) 在關聯圖拓撲候選中選局部無衝突解（優先邊 → 次要邊 → 同起點）
 * 3) 可延後／可等；選了哪條路線就定在那條終點，下一趟再由該節點出邊決定
 * 4) 仍解不了才留給 validate 的 STATION_BERTH_COLLISION
 */
import {
  resolveSelectedRouteInstanceId,
  type ShiftScheduleSelectedRoute,
} from '../types/create';
import {
  buildBlockStationDepartures,
  resolveRouteForBlock,
} from './buildBlockStationDepartures';
import {
  isStationDwellRequired,
  looksLikeDefaultCrossoverPortalStationId,
  resolveInterTripGapSeconds,
  resolvePassengerRouteOccupancy,
  resolveRouteOriginStationId,
  resolveRouteTerminalStationId,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  snapUpToClockAlignSeconds,
  shouldIncludeRecoveryForRouteSwitch,
} from './schedule-engine/physics';
import {
  listNextInstanceCandidates,
  type RouteSuccessorPolicy,
} from './schedule-engine/routeSuccessorPolicy';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
} from './schedule-engine/types';
import { minuteToSecond, pushIssue, secondToMinute } from './schedule-engine/types';
import { resolveSameRowIdleOccupiedUntilMinute } from './stationBerthOccupancy';

/** 單一路線為清站位可接受的最大延後（秒）；可被同列整備開頭再夾緊 */
export const DEFAULT_STATION_BERTH_MAX_DELAY_SECONDS = 120;

/** 換線後可等待銜接時，不以「下一正線時刻」硬夾延後上限 */
export const STATION_BERTH_WAIT_MAX_DELAY_SECONDS = 1800;

/**
 * 同類型站位約束 warning 每次 enforceStationBerthConstraints 的報告上限。
 * 超出後累計計數，結束時補一則「另有 N 則未顯示」摘要，避免 warning fatigue。
 */
export const DEFAULT_STATION_BERTH_WARNING_REPORT_LIMIT = 50;

export type BerthWindowSec = {
  stationId: string;
  stationName: string;
  startSecond: number;
  /**
   * 佔用尾端。走 {@link projectProtectedBerthWindowsSeconds} 時已含末站滯留與
   * 碰撞保護時間；同一台車彼此比對時要改用 {@link naturalEndSecond}。
   */
  endSecond: number;
  /** 自然離站尾端（不含滯留與碰撞保護）。沒開保護時等於 endSecond。 */
  naturalEndSecond?: number;
  /**
   * 這個窗屬於哪一列（哪一台車）。
   * <strong>碰撞保護是不同車之間的事</strong>——同一台車前後兩趟在折返站交接
   * （到站、停一下、再從同一站開出）不可能自己撞自己，不該被要求隔 2 × 保護時間。
   */
  timelineRow?: number;
};

export type StationBerthConstraintResult = {
  timelines: GeneratedSchedulePlan['timelines'];
  delayedCount: number;
  backupSwitchedCount: number;
  unresolvedCount: number;
};

function minPresenceSeconds(): number {
  return SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS;
}

/**
 * 與 collectStationBerthOccupancies 同一套自然在站定義（秒）。
 */
export function projectBlockBerthWindowsSeconds(
  block: GeneratedScheduleBlock,
  route: ShiftScheduleSelectedRoute,
): BerthWindowSec[] {
  if (block.taskType !== 'passenger') return [];
  const stops = buildBlockStationDepartures(block, route);
  if (stops.length === 0) return [];

  const out: BerthWindowSec[] = [];
  const minPresence = minPresenceSeconds();

  for (let si = 0; si < stops.length; si += 1) {
    const stop = stops[si]!;
    const dwellMeta = route.stationDwells.find((d) => d.stationId === stop.stationId);
    const isPortal =
      looksLikeDefaultCrossoverPortalStationId(stop.stationId)
      || (dwellMeta != null && !isStationDwellRequired(dwellMeta));
    const isTerminal = si === stops.length - 1;
    const isOrigin = si === 0;

    let startSecond = minuteToSecond(stop.arrivalMinute);
    let endSecond = minuteToSecond(Math.max(stop.departureMinute, stop.arrivalMinute));

    if (isPortal && !isOrigin && !isTerminal && stop.dwellSeconds <= 0) {
      continue;
    }

    if (endSecond <= startSecond + 1e-9) {
      if (stop.dwellSeconds > 0 || isOrigin || isTerminal) {
        endSecond = startSecond + minPresence;
      } else {
        continue;
      }
    }

    out.push({
      stationId: stop.stationId,
      stationName: stop.stationName,
      startSecond,
      endSecond,
      naturalEndSecond: endSecond,
      timelineRow: block.timelineRow,
    });
  }

  return out;
}

/**
 * 碰撞保護的計算材料。
 *
 * 全引擎只有這一份「兩台車在同一個站位要隔多久」的定義；
 * 站位求解、班距補疏、班距修復、整備後調度班次、最終驗證全部走
 * {@link projectProtectedBerthWindowsSeconds}，不各自維護一套判斷
 * ——過去五處各算各的，其中一處漏掉跨列掃描，就漏放了真實碰撞。
 */
export type BerthProtectionContext = {
  /**
   * 碰撞保護時間（秒）。B 車到站不得早於 A 車實際離站 + 2 × 此值。
   *
   * <strong>0 ＝整組防碰撞判定關閉</strong>：不加保護時間，也不把末站滯留算進佔用，
   * 完全退回 2026-08-07 之前「只要求到離站區間不重疊」的行為。
   * 使用者把欄位填 0 就是這個意思——一個數字一個開關，不要有半開的狀態。
   */
  collisionProtectionSeconds: number;
  /**
   * 要把「末站滯留」算進佔用時，傳全部時間線；不傳就只用班次自己的到離站時刻。
   *
   * <strong>只有「對滯留做得出決策」的呼叫端才可以傳。</strong>
   * 目前是：最終驗證（回報）、整備後調度班次落點（可換交路或略過）、
   * 站位讓渡（可插次要邊繞開）。
   *
   * <strong>站位求解器／densify／repair 一律不可傳</strong>，原因不是保守，是這個
   * 約束對它們無效且有害：
   * 1. <strong>槓桿不對。</strong>它們唯一能做的是「把這一趟往後延」，但滯留長度
   *    取決於「下一個任務何時開始」（由班距脈衝決定，改不了）。往後延只會讓滯留
   *    變短、衝突照舊，於是每輪都延到上限（後幾輪是 1800 秒）卻永遠解不掉。
   * 2. <strong>會毀掉班距。</strong>densify 的工作是把班次往前拉回目標班距以拉高
   *    PPHPD；滯留佔用讓每個共用站位看起來幾乎全天被佔滿，densify 一趟都拉不動，
   *    運能直接崩掉（2026-08-08 實測：600 秒規則班距變成
   *    00:30→00:52→01:02→01:27，見 §17）。
   *
   * 一句話：<strong>滯留佔用是「判斷與決策」的輸入，不是「排點」的約束</strong>；
   * 2 × 碰撞保護時間才是排點約束（小幅延後就能解，槓桿對得上）。
   */
  idleOccupancyTimelines?: GeneratedSchedulePlan['timelines'];
};

/**
 * 受碰撞保護的站位佔用窗（秒）。
 *
 * 在 {@link projectBlockBerthWindowsSeconds} 的自然到離站區間上做兩件事：
 * 1. <strong>末站滯留</strong>：這一趟結束後如果車還停在末站等下一個任務，
 *    佔用延長到真正開走的時刻（{@link resolveSameRowIdleOccupiedUntilMinute}）。
 * 2. <strong>碰撞保護</strong>：每個站位的佔用尾端再加 2 × 碰撞保護時間。
 *
 * 兩台車的窗只要不重疊，就同時滿足「不同時佔位」與「到站晚於前車離站 + 2×保護」。
 * 因為兩邊都加了同樣的尾巴，這個判定是對稱的，誰先誰後都成立。
 *
 * 注意這是<strong>防碰撞下限</strong>：它只會把班次往外推，不會拿來當「可以擠到這麼近」
 * 的目標。班距約束在各自的呼叫端照舊執行，最後取較嚴的一邊。
 */
export function projectProtectedBerthWindowsSeconds(
  block: GeneratedScheduleBlock,
  route: ShiftScheduleSelectedRoute,
  protection?: BerthProtectionContext | null,
): BerthWindowSec[] {
  const windows = projectBlockBerthWindowsSeconds(block, route);
  if (!protection || protection.collisionProtectionSeconds <= 0) return windows;
  if (windows.length === 0) return windows;

  const protectionSeconds = protection.collisionProtectionSeconds * 2;

  // 末站滯留：只有最後一個站位會被延長——車開過中間站時不會停在那裡等。
  // 只有傳了 idleOccupancyTimelines 的呼叫端才算滯留（理由見型別註解）。
  let idleUntilSecond: number | null = null;
  if (protection.idleOccupancyTimelines) {
    const idleUntilMinute = resolveSameRowIdleOccupiedUntilMinute(
      protection.idleOccupancyTimelines,
      block,
    );
    if (idleUntilMinute != null) idleUntilSecond = minuteToSecond(idleUntilMinute);
  }

  const lastIndex = windows.length - 1;
  return windows.map((win, index) => {
    // 滯留是「車真的還停在那裡」，屬於自然佔用的一部分，所以也寫進 naturalEndSecond；
    // 碰撞保護時間才是只對別台車生效的那一段。
    const naturalEnd =
      index === lastIndex && idleUntilSecond != null
        ? Math.max(win.endSecond, idleUntilSecond)
        : win.endSecond;
    return {
      ...win,
      naturalEndSecond: naturalEnd,
      endSecond: naturalEnd + protectionSeconds,
    };
  });
}

/**
 * 為了避開已預約站位，整趟需延後的秒數（已對齊 10s）。
 * 以「出發平移」假設：所有站到／離同步 +D。
 */
export function resolveBerthClearDelaySeconds(
  proposed: BerthWindowSec[],
  booked: BerthWindowSec[],
): number {
  if (proposed.length === 0 || booked.length === 0) return 0;

  let delay = 0;
  for (let iter = 0; iter < 24; iter += 1) {
    let bump = 0;
    for (const win of proposed) {
      for (const prior of booked) {
        if (prior.stationId !== win.stationId) continue;
        // 同一列＝同一台車：碰撞保護不適用（自己不會撞自己），改用自然離站尾端。
        // 跨列才是真正的兩台車，用含保護時間的尾端。
        const sameVehicle =
          win.timelineRow != null
          && prior.timelineRow != null
          && win.timelineRow === prior.timelineRow;
        const priorEnd = sameVehicle
          ? prior.naturalEndSecond ?? prior.endSecond
          : prior.endSecond;
        const winEnd = sameVehicle ? win.naturalEndSecond ?? win.endSecond : win.endSecond;
        const a0 = win.startSecond + delay;
        const a1 = winEnd + delay;
        if (a0 < priorEnd - 1e-9 && a1 > prior.startSecond + 1e-9) {
          bump = Math.max(bump, priorEnd - a0);
        }
      }
    }
    if (bump <= 1e-9) break;
    delay = snapUpToClockAlignSeconds(delay + bump);
  }
  return delay;
}

/**
 * 改派／候選路線不得拆掉同車交路：前趟終點＝本趟起點、本趟終點＝後趟起點。
 */
export function routePreservesTurnaroundContinuity(args: {
  route: ShiftScheduleSelectedRoute;
  previousRoute: ShiftScheduleSelectedRoute | null;
  nextRoute: ShiftScheduleSelectedRoute | null;
}): boolean {
  const { route, previousRoute, nextRoute } = args;
  if (previousRoute) {
    const terminal = resolveRouteTerminalStationId(previousRoute);
    const origin = resolveRouteOriginStationId(route);
    if (!terminal || !origin || terminal !== origin) return false;
  }
  if (nextRoute) {
    const terminal = resolveRouteTerminalStationId(route);
    const origin = resolveRouteOriginStationId(nextRoute);
    if (!terminal || !origin || terminal !== origin) return false;
  }
  return true;
}

export type TopologyRouteCandidate = {
  route: ShiftScheduleSelectedRoute;
  /** 越小越優先 */
  rank: number;
  source: 'planned' | 'priority' | 'secondary' | 'ring' | 'same_origin';
};

/**
 * 站位／交路候選＝關聯圖拓撲（優→次）＋同起點可銜接路線。
 * 不是「誰是誰的備用槽」；在 T3 選 TN 或 TNB，取決於前一跳出邊與站位是否清得開。
 */
export function listTopologyRouteCandidates(args: {
  selectedRoutes: ShiftScheduleSelectedRoute[];
  currentRoute: ShiftScheduleSelectedRoute;
  previousRoute: ShiftScheduleSelectedRoute | null;
  successorPolicy?: RouteSuccessorPolicy | null;
}): TopologyRouteCandidate[] {
  const { selectedRoutes, currentRoute, previousRoute, successorPolicy } = args;
  const byId = new Map<string, TopologyRouteCandidate>();

  const put = (
    route: ShiftScheduleSelectedRoute,
    rank: number,
    source: TopologyRouteCandidate['source'],
  ) => {
    const id = resolveSelectedRouteInstanceId(route);
    const prev = byId.get(id);
    if (!prev || rank < prev.rank) {
      byId.set(id, { route, rank, source });
    }
  };

  put(currentRoute, 0, 'planned');

  const policy = successorPolicy?.valid ? successorPolicy : null;
  if (previousRoute) {
    if (
      !routePreservesTurnaroundContinuity({
        route: currentRoute,
        previousRoute,
        nextRoute: null,
      })
    ) {
      byId.delete(resolveSelectedRouteInstanceId(currentRoute));
    }
  }
  if (previousRoute && policy) {
    const previousId = resolveSelectedRouteInstanceId(previousRoute);
    for (const next of listNextInstanceCandidates(policy, previousId, {
      allowSecondary: true,
    })) {
      const route =
        policy.routesByInstanceId.get(next.instanceId)
        ?? selectedRoutes.find(
          (item) => resolveSelectedRouteInstanceId(item) === next.instanceId,
        );
      if (!route) continue;
      if (
        !routePreservesTurnaroundContinuity({
          route,
          previousRoute,
          nextRoute: null,
        })
      ) {
        continue;
      }
      const rank =
        next.kind === 'secondary' ? 20 : next.kind === 'ring' ? 15 : 10;
      put(route, rank, next.kind);
    }
  } else if (!previousRoute && policy) {
    const origin = resolveRouteOriginStationId(currentRoute);
    if (origin) {
      for (const [instanceId, route] of policy.routesByInstanceId) {
        if (resolveRouteOriginStationId(route) !== origin) continue;
        const preferIdx = policy.canonicalCycleInstanceIds.indexOf(instanceId);
        const startIdx = policy.startInstanceIds.indexOf(instanceId);
        if (preferIdx >= 0) {
          put(route, 10 + preferIdx, 'priority');
        } else if (startIdx >= 0) {
          put(route, 30 + startIdx, 'same_origin');
        } else {
          put(route, 40, 'same_origin');
        }
      }
    }
  }

  for (const route of selectedRoutes) {
    if (previousRoute) {
      if (
        !routePreservesTurnaroundContinuity({
          route,
          previousRoute,
          nextRoute: null,
        })
      ) {
        continue;
      }
    } else {
      const origin = resolveRouteOriginStationId(currentRoute);
      if (!origin || resolveRouteOriginStationId(route) !== origin) continue;
    }
    put(route, 50, 'same_origin');
  }

  // 若前一跳改選後沒有任一連續候選，仍保留本趟（留給驗證／延後）
  if (byId.size === 0) {
    put(currentRoute, 100, 'planned');
  }

  return [...byId.values()].sort(
    (a, b) =>
      a.rank - b.rank
      || (a.route.routeCode ?? '').localeCompare(b.route.routeCode ?? ''),
  );
}

function withProposedStart(
  block: GeneratedScheduleBlock,
  startSecond: number,
  occupancySeconds: number,
  route: ShiftScheduleSelectedRoute,
): GeneratedScheduleBlock {
  const endSecond = startSecond + occupancySeconds;
  return {
    ...block,
    routeInstanceId: resolveSelectedRouteInstanceId(route),
    routeId: route.routeId,
    routeName: route.routeName,
    routeCode: route.routeCode ?? undefined,
    plannedStartMinute: secondToMinute(startSecond),
    plannedEndMinute: secondToMinute(endSecond),
    travelSeconds:
      resolvePassengerRouteOccupancy(route)?.travelSeconds ?? block.travelSeconds,
    dwellSeconds:
      resolvePassengerRouteOccupancy(route)?.dwellSeconds ?? block.dwellSeconds,
  };
}

function occupancySecondsForBlockRoute(
  block: GeneratedScheduleBlock,
  route: ShiftScheduleSelectedRoute,
): number {
  const resolved = resolvePassengerRouteOccupancy(route);
  if (resolved) {
    const current =
      minuteToSecond(block.plannedEndMinute) - minuteToSecond(block.plannedStartMinute);
    // 保留展開時已壓縮的占用（快～均之間），但不低於最快
    if (
      current > 0
      && current >= resolved.minOccupancySeconds - 1e-9
      && current <= resolved.occupancySeconds + 1e-9
      && block.routeId === route.routeId
    ) {
      return snapUpToClockAlignSeconds(current);
    }
    return resolved.occupancySeconds;
  }
  return Math.max(
    SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
    minuteToSecond(block.plannedEndMinute) - minuteToSecond(block.plannedStartMinute),
  );
}

function maxDelayAllowedSeconds(args: {
  preferredStartSecond: number;
  occupancySeconds: number;
  nextSameRowStartSecond: number | null;
  gapBeforeNextSeconds: number;
  maxDelaySeconds: number;
}): number {
  const { preferredStartSecond, occupancySeconds, nextSameRowStartSecond, gapBeforeNextSeconds, maxDelaySeconds } =
    args;
  let cap = Math.max(0, maxDelaySeconds);
  if (nextSameRowStartSecond != null) {
    const latestStart =
      nextSameRowStartSecond - gapBeforeNextSeconds - occupancySeconds;
    cap = Math.min(cap, Math.max(0, latestStart - preferredStartSecond));
  }
  return snapUpToClockAlignSeconds(Math.max(0, cap));
}

/**
 * 「可以等」＝同列下一正線開得晚，不是跟前一趟時間線重疊。
 * 提交本趟後若下一腳開始早於本趟結束＋空檔，整趟平移開。
 */
export function pushSameRowNextAfterPrevious(args: {
  previousBlock: GeneratedScheduleBlock;
  previousRoute: ShiftScheduleSelectedRoute;
  nextPassenger: GeneratedScheduleBlock | undefined | null;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
}): number {
  const {
    previousBlock,
    previousRoute,
    nextPassenger,
    selectedRoutes,
    minimumRecoveryTimeSeconds,
  } = args;
  if (!nextPassenger) return 0;
  const nextRoute = resolveRouteForBlock(nextPassenger, selectedRoutes);
  const gapSeconds = nextRoute
    ? resolveInterTripGapSeconds({
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
      })
    : Math.max(0, minimumRecoveryTimeSeconds);
  const prevEnd = minuteToSecond(previousBlock.plannedEndMinute);
  const earliestStart = snapUpToClockAlignSeconds(prevEnd + gapSeconds);
  const nextStart = minuteToSecond(nextPassenger.plannedStartMinute);
  if (nextStart + 1e-9 >= earliestStart) return 0;
  const occupancySeconds = Math.max(
    SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
    minuteToSecond(nextPassenger.plannedEndMinute) - nextStart,
  );
  nextPassenger.plannedStartMinute = secondToMinute(earliestStart);
  nextPassenger.plannedEndMinute = secondToMinute(earliestStart + occupancySeconds);
  return earliestStart - nextStart;
}

/** 整備區塊：車進去之後就不在正線上，出來時停在該設施的出場站 */
function isYardBlockForContinuity(block: GeneratedScheduleBlock): boolean {
  if (block.source !== 'template_bar') return false;
  return (
    block.taskType === 'charging'
    || block.taskType === 'servicing'
    || block.taskType === 'inspection'
    || block.taskType === 'standby'
  );
}

/**
 * 同一列往前找「可以拿來要求站點連續」的前一趟正線。
 *
 * <strong>碰到整備就停</strong>並回傳 undefined——車進了整備，位置由整備的出場站決定，
 * 整備前那一趟的終點站已經不能用來推斷車現在在哪。這一班要當成重新起頭。
 */
function resolveSameRowPreviousPassengerBeforeYard(
  rowBlocks: GeneratedScheduleBlock[],
  blockIndex: number,
): GeneratedScheduleBlock | undefined {
  if (blockIndex <= 0) return undefined;
  for (let i = blockIndex - 1; i >= 0; i -= 1) {
    const candidate = rowBlocks[i]!;
    if (isYardBlockForContinuity(candidate)) return undefined;
    if (candidate.taskType === 'passenger') return candidate;
  }
  return undefined;
}

function evaluateCandidate(args: {
  block: GeneratedScheduleBlock;
  route: ShiftScheduleSelectedRoute;
  preferredStartSecond: number;
  booked: BerthWindowSec[];
  protection: BerthProtectionContext;
}): { delaySeconds: number; occupancySeconds: number; windows: BerthWindowSec[] } {
  const occupancySeconds = occupancySecondsForBlockRoute(args.block, args.route);
  const probe = withProposedStart(
    args.block,
    args.preferredStartSecond,
    occupancySeconds,
    args.route,
  );
  const windows = projectProtectedBerthWindowsSeconds(probe, args.route, args.protection);
  const delaySeconds = resolveBerthClearDelaySeconds(windows, args.booked);
  return { delaySeconds, occupancySeconds, windows };
}

/**
 * 站位約束：在拓撲候選中挑延後最少且清得開的局部解；就地改写 timelines。
 * 選線後不強制成對改下一腳——下一趟稍後依「新前一跳」的出邊再排，可等。
 */
export function enforceStationBerthConstraints(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds?: number;
  /** 碰撞保護時間（秒）；預設 0＝維持舊行為（只要求區間不重疊） */
  collisionProtectionSeconds?: number;
  maxDelaySeconds?: number;
  successorPolicy?: RouteSuccessorPolicy | null;
  warnings?: FeasibilityIssue[];
  /**
   * 每種站位約束 warning code 最多寫入幾則；超出後補一則匯總 warning，而不是逐則塞入。
   * 預設 DEFAULT_STATION_BERTH_WARNING_REPORT_LIMIT。
   */
  maxWarningsPerCode?: number;
}): StationBerthConstraintResult {
  const {
    selectedRoutes,
    minimumRecoveryTimeSeconds = 0,
    collisionProtectionSeconds = 0,
    maxDelaySeconds = DEFAULT_STATION_BERTH_MAX_DELAY_SECONDS,
    successorPolicy = null,
    warnings,
    maxWarningsPerCode = DEFAULT_STATION_BERTH_WARNING_REPORT_LIMIT,
  } = args;

  // 各 code 已報告計數（P4：超出上限後改推匯總摘要）
  const warnCount: Record<string, number> = {};
  const pushBerthWarning = (issue: FeasibilityIssue) => {
    if (!warnings) return;
    const key = issue.code;
    warnCount[key] = (warnCount[key] ?? 0) + 1;
    if (warnCount[key] <= maxWarningsPerCode) {
      pushIssue(warnings, issue);
    }
  };

  const timelines = args.timelines.map((timeline) => ({
    ...timeline,
    blocks: timeline.blocks.map((block) => ({ ...block })),
  }));

  // 就地改寫 timelines，所以滯留判定讀到的一定是當下最新的版面
  // 站位求解只用「2 × 碰撞保護時間」這條約束，刻意<strong>不</strong>把末站滯留算進來：
  // 滯留長度由班距脈衝決定，往後延只會讓滯留變短、衝突照舊，卻會把班次延到上限，
  // 連帶讓 densify 拉不回班距、運能崩掉。滯留改由最終驗證回報、
  // 由整備後調度班次與站位讓渡去實際處理（詳見 BerthProtectionContext 註解）。
  const protection: BerthProtectionContext = { collisionProtectionSeconds };

  const passengerBlocks: GeneratedScheduleBlock[] = [];
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger') continue;
      if (!resolveRouteForBlock(block, selectedRoutes)) continue;
      passengerBlocks.push(block);
    }
  }
  passengerBlocks.sort(
    (a, b) =>
      a.plannedStartMinute - b.plannedStartMinute
      || a.timelineRow - b.timelineRow
      || a.id.localeCompare(b.id),
  );

  const blocksByRow = new Map<number, GeneratedScheduleBlock[]>();
  for (const timeline of timelines) {
    const list = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    blocksByRow.set(timeline.row, list);
  }

  const booked: BerthWindowSec[] = [];
  let delayedCount = 0;
  let backupSwitchedCount = 0;
  let unresolvedCount = 0;

  for (const block of passengerBlocks) {
    const initialRoute = resolveRouteForBlock(block, selectedRoutes);
    if (!initialRoute) continue;

    const preferredStartSecond = minuteToSecond(block.plannedStartMinute);
    const rowBlocks = blocksByRow.get(block.timelineRow) ?? [];
    const blockIndex = rowBlocks.findIndex((item) => item.id === block.id);
    const nextPassenger =
      blockIndex >= 0
        ? rowBlocks.slice(blockIndex + 1).find((item) => item.taskType === 'passenger')
        : undefined;
    // 中間夾著整備就<strong>不算</strong>有前一趟：車進去整備、出來是停在整備的出場站，
    // 跟整備前那一趟的終點站無關。忽略這件事的話，求解器會拿整備前那趟的終點
    // 去要求站點連續，把「整備後第一班」改成從別站發車的路線——車根本不在那裡。
    // （2026-08-08 實測：行檢出場站 T3上行、對齊已正確給 TN，卻被這裡改成 NT。）
    const previousPassenger = resolveSameRowPreviousPassengerBeforeYard(
      rowBlocks,
      blockIndex,
    );
    // 前一正線可能已被改寫：候選以改寫後拓撲為準
    const previousRoute =
      previousPassenger != null
        ? resolveRouteForBlock(previousPassenger, selectedRoutes)
        : null;

    const topologyCandidates = listTopologyRouteCandidates({
      selectedRoutes,
      currentRoute: initialRoute,
      previousRoute,
      successorPolicy,
    });

    type Choice = {
      route: ShiftScheduleSelectedRoute;
      rank: number;
      source: TopologyRouteCandidate['source'];
      delaySeconds: number;
      occupancySeconds: number;
      windows: BerthWindowSec[];
      maxAllowed: number;
    };

    const scoreCandidate = (candidate: TopologyRouteCandidate): Choice => {
      const { route } = candidate;
      const evaluated = evaluateCandidate({
        block,
        route,
        preferredStartSecond,
        booked,
        protection,
      });
      // 站位延後只受預設上限限制。不要用後面的充電／整備牆把上限夾成 0，
      // 否則 10～30 秒的站位衝突解不掉；整備開頭重疊交給後續正線讓渡處理。
      const maxAllowed = maxDelayAllowedSeconds({
        preferredStartSecond,
        occupancySeconds: evaluated.occupancySeconds,
        nextSameRowStartSecond: null,
        gapBeforeNextSeconds: 0,
        maxDelaySeconds,
      });
      return {
        route,
        rank: candidate.rank,
        source: candidate.source,
        delaySeconds: evaluated.delaySeconds,
        occupancySeconds: evaluated.occupancySeconds,
        windows: evaluated.windows,
        maxAllowed,
      };
    };

    const scored = topologyCandidates.map(scoreCandidate);
    const feasible = scored
      .filter((c) => c.delaySeconds <= c.maxAllowed + 1e-9)
      .sort(
        (a, b) =>
          a.delaySeconds - b.delaySeconds
          || a.rank - b.rank
          || a.occupancySeconds - b.occupancySeconds,
      );
    const bestEffort = [...scored].sort(
      (a, b) =>
        a.delaySeconds - b.delaySeconds
        || a.rank - b.rank
        || a.occupancySeconds - b.occupancySeconds,
    );
    const chosen = feasible[0] ?? bestEffort[0]!;
    // scoreCandidate.maxAllowed 等於呼叫端 maxDelaySeconds（目前未再夾 next）
    const delayCap = Math.max(0, maxDelaySeconds);
    let appliedDelay = Math.min(Math.max(0, chosen.delaySeconds), delayCap);
    if (chosen.delaySeconds > delayCap + 1e-9) {
      unresolvedCount += 1;
    }

    let startSecond = preferredStartSecond + appliedDelay;
    Object.assign(
      block,
      withProposedStart(block, startSecond, chosen.occupancySeconds, chosen.route),
    );

    // 改選／延後後「可等」下一腳，但同列不得與本趟重疊
    pushSameRowNextAfterPrevious({
      previousBlock: block,
      previousRoute: chosen.route,
      nextPassenger,
      selectedRoutes,
      minimumRecoveryTimeSeconds,
    });

    if (
      resolveSelectedRouteInstanceId(chosen.route)
      !== resolveSelectedRouteInstanceId(initialRoute)
    ) {
      backupSwitchedCount += 1;
      pushBerthWarning({
        code: 'STATION_BERTH_BACKUP_USED',
        severity: 'warning',
        message:
          `為避開停靠點衝突，這一趟改跑「${chosen.route.routeCode ?? chosen.route.routeName}」`
          + `（原本是「${initialRoute.routeCode ?? initialRoute.routeName}」）`,
        detail: {
          blockId: block.id,
          timelineRow: block.timelineRow,
          fromRouteId: initialRoute.routeId,
          toRouteId: chosen.route.routeId,
          delaySeconds: appliedDelay,
          topologySource: chosen.source,
          topologyRank: chosen.rank,
        },
      });
    }

    if (appliedDelay > 0) {
      delayedCount += 1;
      pushBerthWarning({
        code: 'STATION_BERTH_DELAYED',
        severity: 'warning',
        message: `為避開站位碰撞，已延後 ${appliedDelay} 秒（${chosen.route.routeCode ?? chosen.route.routeName}）`,
        detail: {
          blockId: block.id,
          timelineRow: block.timelineRow,
          delaySeconds: appliedDelay,
          routeId: chosen.route.routeId,
        },
      });
    }

    // 若仍與已預約重疊，在 delayCap 內再補延；仍清不開則不預約，留給下一輪／最終 pass
    let committed = projectProtectedBerthWindowsSeconds(block, chosen.route, protection);
    let residual = resolveBerthClearDelaySeconds(committed, booked);
    if (residual > 1e-9) {
      const room = Math.max(0, delayCap - appliedDelay);
      const bump = Math.min(residual, room);
      if (bump > 1e-9) {
        appliedDelay += bump;
        startSecond = preferredStartSecond + appliedDelay;
        Object.assign(
          block,
          withProposedStart(block, startSecond, chosen.occupancySeconds, chosen.route),
        );
        pushSameRowNextAfterPrevious({
          previousBlock: block,
          previousRoute: chosen.route,
          nextPassenger,
          selectedRoutes,
          minimumRecoveryTimeSeconds,
        });
        committed = projectProtectedBerthWindowsSeconds(block, chosen.route, protection);
        residual = resolveBerthClearDelaySeconds(committed, booked);
      }
    }

    if (residual <= 1e-9) {
      for (const win of committed) booked.push(win);
    } else {
      unresolvedCount += 1;
    }
  }

  // P4：超出 maxWarningsPerCode 的部分補摘要 warning
  if (warnings) {
    for (const [code, count] of Object.entries(warnCount)) {
      if (count > maxWarningsPerCode) {
        const hidden = count - maxWarningsPerCode;
        pushIssue(warnings, {
          code: code as FeasibilityIssue['code'],
          severity: 'warning',
          message: `（以上已顯示 ${maxWarningsPerCode} 則；另有 ${hidden} 則相同類型的站位約束 warning 未列出）`,
          detail: { hiddenCount: hidden, totalCount: count },
        });
      }
    }
  }

  return {
    timelines,
    delayedCount,
    backupSwitchedCount,
    unresolvedCount,
  };
}
