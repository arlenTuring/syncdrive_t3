import type { ScheduleTask } from '../../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import {
  normalizeSwitchBufferAfterSeconds,
  sumStationDwellSecondsWithSlack,
  snapUpToClockAlignSeconds,
} from './physics';
import { minuteToSecond } from './types';

/** 約束貪婪路線指派（Constraint-Greedy Route Assignment） */
export const ROUTE_ASSIGNMENT_ALGORITHM = 'constraint-greedy-v1' as const;

export type RouteAssignmentAlgorithm = typeof ROUTE_ASSIGNMENT_ALGORITHM;

type TimelineState = {
  lastRouteId: string | null;
  lastEndSecond: number | null;
};

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
  if (!route.avgTravelTimeSeconds || route.avgTravelTimeSeconds <= 0) return null;
  if (
    route.minTravelTimeSeconds != null
    && route.minTravelTimeSeconds > route.avgTravelTimeSeconds
  ) {
    return null;
  }
  const dwellSeconds = sumStationDwellSecondsWithSlack(
    route.stationDwells,
    route.dwellSlackPercent,
  );
  if (dwellSeconds == null) return null;
  const travelSeconds = route.avgTravelTimeSeconds;
  const minTravelSeconds = route.minTravelTimeSeconds ?? travelSeconds;
  return {
    travelSeconds,
    dwellSeconds,
    occupancySeconds: snapUpToClockAlignSeconds(travelSeconds + dwellSeconds),
    minOccupancySeconds: snapUpToClockAlignSeconds(minTravelSeconds + dwellSeconds),
  };
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
 * 評分愈低愈佳。
 * 硬約束違規加巨大懲罰；軟目標：少換線、多恢復裕度、負載均衡、尊重執行順序。
 */
export function scoreRouteCandidate(args: {
  route: ShiftScheduleSelectedRoute;
  occupancySeconds: number;
  travelSeconds: number;
  startSecond: number;
  nextAnchorSecond: number | null;
  previousRouteId: string | null;
  previousEndSecond: number | null;
  previousSwitchBufferSeconds: number;
  minimumRecoveryTimeSeconds: number;
  usageCount: number;
}): { score: number; feasible: boolean } {
  const {
    route,
    occupancySeconds,
    travelSeconds,
    startSecond,
    nextAnchorSecond,
    previousRouteId,
    previousEndSecond,
    previousSwitchBufferSeconds,
    minimumRecoveryTimeSeconds,
    usageCount,
  } = args;

  const minTravel = route.minTravelTimeSeconds ?? route.avgTravelTimeSeconds ?? 0;
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
      // min 可行，接著看 avg 的衝突情況（有衝突則加 penalty 進行軟限制）
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

  if (
    previousRouteId != null
    && previousEndSecond != null
    && previousRouteId !== route.routeId
  ) {
    const gapBefore = startSecond - previousEndSecond;
    if (previousSwitchBufferSeconds > 0 && gapBefore < previousSwitchBufferSeconds) {
      feasible = false;
      score += 800_000 + (previousSwitchBufferSeconds - gapBefore);
    } else {
      score += 40 + Math.max(0, previousSwitchBufferSeconds) * 0.1;
    }
  } else if (previousRouteId != null && previousRouteId === route.routeId) {
    score -= 5;
  }

  score += Math.max(0, route.executionOrder) * 2;
  score += usageCount * 15;
  score += Math.round(occupancySeconds / 60);

  return { score, feasible };
}

/**
 * 依時間線逐趟做約束貪婪指派。
 * 發車錨點不變；只決定每趟正線用哪條路線。
 * 可行時優先遵守執行順序輪流；不可行時改選代價最低的可行路線。
 */
export function assignPassengerRoutesConstraintGreedy(args: {
  passengerTasksByRow: Map<number, ScheduleTask[]>;
  passengerRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
}): Map<string, RouteAssignmentDecision> {
  const {
    passengerTasksByRow,
    passengerRoutes,
    minimumRecoveryTimeSeconds,
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

  const rows = [...passengerTasksByRow.keys()].sort((a, b) => a - b);

  for (const row of rows) {
    const rowTasks = [...(passengerTasksByRow.get(row) ?? [])].sort(
      (a, b) => a.startMinute - b.startMinute || a.id.localeCompare(b.id),
    );
    const state: TimelineState = { lastRouteId: null, lastEndSecond: null };
    let rotationIndex = 0;

    for (const task of rowTasks) {
      const startSecond = minuteToSecond(task.startMinute);
      const nextAnchorSecond = findNextPassengerAnchorSecond(
        rowTasks,
        task.id,
        startSecond,
      );
      const preferredRouteId =
        orderedRoutes.length > 0
          ? orderedRoutes[rotationIndex % orderedRoutes.length]!.routeId
          : null;

      let best: RouteAssignmentDecision | null = null;

      for (const route of orderedRoutes) {
        const occupancy = resolvePassengerOccupancy(route);
        if (!occupancy) continue;

        const previousRoute = state.lastRouteId
          ? orderedRoutes.find((item) => item.routeId === state.lastRouteId)
          : null;
        const previousSwitchBufferSeconds = previousRoute
          ? normalizeSwitchBufferAfterSeconds(previousRoute.switchBufferAfterSeconds)
          : 0;

        const { score: baseScore, feasible } = scoreRouteCandidate({
          route,
          occupancySeconds: occupancy.occupancySeconds,
          travelSeconds: occupancy.travelSeconds,
          startSecond,
          nextAnchorSecond,
          previousRouteId: state.lastRouteId,
          previousEndSecond: state.lastEndSecond,
          previousSwitchBufferSeconds,
          minimumRecoveryTimeSeconds,
          usageCount: usageCount.get(route.routeId) ?? 0,
        });

        // 可行時強烈偏好輪流順序；不可行時改選其他路線
        let score = baseScore;
        if (preferredRouteId != null && route.routeId === preferredRouteId) {
          score -= 100;
        }

        const decision: RouteAssignmentDecision = {
          taskId: task.id,
          route,
          occupancySeconds: occupancy.occupancySeconds,
          travelSeconds: occupancy.travelSeconds,
          dwellSeconds: occupancy.dwellSeconds,
          score,
          feasible,
        };

        if (
          !best
          || (feasible && !best.feasible)
          || (feasible === best.feasible && score < best.score)
          || (
            feasible === best.feasible
            && score === best.score
            && route.executionOrder < best.route.executionOrder
          )
        ) {
          best = decision;
        }
      }

      if (!best) continue;

      // 如果有發車錨點衝突，動態壓縮到最大允許範圍但不少於最快佔用
      const bestOccupancy = resolvePassengerOccupancy(best.route);
      if (bestOccupancy) {
        const minOccupancy = bestOccupancy.minOccupancySeconds;
        const maxAllowed = nextAnchorSecond != null ? nextAnchorSecond - startSecond : null;
        if (maxAllowed != null && best.occupancySeconds > maxAllowed) {
          best.occupancySeconds = Math.max(minOccupancy, maxAllowed);
        }
      }

      decisions.set(task.id, best);
      usageCount.set(best.route.routeId, (usageCount.get(best.route.routeId) ?? 0) + 1);
      state.lastRouteId = best.route.routeId;
      state.lastEndSecond = startSecond + best.occupancySeconds;
      rotationIndex += 1;
    }
  }

  return decisions;
}
