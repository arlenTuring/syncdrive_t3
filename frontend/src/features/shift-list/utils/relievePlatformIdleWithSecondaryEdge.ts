/**
 * 站位讓渡（文件 §8.2）。
 *
 * 車跑完一輪交路，在共用站位空等下一個班距脈衝才會被指派新的一輪——這段空等
 * 不是換線緩衝，是實打實的滯留，會跟別列車在同一站位撞上。單一站位不能開分身，
 * 也不能把「不重疊」的規則放鬆，所以只剩兩條路：這台車自己快點走，或是先繞去
 * 別的站位等，時間到了再回來接原本排定的下一段。
 *
 * 這裡做的是後者：如果該站位有關聯圖次要邊，且次要邊繞一趟的時間剛好塞得進
 * 這段空等、繞完又能直接接上原本排定的下一段起點站，就插入這一趟「站位讓渡」
 * ——車照樣載客（計入運能），只是不算輪替圈數，也不受班距約束（跟進場載客
 * entry_service 同一類特例）。
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
 * 對單一「跑完一輪、空等時撞到別列車」的情況，試著找一條次要邊塞進空檔。
 * 找得到就回傳要插入的區塊；找不到回傳 null（呼叫端維持原樣，交給最終驗證回報）。
 */
function tryBuildReliefBlock(args: {
  earlierBlock: GeneratedScheduleBlock;
  nextBlock: GeneratedScheduleBlock;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  successorPolicy: RouteSuccessorPolicy;
  minimumRecoveryTimeSeconds: number;
}): GeneratedScheduleBlock | null {
  const { earlierBlock, nextBlock, selectedRoutes, successorPolicy, minimumRecoveryTimeSeconds } =
    args;

  // 只在「下一段是真正排定的正線」時才處理；下一段是整備等其他情況，
  // 讓渡沒有明確的回程目標站，交給既有的整備讓渡／推移邏輯處理。
  if (nextBlock.taskType !== 'passenger' || nextBlock.source !== 'template_bar') {
    return null;
  }
  if (!nextBlock.routeId) return null;

  const earlierRoute = resolveRouteForBlock(earlierBlock, selectedRoutes);
  const nextRoute = resolveRouteForBlock(nextBlock, selectedRoutes);
  if (!earlierRoute || !nextRoute) return null;

  const earlierInstanceId =
    earlierBlock.routeInstanceId?.trim()
    || earlierRoute.instanceId?.trim()
    || earlierRoute.routeId;
  const requiredNextOrigin = routeStartStation(nextRoute);
  if (!requiredNextOrigin) return null;

  const secondaryIds = successorPolicy.secondarySuccessors.get(earlierInstanceId) ?? [];
  if (secondaryIds.length === 0) return null;

  const earlierEndSecond = minuteToSecond(earlierBlock.plannedEndMinute);
  const nextStartSecond = minuteToSecond(nextBlock.plannedStartMinute);

  for (const secondaryInstanceId of secondaryIds) {
    const reliefRoute = successorPolicy.routesByInstanceId.get(secondaryInstanceId);
    if (!reliefRoute) continue;
    const reliefTerminal = routeEndStation(reliefRoute);
    // MVP：只走「一次次要邊就直接接回下一段起點站」這種最簡單、最安全的情況；
    // 需要多跳才能繞回去的路徑不在這次範圍內，留給使用者自己調整關聯圖。
    if (!reliefTerminal || reliefTerminal !== requiredNextOrigin) continue;

    const occupancy = resolvePassengerRouteOccupancy(reliefRoute);
    if (!occupancy) continue;

    const outGap = gapBetween({
      minimumRecoveryTimeSeconds,
      fromRoute: earlierRoute,
      toRoute: reliefRoute,
      rotationRoutes: selectedRoutes,
    });
    const reliefStartSecond = earlierEndSecond + outGap;
    const reliefEndSecond = reliefStartSecond + occupancy.occupancySeconds;

    const returnGap = gapBetween({
      minimumRecoveryTimeSeconds,
      fromRoute: reliefRoute,
      toRoute: nextRoute,
      rotationRoutes: selectedRoutes,
    });
    if (reliefEndSecond + returnGap > nextStartSecond + 1e-9) continue;

    return {
      id: `relief-${earlierBlock.id}-${reliefRoute.routeId}-${reliefStartSecond}`,
      timelineRow: earlierBlock.timelineRow,
      taskType: 'passenger',
      label: `站位讓渡 · ${reliefRoute.routeName || reliefRoute.routeId}`,
      routeId: reliefRoute.routeId,
      routeInstanceId: secondaryInstanceId,
      routeName: reliefRoute.routeName,
      routeCode: reliefRoute.routeCode ?? undefined,
      anchorStartMinute: secondToMinute(reliefStartSecond),
      plannedStartMinute: secondToMinute(reliefStartSecond),
      plannedEndMinute: secondToMinute(reliefEndSecond),
      travelSeconds: occupancy.travelSeconds,
      dwellSeconds: occupancy.dwellSeconds,
      source: 'relief_loop',
    };
  }

  return null;
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

    const reliefBlock = tryBuildReliefBlock({
      earlierBlock,
      nextBlock,
      selectedRoutes,
      successorPolicy,
      minimumRecoveryTimeSeconds,
    });
    if (!reliefBlock) continue;

    timeline.blocks.push(reliefBlock);
    timeline.blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    handledEarlierBlockIds.add(earlierBlock.id);

    pushIssue(warnings, {
      code: 'STATION_BERTH_RELIEF_INSERTED',
      severity: 'warning',
      kind: 'policy',
      message:
        `時間線 ${earlierBlock.timelineRow}：跑完一輪在「${hit.stationName}」空等會撞到別列車，`
        + `已插入次要邊「${reliefBlock.routeCode ?? reliefBlock.routeName}」先繞去別站等`,
      detail: {
        timelineRow: earlierBlock.timelineRow,
        stationId: hit.stationId,
        stationName: hit.stationName,
        earlierBlockId: earlierBlock.id,
        nextBlockId: nextBlock.id,
        reliefBlockId: reliefBlock.id,
        reliefRouteId: reliefBlock.routeId,
      },
    });
  }

  return timelines;
}
