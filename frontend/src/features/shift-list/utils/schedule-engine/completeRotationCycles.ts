import type {
  ScheduleTask,
  TaskTypeKey,
  TimeSlotAttribute,
  TimeSlotInterval,
} from '../../../time-templates/types/editor';
import {
  resolveSelectedRouteInstanceId,
  type ShiftScheduleSelectedRoute,
} from '../../types/create';
import {
  resolveFleetPhysicalHeadwayFloorSeconds,
  resolveInterTripGapSeconds,
  resolvePassengerRouteOccupancy,
  shouldIncludeRecoveryForRouteSwitch,
  snapUpToClockAlignSeconds,
} from './physics';
import { resolvePairHeadwaySeconds } from './validate';
import type { FeasibilityIssue } from './types';
import { minuteToSecond, secondToMinute, pushIssue } from './types';
import {
  resolveMaintenanceEntrySlackSeconds,
  type MaintenanceEntrySlackBySection,
} from '../resolveMaintenanceEntrySlackSeconds';
import {
  findEmptyRangeStartingAt,
  listEmptyAttributeMinuteRanges,
} from '../emptyAttributeIntervals';
import { resolveRotationOffsetForExitStation } from '../maintenanceFirstTripOrigins';
import { shouldApplyYardExitRotationAlign } from '../maintenancePostTaskPolicy';
import {
  resolveStartInstanceId,
  type RouteSuccessorPolicy,
} from './routeSuccessorPolicy';

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
  return resolvePassengerRouteOccupancy(route)?.occupancySeconds ?? 0;
}

function resolveMinOccupancySeconds(route: ShiftScheduleSelectedRoute): number {
  return resolvePassengerRouteOccupancy(route)?.minOccupancySeconds ?? 0;
}

/**
 * 硬約束：一輛車出去就必須把路線執行順序（例：下行→上行）整輪跑完，
 * 才能進入整備任務（充電、保養）或收班；不允許車輛停在對側終點站。
 *
 * 回程班次的發車時刻：
 * 1. 物理下限：前趟結束 + 恢復／換線（導通中段僅換線）
 * 2. 同方向班距對齊（可退讓：見上限）
 * 3. 上限 A：若補完本可在觸發整備前完成，禁止班距把回程推過整備起點
 * 4. 上限 B：不得與同車後續已掛正線重叠或吃掉換線／恢復空檔
 * 5. 整備視窗彈性：回程可吃進整備開頭；整備延後開始、鎖尾壓縮
 * 6. 日界保護：對齊跨日則退車隊物理班距，再不行回物理下限
 * 7. 占用預設用均；對不齊班距時可壓到快以趕上
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
  /**
   * 整備類型 → 出場站：行檢／充電／待命結束後，下一串正線輪替相位對齊該站起點。
   * 與 assignDirectionalDepartures／assignRoutes 共用同一策略表。
   */
  yardRotationExitByTaskType?: Partial<Record<TaskTypeKey, string[]>>;
  /** Step 4 繼任策略：開輪相位與次要備援 */
  successorPolicy?: RouteSuccessorPolicy;
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
    yardRotationExitByTaskType = {},
    successorPolicy,
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
    /** 本段正線已發車數；成輪＝此數為路線數整數倍（與相位無關） */
    let stretchPassengerCount = 0;
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
        stretchPassengerCount += 1;
        if (stretchPassengerCount % routeCount === 0) {
          partialPassengerTasks = [];
        }
        lastPassengerEndSecond =
          startSecond + Math.round(task.durationMinutes * 60);
        continue;
      }

      if (stretchPassengerCount % routeCount !== 0 && lastPassengerEndSecond != null) {
        const missingCount = routeCount - (stretchPassengerCount % routeCount);
        jobs.push({
          row,
          startRotationIndex: rotationIndex,
          missingCount,
          lastPassengerEndSecond,
          deferTaskId: task.id,
          partialPassengerTasks: [...partialPassengerTasks],
        });
        rotationIndex += missingCount;
        stretchPassengerCount += missingCount;
        partialPassengerTasks = [];
      }

      // 整備結束後：若該列之後仍有正線，輪替相位對齊出場站（行檢／充電／待命）
      const exitStationId = yardRotationExitByTaskType[task.taskType];
      const yardEndMinute = task.startMinute + task.durationMinutes;
      let phase = 0;
      if (
        shouldApplyYardExitRotationAlign({
          exitStationId,
          templateTasks: rowTasks,
          row,
          yardEndMinute,
        })
      ) {
        if (successorPolicy) {
          // stationSeed 用列號輪替候選出場站，避免多個候選全部收斂到同一站。
          const startId = resolveStartInstanceId(successorPolicy, exitStationId, row);
          if (startId) {
            /**
             * 相位是 <code>passengerRoutes</code> 的索引，不是
             * <code>rotationRoutes</code> 的索引——下面
             * <code>rotationIndex % routeCount</code>（<code>routeCount =
             * passengerRoutes.length</code>）索引的是 <code>passengerRoutes</code>，
             * 而 <code>resolveRouteIndexInRotation()</code> 找的是鎖定導通組合
             * （<code>passengerRoutes</code> 的子集且另有順序）。拿子集名次索引全集
             * 會指到另一條路線。同一個錯配見 normalizeInput.ts 的詳細說明。
             */
            const index = passengerRoutes.findIndex(
              (route) => resolveSelectedRouteInstanceId(route) === startId,
            );
            phase = index >= 0 ? index : 0;
          }
        } else {
          const exitStationSingle = Array.isArray(exitStationId)
            ? exitStationId[0]
            : exitStationId;
          phase =
            resolveRotationOffsetForExitStation(passengerRoutes, exitStationSingle) ?? 0;
        }
      }
      stretchPassengerCount = 0;
      rotationIndex =
        Math.ceil(rotationIndex / routeCount) * routeCount + phase;
    }

    if (stretchPassengerCount % routeCount !== 0 && lastPassengerEndSecond != null) {
      jobs.push({
        row,
        startRotationIndex: rotationIndex,
        missingCount: routeCount - (stretchPassengerCount % routeCount),
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
      const previousRoute = passengerRoutes[(rotationIndex - 1 + routeCount) % routeCount]!;
      const primaryRoute = passengerRoutes[rotationIndex % routeCount]!;
      // 只走鎖定輪替（全優先／執行順序）；不再嘗試次要備援走法
      const candidateRoutes: ShiftScheduleSelectedRoute[] = [primaryRoute];

      let placedRoute: ShiftScheduleSelectedRoute | null = null;
      let placedStartSecond: number | null = null;
      let placedOccupancy = 0;
      let lastFail:
        | {
            route: ShiftScheduleSelectedRoute;
            physicalEarliestSecond: number;
            latestStartSecond: number;
            nextPassengerStartSecond: number | null;
            reason: 'missing_occupancy' | 'no_slot';
          }
        | null = null;

      for (const route of candidateRoutes) {
        const avgOccupancy = resolveOccupancySeconds(route);
        const minOccupancy = resolveMinOccupancySeconds(route);
        if (avgOccupancy <= 0) {
          lastFail = {
            route,
            physicalEarliestSecond: lastEndSecond,
            latestStartSecond: lastEndSecond,
            nextPassengerStartSecond: null,
            reason: 'missing_occupancy',
          };
          continue;
        }

        const isRouteSwitch = previousRoute.routeId !== route.routeId;
        const includeRecovery = shouldIncludeRecoveryForRouteSwitch({
          previousRoute,
          nextRoute: route,
          rotationRoutes: passengerRoutes,
        });
        const physicalEarliestSecond = snapUpToClockAlignSeconds(
          lastEndSecond + resolveInterTripGapSeconds({
            minimumRecoveryTimeSeconds,
            previousRouteSwitchBufferSeconds: previousRoute.switchBufferAfterSeconds,
            isRouteSwitch,
            includeRecovery,
            previousRoute,
            nextRoute: route,
          }),
        );

        const tryWithOccupancy = (occupancySeconds: number): boolean => {
          const nextPassenger = findNextPassenger(job.row, lastEndSecond);
          let latestStartSecond = DAY_END_SECOND - occupancySeconds;
          if (nextPassenger) {
            const gapBeforeNext = resolveInterTripGapSeconds({
              minimumRecoveryTimeSeconds,
              previousRouteSwitchBufferSeconds: route.switchBufferAfterSeconds,
              isRouteSwitch: route.routeId !== nextPassenger.route.routeId,
              includeRecovery: shouldIncludeRecoveryForRouteSwitch({
                previousRoute: route,
                nextRoute: nextPassenger.route,
                rotationRoutes: passengerRoutes,
              }),
              previousRoute: route,
              nextRoute: nextPassenger.route,
            });
            latestStartSecond = Math.min(
              latestStartSecond,
              nextPassenger.startSecond - occupancySeconds - gapBeforeNext,
            );
          }

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
            lastFail = {
              route,
              physicalEarliestSecond,
              latestStartSecond,
              nextPassengerStartSecond: nextPassenger?.startSecond ?? null,
              reason: 'no_slot',
            };
            return false;
          }

          placedRoute = route;
          placedStartSecond = startSecond;
          placedOccupancy = occupancySeconds;
          return true;
        };

        // 平常用均；對不齊班距再壓到快
        if (tryWithOccupancy(avgOccupancy)) break;
        if (
          minOccupancy > 0
          && minOccupancy < avgOccupancy
          && tryWithOccupancy(minOccupancy)
        ) {
          break;
        }
      }

      if (!placedRoute || placedStartSecond == null) {
        placedAll = false;
        if (lastFail?.reason === 'missing_occupancy' && errors) {
          pushIssue(errors, {
            code: 'ROTATION_CYCLE_INCOMPLETE',
            severity: 'error',
            message: `時間線 ${job.row} 無法補完路線群組回程（缺有效行駛或停靠時間），車輛可能停在對側終點`,
            detail: {
              timelineRow: job.row,
              routeId: lastFail.route.routeId,
              lastPassengerEndSecond: job.lastPassengerEndSecond,
            },
          });
        } else if (!requireTargetHeadway && lastFail && errors) {
          pushIssue(errors, {
            code: 'ROTATION_CYCLE_INCOMPLETE',
            severity: 'error',
            message: `時間線 ${job.row} 無法補完回程：與同車後續正線或整備時窗衝突（物理最早 ${lastFail.physicalEarliestSecond}s，最晚可發 ${lastFail.latestStartSecond}s）`,
            detail: {
              timelineRow: job.row,
              routeId: lastFail.route.routeId,
              physicalEarliestSecond: lastFail.physicalEarliestSecond,
              latestStartSecond: lastFail.latestStartSecond,
              nextPassengerStartSecond: lastFail.nextPassengerStartSecond,
              deferTaskId: job.deferTaskId,
              triedSecondary: candidateRoutes.length > 1,
            },
          });
        }
        break;
      }

      const addition: ScheduleTask = {
        id: `pax-cycle-completion-${job.row}-${placedStartSecond}`,
        rowIndex: job.row,
        taskType: 'passenger',
        startMinute: secondToMinute(placedStartSecond),
        durationMinutes: Math.max(1, placedOccupancy / 60),
        label: '正線',
      };
      jobAdditions.push(addition);
      // TypeScript 不會追蹤 tryWithOccupancy closure 內的指派；上方 null guard
      // 已保證成功放置，此處固定為實際 route。
      const committedRoute = placedRoute as ShiftScheduleSelectedRoute;
      const depList = departuresByRouteId.get(committedRoute.routeId);
      if (depList) pushSorted(depList, placedStartSecond);
      else departuresByRouteId.set(committedRoute.routeId, [placedStartSecond]);

      lastEndSecond = placedStartSecond + placedOccupancy;
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
      templateStartMinute: task.templateStartMinute ?? task.startMinute,
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
