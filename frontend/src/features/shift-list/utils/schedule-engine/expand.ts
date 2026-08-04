import {
  isMainlineTaskType,
  type ScheduleTask,
} from '../../../time-templates/types/editor';
import {
  resolveSelectedRouteInstanceId,
  type ShiftScheduleSelectedRoute,
} from '../../types/create';
import { resolveMaintenanceOccupancySeconds } from '../resolveMaintenanceOccupancySeconds';
import {
  assignPassengerRoutesConstraintGreedy,
  ROUTE_ASSIGNMENT_ALGORITHM,
} from './assignRoutes';
import { buildYardRotationExitByTaskType } from '../maintenancePostTaskPolicy';
import type { MaintenanceFirstTripOrigin } from '../maintenanceFirstTripOrigins';
import {
  sumStationDwellSecondsWithSlack,
  snapUpToClockAlignSeconds,
  isClockAlignedSeconds,
  resolveInterTripGapSeconds,
  resolvePassengerRouteOccupancy,
  shouldIncludeRecoveryForRouteSwitch,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
} from './physics';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  ResolvedTemplateTask,
  SchedulingContext,
} from './types';
import { minuteToSecond, secondToMinute, pushIssue } from './types';
import {
  describeStationLegTravelIssue,
  resolveEffectiveRouteTravelSeconds,
} from '../stationLegTravel';

export { ROUTE_ASSIGNMENT_ALGORITHM };

function resolvePassengerOccupancy(
  route: ShiftScheduleSelectedRoute,
): { occupancySeconds: number; travelSeconds: number; dwellSeconds: number } {
  const resolved = resolvePassengerRouteOccupancy(route);
  if (!resolved) {
    return { occupancySeconds: 0, travelSeconds: 0, dwellSeconds: 0 };
  }
  return {
    travelSeconds: resolved.travelSeconds,
    dwellSeconds: resolved.dwellSeconds,
    occupancySeconds: resolved.occupancySeconds,
  };
}

function resolveTemplateBarOccupancySeconds(task: ScheduleTask): number {
  return Math.max(0, Math.round(task.durationMinutes * 60));
}

function resolveOccupancy(
  task: ScheduleTask,
  route: ShiftScheduleSelectedRoute | null,
  maintenanceBody: Record<string, unknown> | null | undefined,
): { occupancySeconds: number; travelSeconds: number; dwellSeconds: number } {
  if (isMainlineTaskType(task.taskType) && route) {
    return resolvePassengerOccupancy(route);
  }

  const maintenanceSeconds = resolveMaintenanceOccupancySeconds(task.taskType, maintenanceBody);
  const templateSeconds = resolveTemplateBarOccupancySeconds(task);
  const routeTravel = route?.avgTravelTimeSeconds ?? 0;

  if (maintenanceSeconds != null) {
    const dwellSeconds = Math.max(0, maintenanceSeconds);
    const rawOccupancy = routeTravel + dwellSeconds;
    return {
      travelSeconds: routeTravel,
      dwellSeconds,
      occupancySeconds: snapUpToClockAlignSeconds(rawOccupancy),
    };
  }

  return {
    travelSeconds: 0,
    dwellSeconds: templateSeconds,
    occupancySeconds: snapUpToClockAlignSeconds(templateSeconds),
  };
}

export function sortTemplateTasks(tasks: ScheduleTask[]): ScheduleTask[] {
  return [...tasks].sort((a, b) => {
    if (a.startMinute !== b.startMinute) return a.startMinute - b.startMinute;
    return a.rowIndex - b.rowIndex;
  });
}

export function groupTasksByRow(tasks: ScheduleTask[]): Map<number, ScheduleTask[]> {
  const byRow = new Map<number, ScheduleTask[]>();
  for (const task of tasks) {
    const list = byRow.get(task.rowIndex) ?? [];
    list.push(task);
    byRow.set(task.rowIndex, list);
  }
  for (const [, list] of byRow) {
    list.sort((a, b) => a.startMinute - b.startMinute);
  }
  return byRow;
}

function findNextAnchorSecondOnRow(
  rowTasks: ScheduleTask[],
  currentTaskId: string,
  currentStartSecond: number,
): number | null {
  for (const task of rowTasks) {
    if (task.id === currentTaskId) continue;
    if (task.taskType !== 'passenger') continue; // 只將正線發車視為發車錨點！
    const anchorSecond = minuteToSecond(task.startMinute);
    if (anchorSecond > currentStartSecond) return anchorSecond;
  }
  return null;
}

function buildTemplateBarBlock(
  resolved: ResolvedTemplateTask,
  actualStartSecond?: number,
): GeneratedScheduleBlock {
  const startSecond = actualStartSecond != null ? actualStartSecond : minuteToSecond(resolved.task.startMinute);
  const endSecond = startSecond + resolved.occupancySeconds;
  return {
    id: resolved.task.id,
    timelineRow: resolved.task.rowIndex,
    taskType: resolved.task.taskType,
    label: resolved.task.label,
    templateTaskId: resolved.task.id,
    routeInstanceId: resolved.route
      ? resolveSelectedRouteInstanceId(resolved.route)
      : undefined,
    routeId: resolved.route?.routeId,
    routeName: resolved.route?.routeName,
    routeCode: resolved.route?.routeCode ?? undefined,
    anchorStartMinute: resolved.task.startMinute,
    plannedStartMinute: secondToMinute(startSecond),
    plannedEndMinute: secondToMinute(endSecond),
    travelSeconds: resolved.travelSeconds,
    dwellSeconds: resolved.dwellSeconds,
    source: 'template_bar',
  };
}

/**
 * 1.3–1.4：約束貪婪指派路線、計算真實占用，產出 resolved map。
 */
export function resolveTemplateTasks(
  confirmedTasks: ScheduleTask[],
  ctx: SchedulingContext,
  maintenanceBody: Record<string, unknown> | null,
  errors: FeasibilityIssue[],
  warnings: FeasibilityIssue[] = [],
  firstTripOrigins: MaintenanceFirstTripOrigin[] = [],
): Map<string, ResolvedTemplateTask> {
  const passengerTasks = confirmedTasks.filter((task) => task.taskType === 'passenger');
  const passengerByRow = groupTasksByRow(passengerTasks);
  const allTasksByRow = groupTasksByRow(confirmedTasks);
  const yardRotationExitByTaskType = buildYardRotationExitByTaskType({
    origins: firstTripOrigins,
    maintenanceBody,
  });
  const assignments = assignPassengerRoutesConstraintGreedy({
    passengerTasksByRow: passengerByRow,
    passengerRoutes: ctx.passengerRoutes,
    minimumRecoveryTimeSeconds: ctx.minimumRecoveryTimeSeconds,
    allTasksByRow,
    yardRotationExitByTaskType,
    successorPolicy: ctx.successorPolicy,
  });

  const sortedTasks = sortTemplateTasks(confirmedTasks);
  const resolvedByTaskId = new Map<string, ResolvedTemplateTask>();
  const warnedIncompleteLegRouteIds = new Set<string>();

  for (const task of sortedTasks) {
    const needsRoute = task.taskType === 'passenger';
    const assignment = needsRoute ? assignments.get(task.id) : undefined;
    const route = assignment?.route ?? null;

    if (needsRoute && !route) {
      pushIssue(errors, {
        code: 'NO_ROUTE_FOR_TASK_TYPE',
        severity: 'error',
        message: `任務「${task.label}」沒有可用的路線（${task.taskType}）`,
        detail: { templateTaskId: task.id, taskType: task.taskType },
      });
      continue;
    }

    if (isMainlineTaskType(task.taskType)) {
      if (!route) {
        continue;
      }
      const effectiveTravel = resolveEffectiveRouteTravelSeconds(route);
      if (!effectiveTravel) {
        pushIssue(errors, {
          code: 'MISSING_TRAVEL_TIME',
          severity: 'error',
          message: `正線任務「${task.label}」所分配路線缺少有效行駛時間`,
          detail: { templateTaskId: task.id, routeId: route.routeId },
        });
        continue;
      }
      const legIssue = describeStationLegTravelIssue(route.stationIds, route.stationLegTravels);
      if (legIssue?.code === 'invalid') {
        pushIssue(errors, {
          code: 'STATION_LEG_TRAVEL_INVALID',
          severity: 'error',
          message: `路線「${route.routeName}」：${legIssue.message}`,
          detail: { routeId: route.routeId, templateTaskId: task.id },
        });
        continue;
      }
      if (
        legIssue?.code === 'incomplete'
        && route.stationIds.length >= 2
        && !warnedIncompleteLegRouteIds.has(route.routeId)
      ) {
        warnedIncompleteLegRouteIds.add(route.routeId);
        pushIssue(warnings, {
          code: 'STATION_LEG_TRAVEL_INCOMPLETE',
          severity: 'warning',
          message: `路線「${route.routeName}」：${legIssue.message}`,
          detail: { routeId: route.routeId, templateTaskId: task.id },
        });
      }
      if (sumStationDwellSecondsWithSlack(route.stationDwells, route.dwellSlackSeconds) == null) {
        pushIssue(errors, {
          code: 'MISSING_TRAVEL_TIME',
          severity: 'error',
          message: `正線任務「${task.label}」缺少各站停靠時間`,
          detail: { templateTaskId: task.id, routeId: route.routeId },
        });
        continue;
      }
    }

    const occupancy = assignment
      ? {
          occupancySeconds: assignment.occupancySeconds,
          travelSeconds: assignment.travelSeconds,
          dwellSeconds: assignment.dwellSeconds,
        }
      : resolveOccupancy(task, route, maintenanceBody);

    // 正線讓渡把整備開頭吃光後，任務時長可為 0：略過即可，不是缺行駛時間。
    if (occupancy.occupancySeconds <= 0) {
      if (task.taskType !== 'passenger' && task.durationMinutes <= 0) {
        continue;
      }
      pushIssue(errors, {
        code: 'MISSING_TRAVEL_TIME',
        severity: 'error',
        message: `任務「${task.label}」無法計算有效占用時間`,
        detail: { templateTaskId: task.id, taskType: task.taskType },
      });
      continue;
    }

    resolvedByTaskId.set(task.id, {
      task,
      route,
      occupancySeconds: occupancy.occupancySeconds,
      travelSeconds: occupancy.travelSeconds,
      dwellSeconds: occupancy.dwellSeconds,
    });
  }

  return resolvedByTaskId;
}

/**
 * 1.5 + S1 空檔檢查 + S3 錨點對齊：寫入時間線區塊與過渡。
 */
export function expandRowBlocks(
  rowTasks: ScheduleTask[],
  resolvedByTaskId: Map<string, ResolvedTemplateTask>,
  errors: FeasibilityIssue[],
  minimumRecoveryTimeSeconds: number,
  rotationRoutes: ShiftScheduleSelectedRoute[] = [],
): GeneratedScheduleBlock[] {
  const blocks: GeneratedScheduleBlock[] = [];
  let cursorSecond = 0;
  const routesForRecovery =
    rotationRoutes.length > 0
      ? rotationRoutes
      : [...resolvedByTaskId.values()]
          .map((item) => item.route)
          .filter((route): route is ShiftScheduleSelectedRoute => Boolean(route));

  for (const task of rowTasks) {
    const resolved = resolvedByTaskId.get(task.id);
    if (!resolved) continue;

    const plannedStartSecond = minuteToSecond(task.startMinute);

    // 非正線任務（充電、保養、機動）：正線佔用開頭時延後開始、鎖住原結束時間並壓縮時長。
    // 只縮短被佔用的這段整備，不因此平移後續其他整備視窗。
    let startSecond = plannedStartSecond;
    if (task.taskType !== 'passenger') {
      const originalEndSecond = plannedStartSecond + resolved.occupancySeconds;
      startSecond = Math.max(plannedStartSecond, cursorSecond);
      startSecond = snapUpToClockAlignSeconds(startSecond);
      if (startSecond > plannedStartSecond) {
        resolved.occupancySeconds = Math.max(0, originalEndSecond - startSecond);
      }
    }

    if (!isClockAlignedSeconds(startSecond)) {
      pushIssue(errors, {
        code: 'CLOCK_ALIGN_VIOLATION',
        severity: 'error',
        message: `時間線 ${task.rowIndex}：${task.label} 發車錨點未對齊 ${SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS} 秒格位`,
        detail: {
          timelineRow: task.rowIndex,
          templateTaskId: task.id,
          anchorStartMinute: task.startMinute,
          startSecond,
          clockAlignSeconds: SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
        },
      });
    }

    const nextAnchorSecond = findNextAnchorSecondOnRow(rowTasks, task.id, startSecond);
    const maxAllowedOccupancy = nextAnchorSecond != null ? nextAnchorSecond - startSecond : null;

    if (task.taskType === 'passenger' && resolved.route) {
      const minTravel =
        resolveEffectiveRouteTravelSeconds(resolved.route)?.minTravelTimeSeconds
        ?? resolved.route.minTravelTimeSeconds
        ?? resolved.route.avgTravelTimeSeconds
        ?? 0;
      const dwells = resolved.dwellSeconds;
      const minOccupancy = snapUpToClockAlignSeconds(minTravel + dwells);

      if (maxAllowedOccupancy != null && resolved.occupancySeconds > maxAllowedOccupancy) {
        if (minOccupancy > maxAllowedOccupancy) {
          const endSecond = startSecond + resolved.occupancySeconds;
          pushIssue(errors, {
            code: 'ANCHOR_CONFLICT',
            severity: 'error',
            message: `時間線 ${task.rowIndex}：${task.label} 實際結束時間晚於下一個模板發車錨點`,
            detail: {
              timelineRow: task.rowIndex,
              templateTaskId: task.id,
              anchorStartMinute: task.startMinute,
              actualEndMinute: secondToMinute(endSecond),
              nextAnchorMinute: nextAnchorSecond != null ? secondToMinute(nextAnchorSecond) : 0,
              occupancySeconds: resolved.occupancySeconds,
            },
          });
        } else {
          resolved.occupancySeconds = maxAllowedOccupancy;
        }
      }
    } else {
      // 非正線：只允許正線壓縮開頭（延後開始、鎖住原結束）。
      // 不得為下一個正線錨點提前結束整備；若與後續正線重疊，交由最終驗證處理。
    }

    const endSecond = startSecond + resolved.occupancySeconds;
    const barBlock = buildTemplateBarBlock(resolved, startSecond);
    blocks.push(barBlock);

    if (nextAnchorSecond != null && !isClockAlignedSeconds(nextAnchorSecond)) {
      pushIssue(errors, {
        code: 'CLOCK_ALIGN_VIOLATION',
        severity: 'error',
        message: `時間線 ${task.rowIndex}：下一發車錨點未對齊 ${SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS} 秒格位`,
        detail: {
          timelineRow: task.rowIndex,
          nextAnchorSecond,
          clockAlignSeconds: SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
        },
      });
    }

    // 正線之間：空檔 ≥ 恢復（折返／同路線）或僅換線緩衝（導通中段）
    if (task.taskType === 'passenger' && nextAnchorSecond != null && endSecond < nextAnchorSecond) {
      const nextTask = rowTasks.find(
        (item) =>
          item.taskType === 'passenger'
          && item.id !== task.id
          && minuteToSecond(item.startMinute) === nextAnchorSecond,
      );
      const nextResolved = nextTask ? resolvedByTaskId.get(nextTask.id) : undefined;
      const isRouteSwitch = Boolean(
        resolved.route
        && nextResolved?.route
        && resolved.route.routeId !== nextResolved.route.routeId,
      );
      const includeRecovery =
        !isRouteSwitch
        || !resolved.route
        || !nextResolved?.route
        || shouldIncludeRecoveryForRouteSwitch({
          previousRoute: resolved.route,
          nextRoute: nextResolved.route,
          rotationRoutes: routesForRecovery,
        });
      const requiredGap = resolveInterTripGapSeconds({
        minimumRecoveryTimeSeconds,
        previousRouteSwitchBufferSeconds: resolved.route?.switchBufferAfterSeconds,
        isRouteSwitch,
        includeRecovery,
        previousRoute: resolved.route ?? undefined,
        nextRoute: nextResolved?.route ?? undefined,
      });
      const gapSeconds = nextAnchorSecond - endSecond;
      if (gapSeconds < requiredGap) {
        pushIssue(errors, {
          code: isRouteSwitch ? 'ROUTE_SWITCH_BUFFER_INSUFFICIENT' : 'RECOVERY_INSUFFICIENT',
          severity: 'error',
          message: isRouteSwitch
            ? includeRecovery
              ? `時間線 ${task.rowIndex}：${task.label} 換線路空檔不足（需恢復 ${minimumRecoveryTimeSeconds} 秒＋換線緩衝，共 ${requiredGap} 秒）`
              : `時間線 ${task.rowIndex}：${task.label} 換線路空檔不足（需換線緩衝 ${requiredGap} 秒）`
            : `時間線 ${task.rowIndex}：${task.label} 與下一發車錨點之間的空檔不足恢復時間（需至少 ${minimumRecoveryTimeSeconds} 秒）`,
          detail: {
            timelineRow: task.rowIndex,
            templateTaskId: task.id,
            gapSeconds,
            requiredGapSeconds: requiredGap,
            minimumRecoveryTimeSeconds,
            nextAnchorMinute: secondToMinute(nextAnchorSecond),
          },
        });
      }
    }

    cursorSecond = endSecond;
  }

  return blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
}
