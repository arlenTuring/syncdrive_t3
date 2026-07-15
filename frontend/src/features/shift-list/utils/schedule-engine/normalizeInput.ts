import {
  sortSelectedRoutesByExecutionOrder,
  normalizeMinimumRecoveryTimeSeconds,
  sumStationDwellSecondsWithSlack,
  snapUpToClockAlignSeconds,
} from './physics';
import type { ShiftScheduleCreateDraft, ShiftScheduleSelectedRoute } from '../../types/create';
import {
  parseStoredTemplateBody,
  type ScheduleTask,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../../time-templates/types/editor';
import type { FeasibilityIssue } from './types';
import { pushIssue, secondToMinute } from './types';
import {
  assignDeparturesToEarliestTimeline,
  buildIntervalEndSecondByDepartureStart,
  generateDeparturesFromHeadway,
  TIMETABLE_GENERATION_ALGORITHM,
} from './generateDepartures';

export type PassengerTimetableMode = 'template' | 'headway';

export type EngineInput = {
  shiftId?: string;
  scheduleRowCount: number;
  confirmedTasks: ScheduleTask[];
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  passengerRoutes: ShiftScheduleSelectedRoute[];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  maintenanceBody: Record<string, unknown> | null;
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

function estimatePassengerOccupancySeconds(
  routes: ShiftScheduleSelectedRoute[],
): number {
  let maxOccupancy = 0;
  for (const route of routes) {
    if (!route.avgTravelTimeSeconds || route.avgTravelTimeSeconds <= 0) continue;
    const dwell = sumStationDwellSecondsWithSlack(
      route.stationDwells,
      route.dwellSlackPercent,
    );
    if (dwell == null) continue;
    maxOccupancy = Math.max(
      maxOccupancy,
      snapUpToClockAlignSeconds(route.avgTravelTimeSeconds + dwell),
    );
  }
  return maxOccupancy > 0 ? maxOccupancy : 600;
}

function buildHeadwayPassengerTasks(args: {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  scheduleRowCount: number;
  passengerRoutes: ShiftScheduleSelectedRoute[];
  errors: FeasibilityIssue[];
}): ScheduleTask[] | null {
  const departures = generateDeparturesFromHeadway({
    intervals: args.intervals,
    attributes: args.attributes,
  });

  if (departures.length === 0) {
    pushIssue(args.errors, {
      code: 'MISSING_TEMPLATE_TASKS',
      severity: 'error',
      message: '班距時刻生成失敗：營運時段缺少有效班距，或時段無法展開發車',
    });
    return null;
  }

  const intervalEndByStart = buildIntervalEndSecondByDepartureStart(
    departures,
    args.intervals,
  );
  const estimatedOccupancySeconds = estimatePassengerOccupancySeconds(
    args.passengerRoutes,
  );

  return assignDeparturesToEarliestTimeline({
    departures,
    scheduleRowCount: args.scheduleRowCount,
    estimatedOccupancySeconds,
    intervalEndSecondByDepartureStart: intervalEndByStart,
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

  const templateTasks = template.tasks.filter(
    (task) => task.rowIndex >= 1 && task.rowIndex <= template.scheduleRowCount,
  );
  const nonPassengerTasks = templateTasks.filter((task) => task.taskType !== 'passenger');

  let confirmedTasks: ScheduleTask[] = templateTasks;
  let timetableGenerationAlgorithm: string | undefined;

  if (mode === 'headway') {
    const generatedPassenger = buildHeadwayPassengerTasks({
      intervals: template.intervals,
      attributes: template.attributes,
      scheduleRowCount: template.scheduleRowCount,
      passengerRoutes,
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
    // 按照班距交錯發車，同時在各車輛（Row）的時間模板正線視窗內自適應掛載
    const minimumRecovery = normalizeMinimumRecoveryTimeSeconds(
      args.draft.routeGroups.minimumRecoveryTimeSeconds,
    );

    // 1. 產生理想發車時刻序列
    const departures = generateDeparturesFromHeadway({
      intervals: template.intervals,
      attributes: template.attributes,
    });

    const passengerTasks: ScheduleTask[] = [];

    if (departures.length > 0) {
      // 2. 建立各 Row 的正線可用時段窗口
      const rowActiveWindows = new Map<number, { startSecond: number; endSecond: number }[]>();
      for (let r = 1; r <= template.scheduleRowCount; r++) {
        rowActiveWindows.set(r, []);
      }

      const paxTasksInTemplate = templateTasks.filter((t) => t.taskType === 'passenger');
      for (const pTask of paxTasksInTemplate) {
        const startSec = pTask.startMinute * 60;
        const endSec = (pTask.startMinute + pTask.durationMinutes) * 60;
        const list = rowActiveWindows.get(pTask.rowIndex) ?? [];
        list.push({ startSecond: startSec, endSecond: endSec });
        rowActiveWindows.set(pTask.rowIndex, list);
      }

      // 3. 初始化各車釋放時間與指派索引 (1-indexed)
      const freeAt = Array.from({ length: template.scheduleRowCount + 1 }, () => 0);
      const rotationIndex = Array.from({ length: template.scheduleRowCount + 1 }, () => 0);

      const intervalEndByStart = buildIntervalEndSecondByDepartureStart(
        departures,
        template.intervals,
      );

      for (let index = 0; index < departures.length; index += 1) {
        const departure = departures[index]!;
        let startSecond = departure.startSecond;
        const intervalEnd = intervalEndByStart.get(departure.startSecond) ?? Number.POSITIVE_INFINITY;

        let chosenRow = -1;

        const findAvailableRow = (timeSec: number): number => {
          let bestRow = -1;
          let minFree = Number.POSITIVE_INFINITY;

          for (let row = 1; row <= template.scheduleRowCount; row += 1) {
            const windows = rowActiveWindows.get(row) ?? [];
            const inWindow = windows.some((win) => timeSec >= win.startSecond && timeSec < win.endSecond);
            if (!inWindow) continue;

            const earliestStart = freeAt[row]! === 0 ? 0 : snapUpToClockAlignSeconds(freeAt[row]! + minimumRecovery);
            if (earliestStart <= timeSec && freeAt[row]! < minFree) {
              minFree = freeAt[row]!;
              bestRow = row;
            }
          }
          return bestRow;
        };

        chosenRow = findAvailableRow(startSecond);

        if (chosenRow < 0) {
          // 延後發車直到有車輛可用
          let searchSecond = startSecond + 10;
          while (searchSecond < intervalEnd) {
            const found = findAvailableRow(searchSecond);
            if (found > 0) {
              startSecond = searchSecond;
              chosenRow = found;
              break;
            }
            searchSecond += 10;
          }
        }

        if (chosenRow < 0) {
          // 無法在此營運時段內排進，略過此發車
          continue;
        }

        const route = passengerRoutes.length > 0
          ? passengerRoutes[rotationIndex[chosenRow]! % passengerRoutes.length]
          : null;
        if (!route) continue;

        const dwell = sumStationDwellSecondsWithSlack(route.stationDwells, route.dwellSlackPercent) ?? 0;
        const travel = route.avgTravelTimeSeconds ?? 0;
        const occupancy = snapUpToClockAlignSeconds(travel + dwell);

        const startMin = secondToMinute(startSecond);
        const durationMin = Math.max(1, occupancy / 60);

        passengerTasks.push({
          id: `template-pax-${departure.intervalId}-${index + 1}-${startSecond}`,
          rowIndex: chosenRow,
          taskType: 'passenger',
          startMinute: startMin,
          durationMinutes: durationMin,
          label: '正線',
        });

        freeAt[chosenRow] = startSecond + occupancy;
        rotationIndex[chosenRow] += 1;
      }
    }

    confirmedTasks = [...nonPassengerTasks, ...passengerTasks];

    if (confirmedTasks.length === 0) {
      pushIssue(errors, {
        code: 'MISSING_TEMPLATE_TASKS',
        severity: 'error',
        message: '時間模板沒有可排班的任務',
      });
      return null;
    }
  }

  return {
    shiftId: args.shiftId,
    scheduleRowCount: template.scheduleRowCount,
    confirmedTasks,
    intervals: template.intervals,
    attributes: template.attributes,
    passengerRoutes,
    selectedRoutes,
    maintenanceBody,
    minimumRecoveryTimeSeconds: normalizeMinimumRecoveryTimeSeconds(
      args.draft.routeGroups.minimumRecoveryTimeSeconds,
    ),
    turnaroundLimitSeconds:
      args.turnaroundLimitSeconds == null || !Number.isFinite(args.turnaroundLimitSeconds)
        ? null
        : args.turnaroundLimitSeconds,
    passengerTimetableMode: mode,
    timetableGenerationAlgorithm,
  };
}
