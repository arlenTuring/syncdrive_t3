import {
  DEFAULT_MAINTENANCE_ENTRY_SLACK_SECONDS,
  parseEmptyIntervalMainlineSlackSeconds,
  parseMaintenanceEntrySlackBySection,
  resolveMaintenanceEntrySlackSeconds,
  type MaintenanceEntrySlackBySection,
} from '../resolveMaintenanceEntrySlackSeconds';
import {
  findEmptyRangeStartingAt,
  listEmptyAttributeMinuteRanges,
} from '../emptyAttributeIntervals';
import {
  sortSelectedRoutesByExecutionOrder,
  normalizeMinimumRecoveryTimeSeconds,
  resolveInterTripGapSeconds,
  sumStationDwellSecondsWithSlack,
  snapUpToClockAlignSeconds,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  resolveFleetPhysicalHeadwayFloorSeconds,
} from './physics';
import type { ShiftScheduleCreateDraft, ShiftScheduleSelectedRoute } from '../../types/create';
import { resolveEffectiveRouteTravelSeconds } from '../stationLegTravel';
import {
  parseStoredTemplateBody,
  type MinuteRange,
  type ScheduleTask,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../../time-templates/types/editor';
import type { FeasibilityIssue } from './types';
import { pushIssue, secondToMinute } from './types';
import {
  generateDirectionalDeparturesFromHeadway,
  TIMETABLE_GENERATION_ALGORITHM,
  type DirectionalHeadwayDeparture,
} from './generateDepartures';
import { applyRotationCycleCompletion } from './completeRotationCycles';

export type PassengerTimetableMode = 'template' | 'headway';

type ActivePassengerWindow = {
  /** 使用者在時間模板中宣告的正線開始秒 */
  startSecond: number;
  /**
   * 為了在正線開始時已具備服務能力，可在前一整備／空時段的可讓渡餘裕內提前出車。
   * 此值只會早於 startSecond，不會早於前一整備或空時段本身的開始。
   */
  dispatchStartSecond: number;
  endSecond: number;
  /** 視窗後接下整備（或空時段邊界）的開始秒；無則不套用切入餘裕閘門 */
  nextMaintenanceStartSecond: number | null;
  /** 接下整備／空時段的切入餘裕（秒） */
  entrySlackSeconds: number;
};

export type EngineInput = {
  shiftId?: string;
  scheduleRowCount: number;
  confirmedTasks: ScheduleTask[];
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  passengerRoutes: ShiftScheduleSelectedRoute[];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  maintenanceBody: Record<string, unknown> | null;
  maintenanceEntrySlackBySection: MaintenanceEntrySlackBySection;
  emptyIntervalMainlineSlackSeconds: number;
  minimumRecoveryTimeSeconds: number;
  turnaroundLimitSeconds: number | null;
  passengerTimetableMode: PassengerTimetableMode;
  timetableGenerationAlgorithm?: string;
};

export type NormalizeInputArgs = {
  shiftId?: string;
  draft: ShiftScheduleCreateDraft;
  templateBody: Record<string, unknown>;
  maintenanceTaskBody?: Record<string, unknown> | null;
  turnaroundLimitSeconds?: number | null;
  /**
   * template：沿用模板已畫的正線錨點
   * headway：依營運時段班距自動生成正線發車並掛時間線
   */
  passengerTimetableMode?: PassengerTimetableMode;
};

function resolveRouteOccupancySeconds(route: ShiftScheduleSelectedRoute): number {
  const travel =
    resolveEffectiveRouteTravelSeconds(route)?.avgTravelTimeSeconds
    ?? route.avgTravelTimeSeconds
    ?? 0;
  const dwell = sumStationDwellSecondsWithSlack(
    route.stationDwells,
    route.dwellSlackSeconds,
  ) ?? 0;
  return snapUpToClockAlignSeconds(travel + dwell);
}

/** 自輪替索引起估完一整輪剩餘占用（含班間恢復／換線） */
function estimateRemainingCycleSeconds(
  startRouteIndex: number,
  passengerRoutes: ShiftScheduleSelectedRoute[],
  minimumRecoveryTimeSeconds: number,
): number {
  const routeCount = passengerRoutes.length;
  let total = 0;
  for (let i = startRouteIndex; i < routeCount; i += 1) {
    const route = passengerRoutes[i]!;
    if (i > startRouteIndex) {
      const prev = passengerRoutes[i - 1]!;
      total += resolveInterTripGapSeconds({
        minimumRecoveryTimeSeconds,
        previousRouteSwitchBufferSeconds: prev.switchBufferAfterSeconds,
        isRouteSwitch: prev.routeId !== route.routeId,
      });
    }
    total += resolveRouteOccupancySeconds(route);
  }
  return total;
}

function resolveNextMaintenanceAfterWindow(
  row: number,
  windowEndSecond: number,
  nonPassengerTasks: ScheduleTask[],
  slackBySection: MaintenanceEntrySlackBySection,
): { startSecond: number; entrySlackSeconds: number } | null {
  const next = nonPassengerTasks
    .filter(
      (task) =>
        task.rowIndex === row
        && minuteToSecondApprox(task.startMinute) >= windowEndSecond - 1e-9,
    )
    .sort((a, b) => a.startMinute - b.startMinute)[0];
  if (!next) return null;
  return {
    startSecond: minuteToSecondApprox(next.startMinute),
    entrySlackSeconds: resolveMaintenanceEntrySlackSeconds(
      next.taskType,
      slackBySection,
    ),
  };
}

function resolvePreviousMaintenanceBeforeWindow(
  row: number,
  windowStartSecond: number,
  nonPassengerTasks: ScheduleTask[],
  slackBySection: MaintenanceEntrySlackBySection,
): { startSecond: number; endSecond: number; readinessSlackSeconds: number } | null {
  const previous = nonPassengerTasks
    .map((task) => ({
      task,
      startSecond: minuteToSecondApprox(task.startMinute),
      endSecond: minuteToSecondApprox(task.startMinute + task.durationMinutes),
    }))
    .filter(
      ({ task, startSecond, endSecond }) =>
        task.rowIndex === row
        && startSecond < windowStartSecond
        // 只允許緊接正線視窗的整備讓渡尾端；不可跨越模板中的空白區。
        && endSecond >= windowStartSecond - 1e-9,
    )
    .sort((a, b) => b.startSecond - a.startSecond)[0];
  if (!previous) return null;

  return {
    startSecond: previous.startSecond,
    endSecond: previous.endSecond,
    readinessSlackSeconds: resolveMaintenanceEntrySlackSeconds(
      previous.task.taskType,
      slackBySection,
    ),
  };
}

function resolveDispatchStartSecond(args: {
  windowStartSecond: number;
  previousMaint: {
    startSecond: number;
    readinessSlackSeconds: number;
  } | null;
}): number {
  const { windowStartSecond, previousMaint } = args;

  if (previousMaint) {
    return Math.max(
      previousMaint.startSecond,
      windowStartSecond - previousMaint.readinessSlackSeconds,
    );
  }

  // 空時段只允許占用「開頭」（正線結束後往後讓渡），
  // 不可提前占用正線開始前空時段的尾端。
  return windowStartSecond;
}

function resolveNextSpillBoundary(args: {
  windowEndSecond: number;
  nextMaint: { startSecond: number; entrySlackSeconds: number } | null;
  emptyRanges: MinuteRange[];
  emptyIntervalMainlineSlackSeconds: number;
}): { nextMaintenanceStartSecond: number | null; entrySlackSeconds: number } {
  const {
    windowEndSecond,
    nextMaint,
    emptyRanges,
    emptyIntervalMainlineSlackSeconds,
  } = args;

  if (nextMaint) {
    return {
      nextMaintenanceStartSecond: nextMaint.startSecond,
      entrySlackSeconds: nextMaint.entrySlackSeconds,
    };
  }

  const windowEndMinute = windowEndSecond / 60;
  const emptyAfter = findEmptyRangeStartingAt(emptyRanges, windowEndMinute);
  if (!emptyAfter) {
    return {
      nextMaintenanceStartSecond: null,
      entrySlackSeconds: DEFAULT_MAINTENANCE_ENTRY_SLACK_SECONDS,
    };
  }

  return {
    nextMaintenanceStartSecond: windowEndSecond,
    entrySlackSeconds: emptyIntervalMainlineSlackSeconds,
  };
}

function minuteToSecondApprox(minute: number): number {
  return Math.round(minute * 60);
}

/**
 * 方向感知掛車：每個發車脈衝已標定路線（方向），只派給「輪替正好輪到該方向」
 * 且位於正線視窗內的車輛。
 *
 * 準點優先；若車因恢復／換線略晚：
 * - 該方向已有前班：只要延後不跨越下一脈衝即可掛上（吸收累積遲到）
 * - 該方向尚無前班：最多延後 120s（避免開班把脈衝拖離格位）
 *
 * 同方向班距下限：上一班實際發車 + max(前班時段班距, 本班時段班距)。
 * 正線優先整備讓渡：
 * - 正線視窗結束前開出的整輪，可在切入餘裕內占用下一整備開頭。
 * - 正線視窗開始前，可在前一整備的同一餘裕內提前出車，讓視窗開始時已在服務。
 */
function assignDirectionalDepartures(args: {
  departures: DirectionalHeadwayDeparture[];
  scheduleRowCount: number;
  passengerRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  /** row → 正線可用視窗；未提供時視為全日可用（headway 模式） */
  rowActiveWindows?: Map<number, ActivePassengerWindow[]>;
}): ScheduleTask[] {
  const {
    departures,
    scheduleRowCount,
    passengerRoutes,
    minimumRecoveryTimeSeconds,
    rowActiveWindows,
  } = args;
  const routeCount = passengerRoutes.length;
  if (scheduleRowCount <= 0 || departures.length === 0 || routeCount === 0) return [];

  const freeAt = Array.from({ length: scheduleRowCount + 1 }, () => 0);
  const rotationIndex = Array.from({ length: scheduleRowCount + 1 }, () => 0);
  const windowKeyByRow = Array.from(
    { length: scheduleRowCount + 1 },
    () => '' as string,
  );
  /** 各方向上一班實際發車秒：小幅延後時仍須守住班距下限 */
  const lastDepartureSecondByRouteId = new Map<string, number>();
  /** 各方向上一班所屬時段班距：切時段時與本班取 max */
  const lastHeadwaySecondsByRouteId = new Map<string, number>();
  const tasks: ScheduleTask[] = [];

  const findWindow = (row: number, timeSec: number): ActivePassengerWindow | null => {
    if (!rowActiveWindows) {
      return {
        startSecond: 0,
        dispatchStartSecond: 0,
        endSecond: 24 * 3600,
        nextMaintenanceStartSecond: null,
        entrySlackSeconds: DEFAULT_MAINTENANCE_ENTRY_SLACK_SECONDS,
      };
    }
    const windows = rowActiveWindows.get(row) ?? [];
    return windows.find(
      (win) => timeSec >= win.dispatchStartSecond && timeSec < win.endSecond,
    ) ?? null;
  };
  const windowKey = (win: ActivePassengerWindow): string =>
    `${win.startSecond}-${win.endSecond}`;
  for (let index = 0; index < departures.length; index += 1) {
    const departure = departures[index]!;
    const pulseSecond = departure.startSecond;
    const route = passengerRoutes[departure.routeIndex];
    if (!route || route.routeId !== departure.routeId) continue;

    const hasPriorSameDirection = lastDepartureSecondByRouteId.has(route.routeId);
    const prevHeadway = lastHeadwaySecondsByRouteId.get(route.routeId)
      ?? departure.headwaySeconds;
    // 真實需求：相鄰兩班班距下限 = max(前班時段, 本班時段, 車隊物理下限)
    const fleetPhysicalFloor = resolveFleetPhysicalHeadwayFloorSeconds(
      route,
      scheduleRowCount,
    );
    const requiredHeadway = Math.max(
      prevHeadway,
      departure.headwaySeconds,
      fleetPhysicalFloor,
    );
    const headwayFloor = hasPriorSameDirection
      ? snapUpToClockAlignSeconds(
          lastDepartureSecondByRouteId.get(route.routeId)! + requiredHeadway,
        )
      : 0;
    // 下一脈衝邊界：延後若跨越此線，應留給下一脈衝，避免雙掛
    const nextPulseSecond = pulseSecond + departure.headwaySeconds;
    /**
     * 開班／該方向尚無前班：最多小幅延後 120s（避免 00:00 上行拖到 00:07:50）。
     * 營運中已有同方向前班：只要延後不跨越下一脈衝即可掛上
     * （吸收「前班已略延 → 本班再晚十幾秒」的累積，避免 D0538→D0552 跳格）。
     * 切時段時允許延後量也依 max(舊,新) 班距，才能把第一班推到較嚴下限。
     */
    const maxDelaySeconds = hasPriorSameDirection
      ? Math.max(0, requiredHeadway - SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS)
      : 120;

    let chosenRow = -1;
    let chosenStartSecond = pulseSecond;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let row = 1; row <= scheduleRowCount; row += 1) {
      const winAtPulse = findWindow(row, pulseSecond);
      if (!winAtPulse) continue;

      const nextWindowKey = windowKey(winAtPulse);
      if (windowKeyByRow[row] !== nextWindowKey) {
        // 跨整備／正線視窗時，上一視窗未成輪的班次稍後會由週期補完補回，
        // 或因找不到合法回程而整段撤回。因此新視窗必須從下一個完整輪次開始。
        // 只在候選判斷暫時視為 0 會讓實際計數不同步，後續路線再次錯位。
        rotationIndex[row] =
          Math.ceil(rotationIndex[row]! / routeCount) * routeCount;
        windowKeyByRow[row] = nextWindowKey;
      }
      const rotation = rotationIndex[row]!;
      if (rotation % routeCount !== departure.routeIndex) continue;

      let earliestStart = pulseSecond;
      if (freeAt[row]! > 0) {
        const prevRoute = passengerRoutes[
          (rotation - 1 + routeCount) % routeCount
        ]!;
        const gapSeconds = resolveInterTripGapSeconds({
          minimumRecoveryTimeSeconds,
          previousRouteSwitchBufferSeconds: prevRoute.switchBufferAfterSeconds,
          isRouteSwitch: prevRoute.routeId !== route.routeId,
        });
        earliestStart = snapUpToClockAlignSeconds(freeAt[row]! + gapSeconds);
      }

      // 取：脈衝、車就緒、同方向班距下限 三者最晚
      const startSecond = Math.max(pulseSecond, earliestStart, headwayFloor);
      const delay = startSecond - pulseSecond;
      if (delay > maxDelaySeconds) continue;
      if (startSecond >= nextPulseSecond) continue;
      if (startSecond >= winAtPulse.endSecond) continue;
      if (!findWindow(row, startSecond)) continue;

      // 開新輪：整備切入餘裕＝最多可偷進整備開頭的秒數（正線優先）。
      // 僅當「發車＋整輪來回」會超過「整備開始＋餘裕」時才不硬發。
      if (
        rotation % routeCount === 0
        && winAtPulse.nextMaintenanceStartSecond != null
      ) {
        const cycleNeed = estimateRemainingCycleSeconds(
          0,
          passengerRoutes,
          minimumRecoveryTimeSeconds,
        );
        const latestAllowedEnd =
          winAtPulse.nextMaintenanceStartSecond + winAtPulse.entrySlackSeconds;
        if (startSecond + cycleNeed > latestAllowedEnd) {
          continue;
        }
      }

      const score = delay * 1e9 + startSecond * 1e3 + freeAt[row]!;
      if (score < bestScore) {
        bestScore = score;
        chosenRow = row;
        chosenStartSecond = startSecond;
      }
    }

    if (chosenRow < 0) continue;

    const occupancy = resolveRouteOccupancySeconds(route);
    if (occupancy <= 0) continue;

    tasks.push({
      id: `template-pax-${departure.intervalId}-${departure.routeId}-${index + 1}-${chosenStartSecond}`,
      rowIndex: chosenRow,
      taskType: 'passenger',
      startMinute: secondToMinute(chosenStartSecond),
      durationMinutes: Math.max(1, occupancy / 60),
      label: '正線',
    });

    freeAt[chosenRow] = chosenStartSecond + occupancy;
    rotationIndex[chosenRow] += 1;
    lastDepartureSecondByRouteId.set(route.routeId, chosenStartSecond);
    lastHeadwaySecondsByRouteId.set(route.routeId, departure.headwaySeconds);
  }

  return tasks;
}

function buildHeadwayPassengerTasks(args: {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  scheduleRowCount: number;
  passengerRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  errors: FeasibilityIssue[];
}): ScheduleTask[] | null {
  const departures = generateDirectionalDeparturesFromHeadway({
    intervals: args.intervals,
    attributes: args.attributes,
    passengerRoutes: args.passengerRoutes,
  });

  if (departures.length === 0) {
    pushIssue(args.errors, {
      code: 'MISSING_TEMPLATE_TASKS',
      severity: 'error',
      message: '班距時刻生成失敗：營運時段缺少有效班距，或時段無法展開發車',
    });
    return null;
  }

  return assignDirectionalDepartures({
    departures,
    scheduleRowCount: args.scheduleRowCount,
    passengerRoutes: args.passengerRoutes,
    minimumRecoveryTimeSeconds: args.minimumRecoveryTimeSeconds,
  });
}

/**
 * 1.1 讀取輸入：模板任務、路線、整備、恢復時間、折返時限。
 * headway 模式可在沒有模板正線任務時，依班距生成正線錨點。
 */
export function normalizeEngineInput(
  args: NormalizeInputArgs,
  errors: FeasibilityIssue[],
): EngineInput | null {
  const template = parseStoredTemplateBody(args.templateBody);
  const mode: PassengerTimetableMode = args.passengerTimetableMode ?? 'template';

  const selectedRoutes = args.draft.routeGroups.selectedRoutes;
  const passengerRoutes = sortSelectedRoutesByExecutionOrder(selectedRoutes);
  const maintenanceBody =
    args.draft.maintenanceTask.skipped ? null : (args.maintenanceTaskBody ?? null);
  const slackBySection = parseMaintenanceEntrySlackBySection(
    args.draft.maintenanceTask.entrySlackBySection,
  );
  const emptyIntervalMainlineSlackSeconds = parseEmptyIntervalMainlineSlackSeconds(
    args.draft.timeTemplate.emptyIntervalMainlineSlackSeconds,
  );
  const emptyRanges = listEmptyAttributeMinuteRanges(template.intervals);

  const templateTasks = template.tasks.filter(
    (task) => task.rowIndex >= 1 && task.rowIndex <= template.scheduleRowCount,
  );
  const nonPassengerTasks = templateTasks.filter((task) => task.taskType !== 'passenger');

  const minimumRecovery = normalizeMinimumRecoveryTimeSeconds(
    args.draft.routeGroups.minimumRecoveryTimeSeconds,
  );

  let confirmedTasks: ScheduleTask[] = templateTasks;
  let timetableGenerationAlgorithm: string | undefined;

  if (mode === 'headway') {
    const generatedPassenger = buildHeadwayPassengerTasks({
      intervals: template.intervals,
      attributes: template.attributes,
      scheduleRowCount: template.scheduleRowCount,
      passengerRoutes,
      minimumRecoveryTimeSeconds: minimumRecovery,
      errors,
    });
    if (!generatedPassenger) return null;
    if (generatedPassenger.length === 0) {
      pushIssue(errors, {
        code: 'MISSING_TEMPLATE_TASKS',
        severity: 'error',
        message: '班距時刻生成未產出任何正線發車（時間線可能不足或時段過短）',
      });
      return null;
    }
    confirmedTasks = [...nonPassengerTasks, ...generatedPassenger];
    timetableGenerationAlgorithm = TIMETABLE_GENERATION_ALGORITHM;
  } else {
    // template 模式：仍依班距生成，但每方向獨立脈衝流，掛入各車正線視窗
    const departures = generateDirectionalDeparturesFromHeadway({
      intervals: template.intervals,
      attributes: template.attributes,
      passengerRoutes,
      emptyIntervalMainlineSlackSeconds,
    });

    const rowActiveWindows = new Map<number, ActivePassengerWindow[]>();
    for (let r = 1; r <= template.scheduleRowCount; r += 1) {
      rowActiveWindows.set(r, []);
    }
    const paxTasksInTemplate = templateTasks.filter((t) => t.taskType === 'passenger');
    for (const pTask of paxTasksInTemplate) {
      const startSec = pTask.startMinute * 60;
      const endSec = (pTask.startMinute + pTask.durationMinutes) * 60;
      const previousMaint = resolvePreviousMaintenanceBeforeWindow(
        pTask.rowIndex,
        startSec,
        nonPassengerTasks,
        slackBySection,
      );
      const nextMaint = resolveNextMaintenanceAfterWindow(
        pTask.rowIndex,
        endSec,
        nonPassengerTasks,
        slackBySection,
      );
      const spill = resolveNextSpillBoundary({
        windowEndSecond: endSec,
        nextMaint,
        emptyRanges,
        emptyIntervalMainlineSlackSeconds,
      });
      const list = rowActiveWindows.get(pTask.rowIndex) ?? [];
      list.push({
        startSecond: startSec,
        dispatchStartSecond: resolveDispatchStartSecond({
          windowStartSecond: startSec,
          previousMaint,
        }),
        endSecond: endSec,
        nextMaintenanceStartSecond: spill.nextMaintenanceStartSecond,
        entrySlackSeconds: spill.entrySlackSeconds,
      });
      rowActiveWindows.set(pTask.rowIndex, list);
    }

    const passengerTasks = assignDirectionalDepartures({
      departures,
      scheduleRowCount: template.scheduleRowCount,
      passengerRoutes,
      minimumRecoveryTimeSeconds: minimumRecovery,
      rowActiveWindows,
    });

    confirmedTasks = [...nonPassengerTasks, ...passengerTasks];
    timetableGenerationAlgorithm = TIMETABLE_GENERATION_ALGORITHM;

    if (confirmedTasks.length === 0) {
      pushIssue(errors, {
        code: 'MISSING_TEMPLATE_TASKS',
        severity: 'error',
        message: '時間模板沒有可排班的任務',
      });
      return null;
    }
  }

  // 週期補完硬約束：車輛出勤必須把路線輪替跑完（來回）才能進整備或收班；
  // 回程對齊同方向班距（正線優先，可占用整備視窗開頭）
  confirmedTasks = applyRotationCycleCompletion({
    tasks: confirmedTasks,
    passengerRoutes,
    scheduleRowCount: template.scheduleRowCount,
    minimumRecoveryTimeSeconds: minimumRecovery,
    intervals: template.intervals,
    attributes: template.attributes,
    maintenanceEntrySlackBySection: slackBySection,
    emptyIntervalMainlineSlackSeconds,
    errors,
  });

  return {
    shiftId: args.shiftId,
    scheduleRowCount: template.scheduleRowCount,
    confirmedTasks,
    intervals: template.intervals,
    attributes: template.attributes,
    passengerRoutes,
    selectedRoutes,
    maintenanceBody,
    maintenanceEntrySlackBySection: slackBySection,
    emptyIntervalMainlineSlackSeconds,
    minimumRecoveryTimeSeconds: minimumRecovery,
    turnaroundLimitSeconds:
      args.turnaroundLimitSeconds == null || !Number.isFinite(args.turnaroundLimitSeconds)
        ? null
        : args.turnaroundLimitSeconds,
    passengerTimetableMode: mode,
    timetableGenerationAlgorithm,
  };
}
