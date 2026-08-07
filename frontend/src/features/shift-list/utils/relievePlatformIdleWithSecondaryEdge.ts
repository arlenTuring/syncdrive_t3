/**
 * 站位讓渡（文件 §8.2）。
 *
 * 車跑完一輪交路，在共用站位空等下一個班距脈衝才會被指派新的一輪——這段空等
 * 不是換線緩衝，是實打實的滯留，會跟別列車在同一站位撞上。單一站位不能開分身，
 * 也不能把「不重疊」的規則放鬆，所以只剩兩條路：這台車自己快點走，或是先繞去
 * 別的站位等，時間到了再回來接原本排定的下一段。
 *
 * 這裡做的是後者：沿關聯圖的<strong>次要邊</strong>找一條能繞回「下一段起點站」的
 * 路徑（廣度優先，最多 {@link MAX_RELIEF_HOPS} 跳），若整條路徑的時間剛好塞得進
 * 這段空等、繞完又接得回原本排定的下一段，就把這幾段「站位讓渡」插進去
 * ——車照樣載客（計入運能），只是不算輪替圈數，也不受班距約束（跟進場載客
 * entry_service 同一類特例）。
 *
 * 出去繞一圈常常是兩跳（例如 T3上行 → 備用N2W上行，再 備用N2W下行 → T3下行），
 * 所以不能只找一跳；但也不能無限延伸，跳數上限見 {@link MAX_RELIEF_HOPS}。
 *
 * 塞不進去、或該站根本沒有次要邊：不硬解，維持 STATION_BERTH_PROTECTION_GAP
 * 警告，回報給使用者自己決定要不要調整關聯圖或增加時間線。
 */
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { resolveRouteForBlock } from './buildBlockStationDepartures';
import {
  resolveInterTripGapSeconds,
  resolvePassengerRouteOccupancy,
  shouldIncludeRecoveryForRouteSwitch,
} from './schedule-engine/physics';
import type { RouteSuccessorPolicy } from './schedule-engine/routeSuccessorPolicy';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedScheduleTimeline,
} from './schedule-engine/types';
import { minuteToSecond, pushIssue, secondToMinute } from './schedule-engine/types';
import {
  collectStationBerthOccupancies,
  findStationBerthCollisions,
  resolveSameRowIdleOccupiedUntilMinute,
  resolveSameRowNextBlockStartMinute,
} from './stationBerthOccupancy';

function routeStartStation(route: ShiftScheduleSelectedRoute): string | null {
  return route.stationIds[0]?.trim() || null;
}

function routeEndStation(route: ShiftScheduleSelectedRoute): string | null {
  const last = route.stationIds[route.stationIds.length - 1];
  return last?.trim() || null;
}

/** 相鄰兩段之間該留的間隔（換線／恢復），與其他呼叫端同一套公式 */
function gapBetween(args: {
  minimumRecoveryTimeSeconds: number;
  fromRoute: ShiftScheduleSelectedRoute;
  toRoute: ShiftScheduleSelectedRoute;
  rotationRoutes: ShiftScheduleSelectedRoute[];
}): number {
  const { minimumRecoveryTimeSeconds, fromRoute, toRoute, rotationRoutes } = args;
  return resolveInterTripGapSeconds({
    minimumRecoveryTimeSeconds,
    previousRouteSwitchBufferSeconds: fromRoute.switchBufferAfterSeconds,
    isRouteSwitch: fromRoute.routeId !== toRoute.routeId,
    includeRecovery: shouldIncludeRecoveryForRouteSwitch({
      previousRoute: fromRoute,
      nextRoute: toRoute,
      rotationRoutes,
    }),
    previousRoute: fromRoute,
    nextRoute: toRoute,
  });
}

/**
 * 讓渡路徑最多幾跳。
 *
 * 出去繞一圈通常是「出去 → 回來」兩跳（例如 T3上行 → 備用N2W上行，
 * 再 備用N2W下行 → T3下行）。給到 3 跳留一點餘地，但不能再多——
 * 跳數一多就變成替使用者發明一條長路徑，而且每一跳都在載客，
 * 排錯的代價不是「少一班」而是「多開一班錯的」。
 */
const MAX_RELIEF_HOPS = 3;

type ReliefHop = {
  instanceId: string;
  route: ShiftScheduleSelectedRoute;
};

/**
 * 從 <code>fromInstanceId</code> 出發，沿關聯圖的<strong>次要邊</strong>找一條
 * 能回到 <code>requiredTerminalStationId</code> 的路徑（廣度優先，最短的先回傳）。
 *
 * 只走次要邊：優先邊是正常輪替要用的，拿去繞路會打亂交路。
 * 同一個節點不重複進入，避免在環上繞不完。
 */
function findReliefChain(args: {
  successorPolicy: RouteSuccessorPolicy;
  fromInstanceId: string;
  /** 車現在實際停在哪一站——第一跳必須從這裡發車，否則車根本開不了那一趟 */
  fromStationId: string;
  requiredTerminalStationId: string;
}): ReliefHop[] | null {
  const { successorPolicy, fromInstanceId, fromStationId, requiredTerminalStationId } = args;
  const queue: Array<{ instanceId: string; stationId: string; chain: ReliefHop[] }> = [
    { instanceId: fromInstanceId, stationId: fromStationId, chain: [] },
  ];
  const visited = new Set<string>([fromInstanceId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.chain.length >= MAX_RELIEF_HOPS) continue;
    const nextIds = successorPolicy.secondarySuccessors.get(current.instanceId) ?? [];
    for (const nextId of nextIds) {
      if (visited.has(nextId)) continue;
      const route = successorPolicy.routesByInstanceId.get(nextId);
      if (!route) continue;
      // 沒有占用資料的路線算不出時刻，整條路徑就不可用
      if (!resolvePassengerRouteOccupancy(route)) continue;
      // 站點必須接得起來：這一趟的起站要正好是車現在所在的站。
      // 關聯圖的邊理論上已隱含連續性，但這裡是自己走圖找路徑，不能假設——
      // 少了這一關就可能排出「車在 A 站，卻要它跑一趟從 B 站發車」的班次。
      if (routeStartStation(route) !== current.stationId) continue;
      const terminal = routeEndStation(route);
      if (!terminal) continue;
      const chain = [...current.chain, { instanceId: nextId, route }];
      if (terminal === requiredTerminalStationId) return chain;
      visited.add(nextId);
      queue.push({ instanceId: nextId, stationId: terminal, chain });
    }
  }
  return null;
}

/**
 * 對單一「跑完一輪、空等時撞到別列車」的情況，試著找一條次要邊路徑塞進空檔。
 * 找得到就回傳要插入的區塊（可能不只一段）；找不到回傳空陣列
 * （呼叫端維持原樣，交給最終驗證回報）。
 */
function tryBuildReliefBlocks(args: {
  earlierBlock: GeneratedScheduleBlock;
  nextBlock: GeneratedScheduleBlock;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  successorPolicy: RouteSuccessorPolicy;
  minimumRecoveryTimeSeconds: number;
}): GeneratedScheduleBlock[] {
  const { earlierBlock, nextBlock, selectedRoutes, successorPolicy, minimumRecoveryTimeSeconds } =
    args;

  // 只在「下一段是真正排定的正線」時才處理；下一段是整備等其他情況，
  // 讓渡沒有明確的回程目標站，交給既有的整備讓渡／推移邏輯處理。
  if (nextBlock.taskType !== 'passenger' || nextBlock.source !== 'template_bar') {
    return [];
  }
  if (!nextBlock.routeId) return [];

  const earlierRoute = resolveRouteForBlock(earlierBlock, selectedRoutes);
  const nextRoute = resolveRouteForBlock(nextBlock, selectedRoutes);
  if (!earlierRoute || !nextRoute) return [];

  const earlierInstanceId =
    earlierBlock.routeInstanceId?.trim()
    || earlierRoute.instanceId?.trim()
    || earlierRoute.routeId;
  const requiredNextOrigin = routeStartStation(nextRoute);
  if (!requiredNextOrigin) return [];

  // 車現在停在前一趟的終點站；讓渡路徑必須從這裡出發，繞完回到下一段的起點站
  const parkedStationId = routeEndStation(earlierRoute);
  if (!parkedStationId) return [];

  const chain = findReliefChain({
    successorPolicy,
    fromInstanceId: earlierInstanceId,
    fromStationId: parkedStationId,
    requiredTerminalStationId: requiredNextOrigin,
  });
  if (!chain || chain.length === 0) return [];

  // 依序把每一跳排進空檔；任何一跳排不下就整條放棄，不留半條路徑在版面上
  const nextStartSecond = minuteToSecond(nextBlock.plannedStartMinute);
  const blocks: GeneratedScheduleBlock[] = [];
  let cursorSecond = minuteToSecond(earlierBlock.plannedEndMinute);
  let previousRoute = earlierRoute;

  for (const hop of chain) {
    const occupancy = resolvePassengerRouteOccupancy(hop.route);
    if (!occupancy) return [];
    const startSecond =
      cursorSecond
      + gapBetween({
        minimumRecoveryTimeSeconds,
        fromRoute: previousRoute,
        toRoute: hop.route,
        rotationRoutes: selectedRoutes,
      });
    const endSecond = startSecond + occupancy.occupancySeconds;
    blocks.push({
      id: `relief-${earlierBlock.id}-${hop.route.routeId}-${startSecond}`,
      timelineRow: earlierBlock.timelineRow,
      taskType: 'passenger',
      label: `站位讓渡 · ${hop.route.routeName || hop.route.routeId}`,
      routeId: hop.route.routeId,
      routeInstanceId: hop.instanceId,
      routeName: hop.route.routeName,
      routeCode: hop.route.routeCode ?? undefined,
      anchorStartMinute: secondToMinute(startSecond),
      plannedStartMinute: secondToMinute(startSecond),
      plannedEndMinute: secondToMinute(endSecond),
      travelSeconds: occupancy.travelSeconds,
      dwellSeconds: occupancy.dwellSeconds,
      source: 'relief_loop',
    });
    cursorSecond = endSecond;
    previousRoute = hop.route;
  }

  // 繞完還要接得回原本排定的下一段，接不上就整條放棄
  const returnGap = gapBetween({
    minimumRecoveryTimeSeconds,
    fromRoute: previousRoute,
    toRoute: nextRoute,
    rotationRoutes: selectedRoutes,
  });
  if (cursorSecond + returnGap > nextStartSecond + 1e-9) return [];

  return blocks;
}

/** 關聯圖上這個節點的全部出邊（優先在前、次要在後） */
function listGraphSuccessorIds(
  successorPolicy: RouteSuccessorPolicy,
  instanceId: string,
): string[] {
  return [
    ...(successorPolicy.prioritySuccessors.get(instanceId) ?? []),
    ...(successorPolicy.secondarySuccessors.get(instanceId) ?? []),
  ];
}

type BerthSwapPair = {
  parkTrip: { instanceId: string; route: ShiftScheduleSelectedRoute };
  leaveTrip: { instanceId: string; route: ShiftScheduleSelectedRoute };
};

/**
 * 找一組「停在別的站位」的替身路線（文件 §8.2）。
 *
 * 車跑完 A 停在 X、等著跑 B 從 X 出發，而 X 被別台車需要時，最省的解法
 * <strong>不是繞路、也不是延後</strong>，而是把這一對班次換成停別的站位的替身：
 * A → A'（終點不是 X）、B → B'（起點不是 X）。<strong>時刻完全不動</strong>，
 * 只換路線，所以對班距零影響——這正是使用者在關聯圖上準備備用路線的用意。
 *
 * 換過去必須整條接得起來：前一趟接得上 A'、A' 接得上 B'、B' 接得上後一趟。
 */
function findBerthSwapPair(args: {
  successorPolicy: RouteSuccessorPolicy;
  /** 前一趟（決定 A' 有哪些合法選擇）；沒有前一趟就不限制出邊 */
  previousInstanceId: string | null;
  /** 後一趟（B' 必須接得上它）；沒有就不限制 */
  followingInstanceId: string | null;
  currentParkInstanceId: string;
  currentLeaveInstanceId: string;
  /** 要讓出來的站位 */
  parkedStationId: string;
  /** A' 必須從這裡發車（＝ A 原本的起點站，車是從那裡開過來的） */
  requiredParkTripOriginStationId: string;
}): BerthSwapPair | null {
  const {
    successorPolicy,
    previousInstanceId,
    followingInstanceId,
    currentParkInstanceId,
    currentLeaveInstanceId,
    parkedStationId,
    requiredParkTripOriginStationId,
  } = args;

  const parkCandidateIds = previousInstanceId
    ? listGraphSuccessorIds(successorPolicy, previousInstanceId)
    : [...successorPolicy.routesByInstanceId.keys()];

  for (const parkId of parkCandidateIds) {
    if (parkId === currentParkInstanceId) continue;
    const parkRoute = successorPolicy.routesByInstanceId.get(parkId);
    if (!parkRoute || !resolvePassengerRouteOccupancy(parkRoute)) continue;
    // 車是從原本的起點站開過來的，替身也得從那裡發車
    if (routeStartStation(parkRoute) !== requiredParkTripOriginStationId) continue;
    const parkTerminal = routeEndStation(parkRoute);
    // 換了還是停同一個站位就沒意義
    if (!parkTerminal || parkTerminal === parkedStationId) continue;

    for (const leaveId of listGraphSuccessorIds(successorPolicy, parkId)) {
      if (leaveId === currentLeaveInstanceId) continue;
      const leaveRoute = successorPolicy.routesByInstanceId.get(leaveId);
      if (!leaveRoute || !resolvePassengerRouteOccupancy(leaveRoute)) continue;
      // 停哪就從哪出發
      if (routeStartStation(leaveRoute) !== parkTerminal) continue;
      if (followingInstanceId) {
        // 換完還要接得回原本排定的後一趟
        if (!listGraphSuccessorIds(successorPolicy, leaveId).includes(followingInstanceId)) {
          continue;
        }
        const followingRoute = successorPolicy.routesByInstanceId.get(followingInstanceId);
        if (!followingRoute) continue;
        if (routeEndStation(leaveRoute) !== routeStartStation(followingRoute)) continue;
      }
      return {
        parkTrip: { instanceId: parkId, route: parkRoute },
        leaveTrip: { instanceId: leaveId, route: leaveRoute },
      };
    }
  }
  return null;
}

/** 該站位在這段時間內有沒有被<strong>別列</strong>車佔著 */
function stationBusyForOtherRows(
  occupancies: StationBerthOccupancy[],
  stationId: string,
  selfTimelineRow: number,
  fromMinute: number,
  toMinute: number,
): boolean {
  return occupancies.some(
    (occ) =>
      occ.stationId === stationId
      && occ.timelineRow !== selfTimelineRow
      && occ.startMinute < toMinute - 1e-9
      && occ.protectedUntilMinute > fromMinute + 1e-9,
  );
}

/** 同一列、依時間排序的正線班次（用來找前一趟／後一趟） */
function sameRowMainlineBlocks(
  timeline: GeneratedScheduleTimeline,
): GeneratedScheduleBlock[] {
  return [...timeline.blocks]
    .filter((block) => block.taskType === 'passenger' && block.source === 'template_bar')
    .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
}

function instanceIdOf(
  block: GeneratedScheduleBlock,
  selectedRoutes: ShiftScheduleSelectedRoute[],
): string | null {
  const trimmed = block.routeInstanceId?.trim();
  if (trimmed) return trimmed;
  const route = resolveRouteForBlock(block, selectedRoutes);
  return route ? route.instanceId?.trim() || route.routeId : null;
}

/**
 * 策略一：把「停在爭用站位的那一對班次」換成停別的站位的替身路線。
 * 成功就地改寫並回報 <code>STATION_BERTH_BACKUP_USED</code>，回傳 true。
 */
function trySwapToBackupBerth(args: {
  timelines: GeneratedScheduleTimeline[];
  occupancies: StationBerthOccupancy[];
  timeline: GeneratedScheduleTimeline;
  /** 跑完之後停在爭用站位的那一趟 */
  parkBlock: GeneratedScheduleBlock;
  /** 等到時間才從該站位開走的那一趟 */
  leaveBlock: GeneratedScheduleBlock;
  parkedStationId: string;
  parkedStationName: string;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  successorPolicy: RouteSuccessorPolicy;
  minimumRecoveryTimeSeconds: number;
  warnings: FeasibilityIssue[];
}): boolean {
  const {
    occupancies,
    timeline,
    parkBlock,
    leaveBlock,
    parkedStationId,
    parkedStationName,
    selectedRoutes,
    successorPolicy,
    minimumRecoveryTimeSeconds,
    warnings,
  } = args;

  if (leaveBlock.taskType !== 'passenger' || leaveBlock.source !== 'template_bar') {
    return false;
  }
  const parkRoute = resolveRouteForBlock(parkBlock, selectedRoutes);
  const leaveRoute = resolveRouteForBlock(leaveBlock, selectedRoutes);
  if (!parkRoute || !leaveRoute) return false;
  const parkInstanceId = instanceIdOf(parkBlock, selectedRoutes);
  const leaveInstanceId = instanceIdOf(leaveBlock, selectedRoutes);
  if (!parkInstanceId || !leaveInstanceId) return false;
  const parkOrigin = routeStartStation(parkRoute);
  if (!parkOrigin) return false;

  const ordered = sameRowMainlineBlocks(timeline);
  const parkIndex = ordered.findIndex((block) => block.id === parkBlock.id);
  const leaveIndex = ordered.findIndex((block) => block.id === leaveBlock.id);
  if (parkIndex < 0 || leaveIndex < 0) return false;
  const previousBlock = parkIndex > 0 ? ordered[parkIndex - 1] : null;
  const followingBlock = leaveIndex + 1 < ordered.length ? ordered[leaveIndex + 1] : null;

  const pair = findBerthSwapPair({
    successorPolicy,
    previousInstanceId: previousBlock ? instanceIdOf(previousBlock, selectedRoutes) : null,
    followingInstanceId: followingBlock
      ? instanceIdOf(followingBlock, selectedRoutes)
      : null,
    currentParkInstanceId: parkInstanceId,
    currentLeaveInstanceId: leaveInstanceId,
    parkedStationId,
    requiredParkTripOriginStationId: parkOrigin,
  });
  if (!pair) return false;

  const parkOccupancy = resolvePassengerRouteOccupancy(pair.parkTrip.route);
  const leaveOccupancy = resolvePassengerRouteOccupancy(pair.leaveTrip.route);
  if (!parkOccupancy || !leaveOccupancy) return false;

  // 時刻不動，只換路線；但替身的行駛時間不一樣，結束時刻要重算並確認還排得下
  const parkStartSecond = minuteToSecond(parkBlock.plannedStartMinute);
  const parkEndSecond = parkStartSecond + parkOccupancy.occupancySeconds;
  const leaveStartSecond = minuteToSecond(leaveBlock.plannedStartMinute);
  const leaveEndSecond = leaveStartSecond + leaveOccupancy.occupancySeconds;

  const parkToLeaveGap = gapBetween({
    minimumRecoveryTimeSeconds,
    fromRoute: pair.parkTrip.route,
    toRoute: pair.leaveTrip.route,
    rotationRoutes: selectedRoutes,
  });
  if (parkEndSecond + parkToLeaveGap > leaveStartSecond + 1e-9) return false;

  if (followingBlock) {
    const followingRoute = resolveRouteForBlock(followingBlock, selectedRoutes);
    if (!followingRoute) return false;
    const leaveToFollowingGap = gapBetween({
      minimumRecoveryTimeSeconds,
      fromRoute: pair.leaveTrip.route,
      toRoute: followingRoute,
      rotationRoutes: selectedRoutes,
    });
    if (
      leaveEndSecond + leaveToFollowingGap
      > minuteToSecond(followingBlock.plannedStartMinute) + 1e-9
    ) {
      return false;
    }
  }

  // 換過去的新站位不能同樣被別列車佔著，否則只是把碰撞搬家
  const newParkStationId = routeEndStation(pair.parkTrip.route)!;
  if (
    stationBusyForOtherRows(
      occupancies,
      newParkStationId,
      parkBlock.timelineRow,
      secondToMinute(parkEndSecond),
      leaveBlock.plannedStartMinute,
    )
  ) {
    return false;
  }

  const fromLabel = `${parkBlock.routeCode ?? parkRoute.routeCode ?? parkRoute.routeName}`
    + ` → ${leaveBlock.routeCode ?? leaveRoute.routeCode ?? leaveRoute.routeName}`;
  const toLabel = `${pair.parkTrip.route.routeCode ?? pair.parkTrip.route.routeName}`
    + ` → ${pair.leaveTrip.route.routeCode ?? pair.leaveTrip.route.routeName}`;

  parkBlock.routeId = pair.parkTrip.route.routeId;
  parkBlock.routeInstanceId = pair.parkTrip.instanceId;
  parkBlock.routeName = pair.parkTrip.route.routeName;
  parkBlock.routeCode = pair.parkTrip.route.routeCode ?? undefined;
  parkBlock.plannedEndMinute = secondToMinute(parkEndSecond);
  parkBlock.travelSeconds = parkOccupancy.travelSeconds;
  parkBlock.dwellSeconds = parkOccupancy.dwellSeconds;

  leaveBlock.routeId = pair.leaveTrip.route.routeId;
  leaveBlock.routeInstanceId = pair.leaveTrip.instanceId;
  leaveBlock.routeName = pair.leaveTrip.route.routeName;
  leaveBlock.routeCode = pair.leaveTrip.route.routeCode ?? undefined;
  leaveBlock.plannedEndMinute = secondToMinute(leaveEndSecond);
  leaveBlock.travelSeconds = leaveOccupancy.travelSeconds;
  leaveBlock.dwellSeconds = leaveOccupancy.dwellSeconds;

  pushIssue(warnings, {
    code: 'STATION_BERTH_BACKUP_USED',
    severity: 'warning',
    kind: 'policy',
    message:
      `時間線 ${parkBlock.timelineRow}：跑完後會停在「${parkedStationName}」擋住別台車，`
      + `已改跑備用路線停到別的站位（${fromLabel} 改為 ${toLabel}；發車時刻不變）`,
    detail: {
      timelineRow: parkBlock.timelineRow,
      stationId: parkedStationId,
      stationName: parkedStationName,
      blockId: parkBlock.id,
      earlierBlockId: parkBlock.id,
      laterBlockId: leaveBlock.id,
      fromRouteIds: [parkRoute.routeId, leaveRoute.routeId],
      toRouteIds: [pair.parkTrip.route.routeId, pair.leaveTrip.route.routeId],
      newParkStationId,
    },
  });
  return true;
}

export function relievePlatformIdleWithSecondaryEdge(args: {
  timelines: GeneratedScheduleTimeline[];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  successorPolicy?: RouteSuccessorPolicy | null;
  minimumRecoveryTimeSeconds: number;
  collisionProtectionSeconds: number;
  warnings: FeasibilityIssue[];
}): GeneratedScheduleTimeline[] {
  const {
    selectedRoutes,
    successorPolicy,
    minimumRecoveryTimeSeconds,
    collisionProtectionSeconds,
    warnings,
  } = args;
  if (!successorPolicy?.valid) return args.timelines;
  if (collisionProtectionSeconds <= 0) return args.timelines;

  const timelines = args.timelines.map((timeline) => ({
    ...timeline,
    blocks: timeline.blocks.map((block) => ({ ...block })),
  }));

  const occupancies = collectStationBerthOccupancies(timelines, selectedRoutes, {
    collisionProtectionSeconds,
  });
  const collisions = findStationBerthCollisions(occupancies, selectedRoutes);

  const blockById = new Map<string, GeneratedScheduleBlock>();
  const rowByBlockId = new Map<string, GeneratedScheduleTimeline>();
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      blockById.set(block.id, block);
      rowByBlockId.set(block.id, timeline);
    }
  }

  const handledEarlierBlockIds = new Set<string>();

  for (const hit of collisions) {
    const earlierBlock = blockById.get(hit.earlier.blockId);
    if (!earlierBlock) continue;
    if (handledEarlierBlockIds.has(earlierBlock.id)) continue;
    if (earlierBlock.taskType !== 'passenger' || earlierBlock.source !== 'template_bar') {
      continue;
    }

    // 只處理「空等造成的碰撞」——earlierBlock 自己真的滯留到下一個任務才走；
    // 不是滯留、只是純粹兩台車排太近的一般碰撞，讓渡幫不上忙，交給既有機制。
    const idleUntilMinute = resolveSameRowIdleOccupiedUntilMinute(timelines, earlierBlock);
    if (idleUntilMinute == null) continue;

    const nextStartMinute = resolveSameRowNextBlockStartMinute(timelines, earlierBlock);
    if (nextStartMinute == null) continue;
    const timeline = rowByBlockId.get(earlierBlock.id);
    if (!timeline) continue;
    const nextBlock = timeline.blocks.find(
      (b) => b.id !== earlierBlock.id && b.plannedStartMinute + 1e-9 >= earlierBlock.plannedEndMinute
        && Math.abs(b.plannedStartMinute - nextStartMinute) < 1e-6,
    );
    if (!nextBlock) continue;

    // 策略一（優先）：換一組停別的站位的替身路線。時刻完全不動，對班距零影響，
    // 所以能用就先用；換不成才考慮繞路（策略二，會多開班次也會吃掉空檔）。
    if (
      trySwapToBackupBerth({
        timelines,
        occupancies,
        timeline,
        parkBlock: earlierBlock,
        leaveBlock: nextBlock,
        parkedStationId: hit.stationId,
        parkedStationName: hit.stationName,
        selectedRoutes,
        successorPolicy,
        minimumRecoveryTimeSeconds,
        warnings,
      })
    ) {
      handledEarlierBlockIds.add(earlierBlock.id);
      continue;
    }

    const reliefBlocks = tryBuildReliefBlocks({
      earlierBlock,
      nextBlock,
      selectedRoutes,
      successorPolicy,
      minimumRecoveryTimeSeconds,
    });
    if (reliefBlocks.length === 0) continue;

    timeline.blocks.push(...reliefBlocks);
    timeline.blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    handledEarlierBlockIds.add(earlierBlock.id);

    const pathLabel = reliefBlocks
      .map((relief) => relief.routeCode ?? relief.routeName)
      .join(' → ');
    pushIssue(warnings, {
      code: 'STATION_BERTH_RELIEF_INSERTED',
      severity: 'warning',
      kind: 'policy',
      message:
        `時間線 ${earlierBlock.timelineRow}：跑完一輪在「${hit.stationName}」空等會撞到別列車，`
        + `已沿次要邊「${pathLabel}」先繞去別站等`,
      detail: {
        timelineRow: earlierBlock.timelineRow,
        stationId: hit.stationId,
        stationName: hit.stationName,
        earlierBlockId: earlierBlock.id,
        nextBlockId: nextBlock.id,
        reliefBlockIds: reliefBlocks.map((relief) => relief.id),
        reliefRouteIds: reliefBlocks.map((relief) => relief.routeId),
        reliefHopCount: reliefBlocks.length,
      },
    });
  }

  return timelines;
}
