import type { ScheduleTask } from '../../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import {
  resolveInterTripGapSeconds,
  sumStationDwellSecondsWithSlack,
  snapUpToClockAlignSeconds,
} from './physics';
import { minuteToSecond } from './types';
import { resolveEffectiveRouteTravelSeconds } from '../stationLegTravel';

/** 約束貪婪路線指派（Constraint-Greedy Route Assignment）— 執行順序為硬輪替 */
export const ROUTE_ASSIGNMENT_ALGORITHM = 'constraint-greedy-v1' as const;

export type RouteAssignmentAlgorithm = typeof ROUTE_ASSIGNMENT_ALGORITHM;

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
  const travel = resolveEffectiveRouteTravelSeconds(route);
  if (!travel) return null;
  const dwellSeconds = sumStationDwellSecondsWithSlack(
    route.stationDwells,
    route.dwellSlackSeconds,
  );
  if (dwellSeconds == null) return null;
  const travelSeconds = travel.avgTravelTimeSeconds;
  const minTravelSeconds = travel.minTravelTimeSeconds;
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
    const requiredGap = resolveInterTripGapSeconds({
      minimumRecoveryTimeSeconds,
      previousRouteSwitchBufferSeconds: previousSwitchBufferSeconds,
      isRouteSwitch,
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

  if (orderedRoutes.length === 0) return decisions;

  const rows = [...passengerTasksByRow.keys()].sort((a, b) => a - b);

  for (const row of rows) {
    const rowTasks = [...(passengerTasksByRow.get(row) ?? [])].sort(
      (a, b) => a.startMinute - b.startMinute || a.id.localeCompare(b.id),
    );
    let lastRouteId: string | null = null;
    let lastEndSecond: number | null = null;
    let lastSwitchBufferSeconds = 0;
    let rotationIndex = 0;

    for (const task of rowTasks) {
      const startSecond = minuteToSecond(task.startMinute);
      const nextAnchorSecond = findNextPassengerAnchorSecond(
        rowTasks,
        task.id,
        startSecond,
      );
      const route = orderedRoutes[rotationIndex % orderedRoutes.length]!;
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
        previousEndSecond: lastEndSecond,
        previousSwitchBufferSeconds: lastSwitchBufferSeconds,
        minimumRecoveryTimeSeconds,
        usageCount: usageCount.get(route.routeId) ?? 0,
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

      // 若與下一錨點衝突，動態壓縮到最大允許範圍但不少於最快占用
      const maxAllowed = nextAnchorSecond != null ? nextAnchorSecond - startSecond : null;
      if (maxAllowed != null && decision.occupancySeconds > maxAllowed) {
        decision.occupancySeconds = Math.max(
          occupancy.minOccupancySeconds,
          maxAllowed,
        );
      }

      decisions.set(task.id, decision);
      usageCount.set(route.routeId, (usageCount.get(route.routeId) ?? 0) + 1);
      lastRouteId = route.routeId;
      lastEndSecond = startSecond + decision.occupancySeconds;
      lastSwitchBufferSeconds = route.switchBufferAfterSeconds;
      rotationIndex += 1;
    }
  }

  return decisions;
}
