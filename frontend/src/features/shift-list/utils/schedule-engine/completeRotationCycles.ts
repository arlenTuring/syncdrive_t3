import type {
  ScheduleTask,
  TimeSlotAttribute,
  TimeSlotInterval,
} from '../../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import {
  resolveFleetPhysicalHeadwayFloorSeconds,
  resolveInterTripGapSeconds,
  snapUpToClockAlignSeconds,
  sumStationDwellSecondsWithSlack,
} from './physics';
import { resolvePairHeadwaySeconds } from './validate';
import type { FeasibilityIssue } from './types';
import { minuteToSecond, secondToMinute, pushIssue } from './types';
import { resolveEffectiveRouteTravelSeconds } from '../stationLegTravel';
import {
  resolveMaintenanceEntrySlackSeconds,
  type MaintenanceEntrySlackBySection,
} from '../resolveMaintenanceEntrySlackSeconds';
import {
  findEmptyRangeStartingAt,
  listEmptyAttributeMinuteRanges,
} from '../emptyAttributeIntervals';

/** 週期補完（rotation-cycle completion）算法識別碼 */
export const ROTATION_CYCLE_COMPLETION_ALGORITHM = 'rotation-cycle-completion-v1' as const;

const DAY_END_SECOND = 24 * 3600;

type CompletionJob = {
  row: number;
  /** 補完起點的輪替索引（依執行順序） */
  startRotationIndex: number;
  missingCount: number;
  lastPassengerEndSecond: number;
  /** 觸發補完的非正線任務；其開始時間將被推遲至回程結束 */
  deferTaskId: string | null;
  /** 本輪尚未成輪的既有正線。自動掛車若無法合法補完，應撤回這些去程。 */
  partialPassengerTasks: {
    taskId: string;
    routeId: string;
    startSecond: number;
  }[];
};

type RowNextPassenger = {
  startSecond: number;
  route: ShiftScheduleSelectedRoute;
};

function pushSorted(list: number[], value: number): void {
  const index = list.findIndex((item) => item > value);
  if (index < 0) list.push(value);
  else list.splice(index, 0, value);
}

function resolveOccupancySeconds(route: ShiftScheduleSelectedRoute): number {
  const travelSeconds =
    resolveEffectiveRouteTravelSeconds(route)?.avgTravelTimeSeconds
    ?? route.avgTravelTimeSeconds
    ?? 0;
  const dwellSeconds = sumStationDwellSecondsWithSlack(
    route.stationDwells,
    route.dwellSlackSeconds,
  ) ?? 0;
  if (travelSeconds <= 0) return 0;
  return snapUpToClockAlignSeconds(travelSeconds + dwellSeconds);
}

/**
 * 硬約束：一輛車出去就必須把路線執行順序（例：下行→上行）整輪跑完，
 * 才能進入整備任務（充電、保養）或收班；不允許車輛停在對側終點站。
 *
 * 回程班次的發車時刻：
 * 1. 物理下限：前趟結束 + 恢復 + 換線緩衝（相加）
 * 2. 同方向班距對齊（可退讓：見上限）
 * 3. 上限 A：若補完本可在觸發整備前完成，禁止班距把回程推過整備起點
 * 4. 上限 B：不得與同車後續已掛正線重叠或吃掉換線／恢復空檔
 * 5. 整備視窗彈性：回程可吃進整備開頭；整備延後開始、鎖尾壓縮
 * 6. 日界保護：對齊跨日則退車隊物理班距，再不行回物理下限
 */
export function applyRotationCycleCompletion(args: {
  tasks: ScheduleTask[];
  /** 已依 executionOrder 排序的正線路線 */
  passengerRoutes: ShiftScheduleSelectedRoute[];
  scheduleRowCount: number;
  minimumRecoveryTimeSeconds: number;
  /** 提供時：回程對齊同方向時段班距 */
  intervals?: TimeSlotInterval[];
  attributes?: TimeSlotAttribute[];
  /** 整備各區段的切入餘裕；補完回程須在整備開始＋餘裕前完成 */
  maintenanceEntrySlackBySection?: MaintenanceEntrySlackBySection | null;
  /** 空時段正線讓渡餘裕：無接下整備時，回程可占用相鄰空時段開頭 */
  emptyIntervalMainlineSlackSeconds?: number;
  /** 補完失敗時寫入（缺物理量等） */
  errors?: FeasibilityIssue[];
}): ScheduleTask[] {
  const {
    tasks,
    passengerRoutes,
    scheduleRowCount,
    minimumRecoveryTimeSeconds,
    intervals = [],
    attributes = [],
    maintenanceEntrySlackBySection = null,
    emptyIntervalMainlineSlackSeconds = 600,
    errors,
  } = args;
  const emptyRanges = listEmptyAttributeMinuteRanges(intervals);
  const routeCount = passengerRoutes.length;
  if (routeCount <= 1) return tasks;

  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const departuresByRouteId = new Map<string, number[]>();
  for (const route of passengerRoutes) {
    departuresByRouteId.set(route.routeId, []);
  }

  /** 各列既有正線（依發車秒），供補完時推導下一班路線 */
  const rowPassengerStarts = new Map<number, { startSecond: number; ordinal: number }[]>();

  const jobs: CompletionJob[] = [];

  for (let row = 1; row <= scheduleRowCount; row += 1) {
    const rowTasks = tasks
      .filter((task) => task.rowIndex === row)
      .sort((a, b) => a.startMinute - b.startMinute);
    if (rowTasks.length === 0) continue;

    let rotationIndex = 0;
    let lastPassengerEndSecond: number | null = null;
    const passengerStarts: { startSecond: number; ordinal: number }[] = [];
    let partialPassengerTasks: CompletionJob['partialPassengerTasks'] = [];

    for (const task of rowTasks) {
      if (task.taskType === 'passenger') {
        const route = passengerRoutes[rotationIndex % routeCount]!;
        const startSecond = minuteToSecond(task.startMinute);
        pushSorted(departuresByRouteId.get(route.routeId)!, startSecond);
        passengerStarts.push({ startSecond, ordinal: rotationIndex });
        partialPassengerTasks.push({
          taskId: task.id,
          routeId: route.routeId,
          startSecond,
        });
        rotationIndex += 1;
        if (rotationIndex % routeCount === 0) {
          partialPassengerTasks = [];
        }
        lastPassengerEndSecond =
          startSecond + Math.round(task.durationMinutes * 60);
        continue;
      }

      if (rotationIndex % routeCount !== 0 && lastPassengerEndSecond != null) {
        const missingCount = routeCount - (rotationIndex % routeCount);
        jobs.push({
          row,
          startRotationIndex: rotationIndex,
          missingCount,
          lastPassengerEndSecond,
          deferTaskId: task.id,
          partialPassengerTasks: [...partialPassengerTasks],
        });
        rotationIndex += missingCount;
        partialPassengerTasks = [];
      }
    }

    if (rotationIndex % routeCount !== 0 && lastPassengerEndSecond != null) {
      jobs.push({
        row,
        startRotationIndex: rotationIndex,
        missingCount: routeCount - (rotationIndex % routeCount),
        lastPassengerEndSecond,
        deferTaskId: null,
        partialPassengerTasks: [...partialPassengerTasks],
      });
    }

    rowPassengerStarts.set(row, passengerStarts);
  }

  if (jobs.length === 0) return tasks;

  jobs.sort((a, b) => a.lastPassengerEndSecond - b.lastPassengerEndSecond);

  const findNextPassenger = (
    row: number,
    afterEndSecond: number,
  ): RowNextPassenger | null => {
    const list = rowPassengerStarts.get(row) ?? [];
    for (const item of list) {
      if (item.startSecond <= afterEndSecond) continue;
      const route = passengerRoutes[item.ordinal % routeCount];
      if (!route) continue;
      return { startSecond: item.startSecond, route };
    }
    return null;
  };

  const alignToSameRouteHeadway = (input: {
    route: ShiftScheduleSelectedRoute;
    physicalEarliestSecond: number;
    occupancySeconds: number;
    /** 含此秒；超過則必須退讓（整備前補完／同車下一班） */
    latestStartSecond: number;
    /** 自動掛車不得為補回程破壞同方向班距；無合法位置時撤回未成輪去程 */
    requireTargetHeadway: boolean;
  }): number | null => {
    if (input.physicalEarliestSecond > input.latestStartSecond) {
      return null;
    }

    const deps = departuresByRouteId.get(input.route.routeId) ?? [];
    const clamp = (value: number): number =>
      Math.min(Math.max(value, input.physicalEarliestSecond), input.latestStartSecond);

    const align = (
      requiredGapForDep: (depSecond: number, candidateSecond: number) => number,
      earliest: number,
    ): number => {
      let candidate = earliest;
      const maxIterations = deps.length * 2 + 5;
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        let changed = false;
        for (const dep of deps) {
          const required = requiredGapForDep(dep, candidate);
          if (required <= 0) continue;
          if (candidate > dep - required && candidate < dep + required) {
            candidate = snapUpToClockAlignSeconds(dep + required);
            changed = true;
          }
        }
        if (!changed) break;
      }
      return candidate;
    };

    if (deps.length === 0) {
      return input.physicalEarliestSecond;
    }

    const byTargetHeadway = align((dep, candidate) => {
      const earlier = Math.min(dep, candidate);
      const later = Math.max(dep, candidate);
      return resolvePairHeadwaySeconds(
        secondToMinute(earlier),
        secondToMinute(later),
        intervals,
        attributes,
      ) ?? 0;
    }, input.physicalEarliestSecond);

    if (
      byTargetHeadway <= input.latestStartSecond
      && byTargetHeadway + input.occupancySeconds <= DAY_END_SECOND
    ) {
      return clamp(byTargetHeadway);
    }

    if (input.requireTargetHeadway) {
      return null;
    }

    // 對齊會撞上限或跨日：在上限內改用車隊物理班距；仍不行則回物理下限
    const fleetFloor = resolveFleetPhysicalHeadwayFloorSeconds(
      input.route,
      scheduleRowCount,
    );
    if (fleetFloor > 0) {
      const byFleetFloor = align(() => fleetFloor, input.physicalEarliestSecond);
      if (
        byFleetFloor <= input.latestStartSecond
        && byFleetFloor + input.occupancySeconds <= DAY_END_SECOND
      ) {
        return clamp(byFleetFloor);
      }
    }

    return input.physicalEarliestSecond;
  };

  const additions: ScheduleTask[] = [];
  const deferNonPassengerToSecond = new Map<string, number>();
  const removedTaskIds = new Set<string>();

  for (const job of jobs) {
    let rotationIndex = job.startRotationIndex;
    let lastEndSecond = job.lastPassengerEndSecond;
    let placedAll = true;
    const jobAdditions: ScheduleTask[] = [];
    const requireTargetHeadway = job.partialPassengerTasks.every(
      (task) =>
        task.taskId.startsWith('template-pax-')
        || task.taskId.startsWith('auto-pax-'),
    );

    const deferTask = job.deferTaskId ? taskById.get(job.deferTaskId) : null;
    const deferOriginalStartSecond = deferTask
      ? minuteToSecond(deferTask.startMinute)
      : null;
    let deferLatestCompletionSecond: number | null =
      deferTask && deferOriginalStartSecond != null
        ? deferOriginalStartSecond
          + resolveMaintenanceEntrySlackSeconds(
            deferTask.taskType,
            maintenanceEntrySlackBySection,
          )
        : null;
    if (deferLatestCompletionSecond == null) {
      // 無接下整備：若當下結束點緊接空時段，回程最多占用空時段開頭餘裕
      const emptyAfter = findEmptyRangeStartingAt(
        emptyRanges,
        job.lastPassengerEndSecond / 60,
      );
      if (emptyAfter) {
        deferLatestCompletionSecond =
          Math.round(emptyAfter.start * 60) + emptyIntervalMainlineSlackSeconds;
      }
    }

    for (let i = 0; i < job.missingCount; i += 1) {
      const route = passengerRoutes[rotationIndex % routeCount]!;
      const occupancySeconds = resolveOccupancySeconds(route);
      if (occupancySeconds <= 0) {
        placedAll = false;
        if (errors) {
          pushIssue(errors, {
            code: 'ROTATION_CYCLE_INCOMPLETE',
            severity: 'error',
            message: `時間線 ${job.row} 無法補完路線群組回程（缺有效行駛或停靠時間），車輛可能停在對側終點`,
            detail: {
              timelineRow: job.row,
              routeId: route.routeId,
              lastPassengerEndSecond: job.lastPassengerEndSecond,
            },
          });
        }
        break;
      }

      const previousRoute = passengerRoutes[(rotationIndex - 1 + routeCount) % routeCount]!;
      const physicalEarliestSecond = snapUpToClockAlignSeconds(
        lastEndSecond + resolveInterTripGapSeconds({
          minimumRecoveryTimeSeconds,
          previousRouteSwitchBufferSeconds: previousRoute.switchBufferAfterSeconds,
          isRouteSwitch: previousRoute.routeId !== route.routeId,
        }),
      );

      // 上限 B：同車下一班已掛正線，須留足換線／恢復空檔
      const nextPassenger = findNextPassenger(job.row, lastEndSecond);
      let latestStartSecond = DAY_END_SECOND - occupancySeconds;
      if (nextPassenger) {
        const gapBeforeNext = resolveInterTripGapSeconds({
          minimumRecoveryTimeSeconds,
          previousRouteSwitchBufferSeconds: route.switchBufferAfterSeconds,
          isRouteSwitch: route.routeId !== nextPassenger.route.routeId,
        });
        latestStartSecond = Math.min(
          latestStartSecond,
          nextPassenger.startSecond - occupancySeconds - gapBeforeNext,
        );
      }

      // 上限 A：回程必須在「整備開始＋切入餘裕」前完成。
      // 餘裕限制的是完成回程，不是只要在期限前發車即可。
      if (deferLatestCompletionSecond != null) {
        latestStartSecond = Math.min(
          latestStartSecond,
          deferLatestCompletionSecond - occupancySeconds,
        );
      }

      const startSecond = alignToSameRouteHeadway({
        route,
        physicalEarliestSecond,
        occupancySeconds,
        latestStartSecond,
        requireTargetHeadway,
      });

      if (startSecond == null) {
        placedAll = false;
        if (!requireTargetHeadway && errors) {
          pushIssue(errors, {
            code: 'ROTATION_CYCLE_INCOMPLETE',
            severity: 'error',
            message: `時間線 ${job.row} 無法補完回程：與同車後續正線或整備時窗衝突（物理最早 ${physicalEarliestSecond}s，最晚可發 ${latestStartSecond}s）`,
            detail: {
              timelineRow: job.row,
              routeId: route.routeId,
              physicalEarliestSecond,
              latestStartSecond,
              nextPassengerStartSecond: nextPassenger?.startSecond ?? null,
              deferTaskId: job.deferTaskId,
            },
          });
        }
        break;
      }

      const addition: ScheduleTask = {
        id: `pax-cycle-completion-${job.row}-${startSecond}`,
        rowIndex: job.row,
        taskType: 'passenger',
        startMinute: secondToMinute(startSecond),
        durationMinutes: Math.max(1, occupancySeconds / 60),
        label: '正線',
      };
      jobAdditions.push(addition);
      pushSorted(departuresByRouteId.get(route.routeId)!, startSecond);

      lastEndSecond = startSecond + occupancySeconds;
      rotationIndex += 1;
    }

    if (placedAll) {
      additions.push(...jobAdditions);
    } else {
      // 此輪由引擎自動掛出時，找不到同時滿足回程、同方向班距與同車空檔的位置，
      // 正確決策是撤回尚未成輪的去程，而不是輸出必然違規的補完班。
      if (requireTargetHeadway) {
        for (const partial of job.partialPassengerTasks) {
          removedTaskIds.add(partial.taskId);
          const deps = departuresByRouteId.get(partial.routeId);
          const index = deps?.indexOf(partial.startSecond) ?? -1;
          if (deps && index >= 0) deps.splice(index, 1);
        }
      }
      // 多路線群組可能已暫放部分補完；整輪失敗時一併撤回。
      for (const addition of jobAdditions) {
        const route = passengerRoutes[
          (job.startRotationIndex + jobAdditions.indexOf(addition)) % routeCount
        ];
        const deps = route ? departuresByRouteId.get(route.routeId) : undefined;
        const startSecond = minuteToSecond(addition.startMinute);
        const index = deps?.indexOf(startSecond) ?? -1;
        if (deps && index >= 0) deps.splice(index, 1);
      }
    }

    if (job.deferTaskId && placedAll) {
      deferNonPassengerToSecond.set(job.deferTaskId, lastEndSecond);
    }
  }

  if (additions.length === 0 && removedTaskIds.size === 0) return tasks;

  const deferred = tasks.filter((task) => !removedTaskIds.has(task.id)).map((task) => {
    const cycleEnd = deferNonPassengerToSecond.get(task.id);
    if (cycleEnd == null) return task;
    const startSecond = minuteToSecond(task.startMinute);
    if (startSecond >= cycleEnd) return task;
    const shiftedStart = snapUpToClockAlignSeconds(cycleEnd);
    const originalEndSecond = startSecond + Math.max(1, Math.round(task.durationMinutes * 60));
    const remainingSeconds = Math.max(0, originalEndSecond - shiftedStart);
    return {
      ...task,
      startMinute: secondToMinute(shiftedStart),
      durationMinutes: remainingSeconds / 60,
    };
  });

  return [...deferred, ...additions];
}

/** 測試／診斷用：只回傳補完班次 */
export function buildRotationCompletionTasks(args: {
  tasks: ScheduleTask[];
  passengerRoutes: ShiftScheduleSelectedRoute[];
  scheduleRowCount: number;
  minimumRecoveryTimeSeconds: number;
  intervals?: TimeSlotInterval[];
  attributes?: TimeSlotAttribute[];
}): ScheduleTask[] {
  const beforeIds = new Set(args.tasks.map((task) => task.id));
  return applyRotationCycleCompletion(args).filter((task) => !beforeIds.has(task.id));
}
