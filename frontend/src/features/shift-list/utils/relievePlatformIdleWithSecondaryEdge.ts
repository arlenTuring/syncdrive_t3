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
