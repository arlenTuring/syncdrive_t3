import type { ScheduleTask, TaskTypeKey } from '../../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import { resolveRotationOffsetForExitStation } from '../maintenanceFirstTripOrigins';
import {
  resolveRouteIndexInRotation,
  resolveStartInstanceId,
  routeAssignmentAlgorithmId,
  type RouteSuccessorPolicy,
} from './routeSuccessorPolicy';
import {
  resolveInterTripGapSeconds,
  resolvePassengerRouteOccupancy,
  shouldIncludeRecoveryForRouteSwitch,
  snapUpToClockAlignSeconds,
} from './physics';
import { minuteToSecond } from './types';
import { resolveEffectiveRouteTravelSeconds } from '../stationLegTravel';

/** 約束貪婪路線指派（Constraint-Greedy Route Assignment）— 執行順序為硬輪替 */
export const ROUTE_ASSIGNMENT_ALGORITHM = 'constraint-greedy-v1' as const;

export type RouteAssignmentAlgorithm =
  | typeof ROUTE_ASSIGNMENT_ALGORITHM
  | 'route-assignment-relation-graph-v1';

export { routeAssignmentAlgorithmId };

export type RouteAssignmentDecision = {
  taskId: string;
  route: ShiftScheduleSelectedRoute;
  occupancySeconds: number;
  travelSeconds: number;
  dwellSeconds: number;
  score: number;
  feasible: boolean;
};

function resolvePassengerOccupancy(route: ShiftScheduleSelectedRoute): {
  occupancySeconds: number;
  minOccupancySeconds: number;
  travelSeconds: number;
  dwellSeconds: number;
} | null {
  return resolvePassengerRouteOccupancy(route);
}

function findNextPassengerAnchorSecond(
  rowPassengerTasks: ScheduleTask[],
  currentTaskId: string,
  currentStartSecond: number,
): number | null {
  for (const task of rowPassengerTasks) {
    if (task.id === currentTaskId) continue;
    const anchorSecond = minuteToSecond(task.startMinute);
    if (anchorSecond > currentStartSecond) return anchorSecond;
  }
  return null;
}

/**
 * 評分愈低愈佳（診斷／破平手用）。
 * 硬約束：下一錨點衝突、兩趟空檔不足（恢復 + 換線相加）。
 */
export function scoreRouteCandidate(args: {
  route: ShiftScheduleSelectedRoute;
  occupancySeconds: number;
  travelSeconds: number;
  startSecond: number;
  nextAnchorSecond: number | null;
  previousRouteId: string | null;
  previousRoute?: ShiftScheduleSelectedRoute | null;
  previousEndSecond: number | null;
  previousSwitchBufferSeconds: number;
  minimumRecoveryTimeSeconds: number;
  usageCount: number;
  rotationRoutes?: ShiftScheduleSelectedRoute[];
}): { score: number; feasible: boolean } {
  const {
    route,
    occupancySeconds,
    travelSeconds,
    startSecond,
    nextAnchorSecond,
    previousRouteId,
    previousRoute,
    previousEndSecond,
    previousSwitchBufferSeconds,
    minimumRecoveryTimeSeconds,
    usageCount,
    rotationRoutes = [],
  } = args;

  const minTravel =
    resolveEffectiveRouteTravelSeconds(route)?.minTravelTimeSeconds
    ?? route.minTravelTimeSeconds
    ?? route.avgTravelTimeSeconds
    ?? 0;
  const dwellSeconds = occupancySeconds - travelSeconds;
  const minOccupancy = snapUpToClockAlignSeconds(minTravel + dwellSeconds);
  const minEndSecond = startSecond + minOccupancy;

  let score = 0;
  let feasible = true;

  if (nextAnchorSecond != null) {
    const gapAfterMin = nextAnchorSecond - minEndSecond;
    if (gapAfterMin < 0) {
      feasible = false;
      score += 1_000_000 + Math.abs(gapAfterMin);
    } else if (gapAfterMin < minimumRecoveryTimeSeconds) {
      feasible = false;
      score += 500_000 + (minimumRecoveryTimeSeconds - gapAfterMin);
    } else {
      const avgEndSecond = startSecond + occupancySeconds;
      const gapAfterAvg = nextAnchorSecond - avgEndSecond;
      if (gapAfterAvg < 0) {
        score += 50_000 + Math.abs(gapAfterAvg);
      } else if (gapAfterAvg < minimumRecoveryTimeSeconds) {
        score += 10_000 + (minimumRecoveryTimeSeconds - gapAfterAvg);
      } else {
        score += Math.max(0, 120 - Math.min(gapAfterAvg, 120));
      }
    }
  }

  if (previousRouteId != null && previousEndSecond != null) {
    const isRouteSwitch = previousRouteId !== route.routeId;
    const includeRecovery =
      !isRouteSwitch
      || !previousRoute
      || rotationRoutes.length === 0
      || shouldIncludeRecoveryForRouteSwitch({
        previousRoute,
        nextRoute: route,
        rotationRoutes,
      });
    const requiredGap = resolveInterTripGapSeconds({
      minimumRecoveryTimeSeconds,
      previousRouteSwitchBufferSeconds: previousSwitchBufferSeconds,
      isRouteSwitch,
      includeRecovery,
      previousRoute: previousRoute ?? undefined,
      nextRoute: route,
    });
    const gapBefore = startSecond - previousEndSecond;
    if (gapBefore < requiredGap) {
      feasible = false;
      score += 800_000 + (requiredGap - gapBefore);
    } else if (isRouteSwitch) {
      score += 40 + Math.max(0, previousSwitchBufferSeconds) * 0.1;
    } else {
      score -= 5;
    }
  }

  score += Math.max(0, route.executionOrder) * 2;
  score += usageCount * 15;
  score += Math.round(occupancySeconds / 60);

  return { score, feasible };
}

/**
 * 依執行順序硬輪替指派路線（下行→上行→…）。
 * 發車錨點不變；不再為「可行性」改選其他路線，以保證來回約束與週期補完一致。
 * 不可行時仍寫入該順序路線，交由 validate 報錯。
 *
 * 整備（行前／充電／機動）之後的第一段正線：輪替相位對齊出場站起點路線
 * （與 assignDirectionalDepartures 一致）。
 */
export function assignPassengerRoutesConstraintGreedy(args: {
  passengerTasksByRow: Map<number, ScheduleTask[]>;
  passengerRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  /** 同列全部任務（含整備），用來判斷正線段落前整備類型 */
  allTasksByRow?: Map<number, ScheduleTask[]>;
  /** 整備類型 → 出場站 stationId */
  yardRotationExitByTaskType?: Partial<Record<TaskTypeKey, string>>;
  /** Step 4 繼任策略：開輪相位對齊 */
  successorPolicy?: RouteSuccessorPolicy;
}): Map<string, RouteAssignmentDecision> {
  const {
    passengerTasksByRow,
    passengerRoutes,
    minimumRecoveryTimeSeconds,
    allTasksByRow,
    yardRotationExitByTaskType = {},
    successorPolicy,
  } = args;
  const decisions = new Map<string, RouteAssignmentDecision>();
  const usageCount = new Map<string, number>();

  for (const route of passengerRoutes) {
    usageCount.set(route.routeId, 0);
  }

  const orderedRoutes = [...passengerRoutes].sort((a, b) => {
    if (a.executionOrder !== b.executionOrder) return a.executionOrder - b.executionOrder;
    return a.routeName.localeCompare(b.routeName, 'zh-Hant');
  });

  if (orderedRoutes.length === 0) return decisions;

  // 有策略時輪替順序已是 rotationRoutes，不再重排以免打亂導通環
  const rotationRoutes = successorPolicy?.rotationRoutes?.length
    ? successorPolicy.rotationRoutes
    : orderedRoutes;

  const routeCount = rotationRoutes.length;
  const rows = [...passengerTasksByRow.keys()].sort((a, b) => a - b);

  for (const row of rows) {
    const rowTasks = [...(passengerTasksByRow.get(row) ?? [])].sort(
      (a, b) => a.startMinute - b.startMinute || a.id.localeCompare(b.id),
    );
    const allRowTasks = [...(allTasksByRow?.get(row) ?? rowTasks)].sort(
      (a, b) => a.startMinute - b.startMinute || a.id.localeCompare(b.id),
    );
    let lastRouteId: string | null = null;
    let lastRoute: ShiftScheduleSelectedRoute | null = null;
    let lastEndSecond: number | null = null;
    let lastSwitchBufferSeconds = 0;
    let rotationIndex = 0;

    for (const task of rowTasks) {
      const startSecond = minuteToSecond(task.startMinute);

      const precedingYard = findPrecedingYardTask(task, allRowTasks);
      if (precedingYard) {
        const exitStationId = yardRotationExitByTaskType[precedingYard.taskType];
        if (exitStationId) {
          let offset = 0;
          if (successorPolicy) {
            const startId = resolveStartInstanceId(successorPolicy, exitStationId);
            if (startId) {
              const index = resolveRouteIndexInRotation(successorPolicy, startId);
              offset = index >= 0 ? index : 0;
            }
          } else {
            offset =
              resolveRotationOffsetForExitStation(rotationRoutes, exitStationId) ?? 0;
          }
          rotationIndex =
            Math.ceil(rotationIndex / routeCount) * routeCount + offset;
        } else if (precedingYard.taskType === 'servicing') {
          // 保養後由進場載客接到首班起點；無出場站時開輪對齊環起點（NT）
          rotationIndex =
            Math.ceil(rotationIndex / routeCount) * routeCount;
        }
        // 充電／行前／機動無明確出場站：延續進整備前輪替，勿誤鎖回 NT
      }

      const nextAnchorSecond = findNextPassengerAnchorSecond(
        rowTasks,
        task.id,
        startSecond,
      );
      const route = rotationRoutes[rotationIndex % rotationRoutes.length]!;
      const occupancy = resolvePassengerOccupancy(route);
      if (!occupancy) {
        rotationIndex += 1;
        continue;
      }

      const { score, feasible } = scoreRouteCandidate({
        route,
        occupancySeconds: occupancy.occupancySeconds,
        travelSeconds: occupancy.travelSeconds,
        startSecond,
        nextAnchorSecond,
        previousRouteId: lastRouteId,
        previousRoute: lastRoute,
        previousEndSecond: lastEndSecond,
        previousSwitchBufferSeconds: lastSwitchBufferSeconds,
        minimumRecoveryTimeSeconds,
        usageCount: usageCount.get(route.routeId) ?? 0,
        rotationRoutes,
      });

      const decision: RouteAssignmentDecision = {
        taskId: task.id,
        route,
        occupancySeconds: occupancy.occupancySeconds,
        travelSeconds: occupancy.travelSeconds,
        dwellSeconds: occupancy.dwellSeconds,
        score,
        feasible,
      };

      decisions.set(task.id, decision);
      usageCount.set(route.routeId, (usageCount.get(route.routeId) ?? 0) + 1);
      lastRouteId = route.routeId;
      lastRoute = route;
      lastEndSecond = startSecond + decision.occupancySeconds;
      lastSwitchBufferSeconds = route.switchBufferAfterSeconds;
      rotationIndex += 1;
    }

    // 已知相鄰路線後，依實際換線／恢復空檔再把占用從均往快壓
    for (let i = 0; i < rowTasks.length; i += 1) {
      const task = rowTasks[i]!;
      const decision = decisions.get(task.id);
      if (!decision) continue;
      const nextTask = rowTasks[i + 1];
      if (!nextTask) continue;
      const nextDecision = decisions.get(nextTask.id);
      if (!nextDecision) continue;
      const startSecond = minuteToSecond(task.startMinute);
      const nextStart = minuteToSecond(nextTask.startMinute);
      const requiredGap = resolveInterTripGapSeconds({
        minimumRecoveryTimeSeconds,
        previousRouteSwitchBufferSeconds: decision.route.switchBufferAfterSeconds,
        isRouteSwitch: decision.route.routeId !== nextDecision.route.routeId,
        includeRecovery: shouldIncludeRecoveryForRouteSwitch({
          previousRoute: decision.route,
          nextRoute: nextDecision.route,
          rotationRoutes,
        }),
        previousRoute: decision.route,
        nextRoute: nextDecision.route,
      });
      const maxAllowed = nextStart - startSecond - requiredGap;
      if (decision.occupancySeconds > maxAllowed) {
        const minOcc =
          resolvePassengerOccupancy(decision.route)?.minOccupancySeconds
          ?? decision.occupancySeconds;
        decision.occupancySeconds = Math.max(
          minOcc,
          Math.min(decision.occupancySeconds, maxAllowed),
        );
      }
    }
  }

  return decisions;
}

/** 該正線是否緊接在整備之後（中間無其他正線）；回傳該整備任務 */
function findPrecedingYardTask(
  passengerTask: ScheduleTask,
  allRowTasks: ScheduleTask[],
): ScheduleTask | null {
  const paxStart = passengerTask.startMinute;
  let lastYard: ScheduleTask | null = null;
  for (const task of allRowTasks) {
    if (task.id === passengerTask.id) break;
    if (task.startMinute + task.durationMinutes > paxStart + 1e-9) continue;
    if (task.taskType === 'passenger') {
      lastYard = null;
      continue;
    }
    lastYard = task;
  }
  return lastYard;
}
