import type { ScheduleTask, TaskTypeKey } from '../../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import { resolveSelectedRouteInstanceId } from '../../types/create';
import { resolveRotationOffsetForExitStation } from '../maintenanceFirstTripOrigins';
import { shouldApplyYardExitRotationAlign } from '../maintenancePostTaskPolicy';
import {
  resolveNextInstanceId,
  resolveRouteIndexInRotation,
  resolveStartInstanceId,
  routeAssignmentAlgorithmId,
  ROUTE_SUCCESSOR_ALGORITHM_GRAPH,
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
 * 整備（行檢／充電／待命）之後的第一段正線：輪替相位對齊出場站起點路線
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

  // 有策略時輪替順序已是 rotationRoutes，不再重排以免打亂導通偏好
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
    let lastInstanceId: string | null = null;
    let forceStartAfterYard = false;

    for (const task of rowTasks) {
      const startSecond = minuteToSecond(task.startMinute);

      const precedingYard = findPrecedingYardTask(
        task,
        allRowTasks,
        // 「釘住位置」＝該整備類型在對齊表裡有出場站（與 normalizeInput 同一份表）
        (yard) => {
          const exits = yardRotationExitByTaskType[yard.taskType];
          return Array.isArray(exits) ? exits.length > 0 : Boolean(exits);
        },
      );
      if (precedingYard) {
        const exitStationId = yardRotationExitByTaskType[precedingYard.taskType];
        const yardEndMinute =
          precedingYard.startMinute + precedingYard.durationMinutes;
        if (
          shouldApplyYardExitRotationAlign({
            exitStationId,
            templateTasks: allRowTasks,
            row,
            yardEndMinute,
          })
        ) {
          let offset = 0;
          if (successorPolicy) {
            const startId = resolveStartInstanceId(successorPolicy, exitStationId);
            if (startId) {
              const index = resolveRouteIndexInRotation(successorPolicy, startId);
              offset = index >= 0 ? index : 0;
              lastInstanceId = null;
              forceStartAfterYard = true;
            }
          } else {
            offset =
              resolveRotationOffsetForExitStation(rotationRoutes, exitStationId) ?? 0;
          }
          rotationIndex =
            Math.ceil(rotationIndex / routeCount) * routeCount + offset;
        } else if (precedingYard.taskType === 'servicing') {
          // 保養有拓樸出場站時已走上方對齊分支。此處僅無明確出場時的兜底：
          // 開輪對齊偏好 canonical 起點，但仍重置 instance 鏈。
          rotationIndex =
            Math.ceil(rotationIndex / routeCount) * routeCount;
          if (successorPolicy) {
            lastInstanceId = null;
            forceStartAfterYard = true;
          }
        }
        // 充電／行檢／待命無明確出場站，或整備後無正線：延續進整備前輪替
      }

      const nextAnchorSecond = findNextPassengerAnchorSecond(
        rowTasks,
        task.id,
        startSecond,
      );

      let route: ShiftScheduleSelectedRoute | null = null;
      if (
        successorPolicy
        && successorPolicy.valid
        && successorPolicy.algorithm === ROUTE_SUCCESSOR_ALGORITHM_GRAPH
      ) {
        if (forceStartAfterYard || !lastInstanceId) {
          const startId =
            forceStartAfterYard
              ? resolveStartInstanceId(
                  successorPolicy,
                  precedingYard
                    ? yardRotationExitByTaskType[precedingYard.taskType]
                    : null,
                )
              : resolveStartInstanceId(successorPolicy);
          route = startId
            ? successorPolicy.routesByInstanceId.get(startId) ?? null
            : rotationRoutes[rotationIndex % rotationRoutes.length] ?? null;
          forceStartAfterYard = false;
        } else {
          const next = resolveNextInstanceId(successorPolicy, lastInstanceId);
          route = next
            ? successorPolicy.routesByInstanceId.get(next.instanceId) ?? null
            : null;
          // 圖上斷線：不得發明偏好繞回；只好用偏好相位的下一條並標記可不可行於 score
          if (!route) {
            route = rotationRoutes[rotationIndex % rotationRoutes.length] ?? null;
          }
        }
      } else {
        route = rotationRoutes[rotationIndex % rotationRoutes.length]!;
      }

      /**
       * <strong>掛車階段已經決定過的，這裡就照著走，不要再推導一次。</strong>
       *
       * 這一趟的發車錨點是掛車階段依「某一條特定路線的佔用秒數」算出來的。
       * 這裡若自己重新推導出另一條，時刻就對應到別條路線的佔用——
       * 2026-08-16 實測正是如此：掛車依 <code>S2W上行&gt;T3上行</code>（180 秒）
       * 把下一個錨點放在 180 秒後，這裡卻推導出 <code>T3上行&gt;N2W上行</code>
       * （最快 210 秒），一口氣產生 34 則 ANCHOR_CONFLICT。
       *
       * 只覆蓋「掛車真的留下決定」的任務；其餘（模板既有正線等）維持原推導。
       */
      if (task.plannedRouteInstanceId && successorPolicy?.valid) {
        const planned = successorPolicy.routesByInstanceId.get(
          task.plannedRouteInstanceId,
        );
        if (planned) {
          route = planned;
          forceStartAfterYard = false;
        }
      }

      if (!route) {
        rotationIndex += 1;
        continue;
      }

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
      lastInstanceId = resolveSelectedRouteInstanceId(route);
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

/**
 * 該正線是否緊接在整備之後（中間無其他正線）；回傳該決定輪替相位的整備任務。
 *
 * <strong>整備會連成一串（行檢→待命、充電→待命…），要回頭找「真正釘住車位置」
 * 的那一個，不是最後一個。</strong>
 *
 * 待命這類沒有出場站的整備不釘位置——它的語意是「車留在原地等」，車實際停在哪
 * 是<strong>前一個</strong>有出場站的整備決定的。只取最後一個整備，等於把行檢的
 * 出場站整個看丟。
 *
 * 2026-08-16 用真實資料重放追出來的分歧就是這個：row 1 的
 * 行檢 04:30–05:00 → 待命 05:00–07:00 → 正線 07:10。
 * <code>normalizeInput</code> 依「視窗換手」在 05:00 就依<strong>行檢</strong>
 * 對齊了相位（該視窗被待命佔滿、一班車都沒排，但相位留了下來）；
 * 這裡卻只看到緊鄰的<strong>待命</strong>、判定不必對齊，於是兩個階段從此差一格
 * ——規劃把 <code>S2W上行&gt;T3上行</code>（180 秒）排在某一格、下一個錨點放 180 秒後，
 * 指派卻在同一格放 <code>T3上行&gt;N2W上行</code>（220 秒），展開時 34 則
 * ANCHOR_CONFLICT 全部是這一組錯位。
 *
 * 行檢原本 <code>alignRotationToExitStation: false</code> 時兩邊都不位移，
 * 所以這個不對稱一直睡著，直到放開行檢出場站候選才引爆。
 */
function findPrecedingYardTask(
  passengerTask: ScheduleTask,
  allRowTasks: ScheduleTask[],
  pinsRotationPhase: (task: ScheduleTask) => boolean,
): ScheduleTask | null {
  const paxStart = passengerTask.startMinute;
  let lastYard: ScheduleTask | null = null;
  let lastPinningYard: ScheduleTask | null = null;
  for (const task of allRowTasks) {
    if (task.id === passengerTask.id) break;
    if (task.startMinute + task.durationMinutes > paxStart + 1e-9) continue;
    if (task.taskType === 'passenger') {
      lastYard = null;
      lastPinningYard = null;
      continue;
    }
    lastYard = task;
    if (pinsRotationPhase(task)) lastPinningYard = task;
  }
  // 串中有釘位置的就用它；整串都不釘位置時維持原行為（用最後一個）
  return lastPinningYard ?? lastYard;
}
