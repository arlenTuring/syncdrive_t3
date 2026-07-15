import {
  parseIntervalStartMinutes,
  parseIntervalEndMinutes,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import {
  sumStationDwellSecondsWithSlack,
  snapUpToClockAlignSeconds,
  normalizeSwitchBufferAfterSeconds,
  resolveRouteMinTurnaroundBudgetSeconds,
  resolveRouteRotationMinSeconds,
} from './physics';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
} from './types';
import { minuteToSecond, secondToMinute, pushIssue } from './types';

function resolveHeadwaySecondsAtMinute(
  minute: number,
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
): number | null {
  for (const interval of intervals) {
    const start = parseIntervalStartMinutes(interval.startTime);
    const end = parseIntervalEndMinutes(interval.endTime);
    if (start == null || end == null || end <= start) continue;
    if (minute < start || minute >= end) continue;
    const attribute = attributes.find((item) => item.id === interval.attributeId);
    if (!attribute) return null;
    const headway = attribute.headwaySeconds;
    return headway != null && headway > 0 ? headway : null;
  }
  return null;
}

/** 1.6 折返時限：單路線 error、多路線一整輪 warning */
export function validateTurnaroundLimits(
  selectedRoutes: ShiftScheduleSelectedRoute[],
  minimumRecoveryTimeSeconds: number,
  turnaroundLimitSeconds: number | null,
  errors: FeasibilityIssue[],
  warnings: FeasibilityIssue[],
): void {
  if (turnaroundLimitSeconds == null || turnaroundLimitSeconds <= 0) return;

  for (const route of selectedRoutes) {
    const budget = resolveRouteMinTurnaroundBudgetSeconds(route, minimumRecoveryTimeSeconds);
    if (budget == null) continue;
    if (budget > turnaroundLimitSeconds) {
      pushIssue(errors, {
        code: 'TURNAROUND_LIMIT_EXCEEDED',
        severity: 'error',
        message: `路線「${route.routeName}」最快一圈加恢復時間（${budget} 秒）超過車輛折返時限（${turnaroundLimitSeconds} 秒）`,
        detail: {
          routeId: route.routeId,
          budgetSeconds: budget,
          turnaroundLimitSeconds,
          minimumRecoveryTimeSeconds,
        },
      });
    }
  }

  if (selectedRoutes.length > 1) {
    const rotationMin = resolveRouteRotationMinSeconds(selectedRoutes);
    if (rotationMin != null && rotationMin > turnaroundLimitSeconds) {
      pushIssue(warnings, {
        code: 'ROUTE_ROTATION_OVER_TURNAROUND',
        severity: 'warning',
        message: `多路線一整輪加切換緩衝（${rotationMin} 秒）超過車輛折返時限（${turnaroundLimitSeconds} 秒）`,
        detail: {
          rotationMinSeconds: rotationMin,
          turnaroundLimitSeconds,
        },
      });
    }
  }
}

export function validateTimelineOverlaps(
  timelines: GeneratedSchedulePlan['timelines'],
  errors: FeasibilityIssue[],
): void {
  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i]!;
      const next = sorted[i + 1]!;
      if (current.plannedEndMinute > next.plannedStartMinute + 1e-9) {
        pushIssue(errors, {
          code: 'TIMELINE_OVERLAP',
          severity: 'error',
          message: `時間線 ${timeline.row} 任務時間重疊`,
          detail: {
            timelineRow: timeline.row,
            blockId: current.id,
            nextBlockId: next.id,
          },
        });
      }
    }
  }
}

export function validatePassengerHeadway(
  blocks: GeneratedScheduleBlock[],
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
  routeById: Map<string, ShiftScheduleSelectedRoute>,
  errors: FeasibilityIssue[],
  warnings: FeasibilityIssue[],
  /** 時間線數；車隊班距物理下限 = 單車最短一圈 / N */
  scheduleRowCount = 1,
): void {
  const timelineCount = Math.max(1, Math.floor(scheduleRowCount));
  const departures = blocks
    .filter((block) => block.taskType === 'passenger' && block.source === 'template_bar')
    .map((block) => ({
      startSecond: minuteToSecond(block.anchorStartMinute),
      routeId: block.routeId,
    }))
    .sort((a, b) => a.startSecond - b.startSecond);

  for (let i = 0; i < departures.length - 1; i += 1) {
    const current = departures[i]!;
    const next = departures[i + 1]!;
    const gapSeconds = next.startSecond - current.startSecond;
    if (gapSeconds <= 0) continue;

    const currentRoute = current.routeId ? routeById.get(current.routeId) : undefined;
    const minTravel = currentRoute?.minTravelTimeSeconds ?? currentRoute?.avgTravelTimeSeconds ?? 0;
    const dwellTotal = currentRoute
      ? (sumStationDwellSecondsWithSlack(
          currentRoute.stationDwells,
          currentRoute.dwellSlackPercent,
        ) ?? 0)
      : 0;
    // 單車最短一圈；多時間線時車隊可維持的物理班距下限為 cycle / N
    const singleVehicleCycle = snapUpToClockAlignSeconds(minTravel + dwellTotal);
    const fleetPhysicalFloor = snapUpToClockAlignSeconds(
      singleVehicleCycle / timelineCount,
    );

    if (fleetPhysicalFloor > 0 && gapSeconds < fleetPhysicalFloor) {
      pushIssue(errors, {
        code: 'HEADWAY_PHYSICAL_IMPOSSIBLE',
        severity: 'error',
        message: '相鄰正線發車間隔小於車隊物理可達班距（單車最短一圈／時間線數）',
        detail: {
          earlierDepartureMinute: secondToMinute(current.startSecond),
          laterDepartureMinute: secondToMinute(next.startSecond),
          gapSeconds,
          requiredMinSeconds: fleetPhysicalFloor,
          singleVehicleCycleSeconds: singleVehicleCycle,
          scheduleRowCount: timelineCount,
          routeId: current.routeId,
        },
      });
    }

    const headwayTarget = resolveHeadwaySecondsAtMinute(
      secondToMinute(current.startSecond),
      intervals,
      attributes,
    );
    if (headwayTarget != null && gapSeconds < headwayTarget) {
      pushIssue(warnings, {
        code: 'HEADWAY_BELOW_TARGET',
        severity: 'warning',
        message: '相鄰正線發車間隔低於時段屬性設定班距',
        detail: {
          earlierDepartureMinute: secondToMinute(current.startSecond),
          laterDepartureMinute: secondToMinute(next.startSecond),
          gapSeconds,
          targetHeadwaySeconds: headwayTarget,
        },
      });
    }
  }
}

export function validateTimelineCapacity(
  passengerBlocks: GeneratedScheduleBlock[],
  scheduleRowCount: number,
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
  routeById: Map<string, ShiftScheduleSelectedRoute>,
  warnings: FeasibilityIssue[],
): void {
  if (scheduleRowCount <= 0 || passengerBlocks.length === 0) return;

  for (const interval of intervals) {
    const start = parseIntervalStartMinutes(interval.startTime);
    const end = parseIntervalEndMinutes(interval.endTime);
    if (start == null || end == null || end <= start) continue;

    const attribute = attributes.find((item) => item.id === interval.attributeId);
    const headway = attribute?.headwaySeconds;
    if (headway == null || headway <= 0) continue;

    const blocksInInterval = passengerBlocks.filter((block) => {
      const minute = block.anchorStartMinute;
      return minute >= start && minute < end;
    });
    if (blocksInInterval.length === 0) continue;

    let maxCycleSeconds = 0;
    for (const block of blocksInInterval) {
      const route = block.routeId ? routeById.get(block.routeId) : undefined;
      const travel = route?.avgTravelTimeSeconds ?? block.travelSeconds;
      const dwell = route
        ? (sumStationDwellSecondsWithSlack(route.stationDwells, route.dwellSlackPercent)
          ?? block.dwellSeconds)
        : block.dwellSeconds;
      maxCycleSeconds = Math.max(maxCycleSeconds, snapUpToClockAlignSeconds(travel + dwell));
    }

    const steadyHeadwaySeconds = maxCycleSeconds / scheduleRowCount;
    if (steadyHeadwaySeconds > headway * 1.01) {
      pushIssue(warnings, {
        code: 'INSUFFICIENT_TIMELINES',
        severity: 'warning',
        message: '時間線數量可能不足以維持設定班距，實際穩態班距將偏大',
        detail: {
          intervalName: interval.name,
          configuredHeadwaySeconds: headway,
          estimatedSteadyHeadwaySeconds: Math.round(steadyHeadwaySeconds),
          scheduleRowCount,
          maxCycleSeconds,
        },
      });
    }
  }
}

/** S2 路線切換緩衝 */
export function validateRouteSwitchBuffers(
  timelines: GeneratedSchedulePlan['timelines'],
  routeById: Map<string, ShiftScheduleSelectedRoute>,
  errors: FeasibilityIssue[],
): void {
  for (const timeline of timelines) {
    const passengerBars = [...timeline.blocks]
      .filter((block) => block.source === 'template_bar' && block.taskType === 'passenger' && block.routeId)
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);

    for (let i = 0; i < passengerBars.length - 1; i += 1) {
      const current = passengerBars[i]!;
      const next = passengerBars[i + 1]!;
      if (!current.routeId || !next.routeId || current.routeId === next.routeId) continue;

      const route = routeById.get(current.routeId);
      const requiredBuffer = normalizeSwitchBufferAfterSeconds(route?.switchBufferAfterSeconds);
      if (requiredBuffer <= 0) continue;

      const gapSeconds = Math.round((next.plannedStartMinute - current.plannedEndMinute) * 60);
      if (gapSeconds < requiredBuffer) {
        pushIssue(errors, {
          code: 'ROUTE_SWITCH_BUFFER_INSUFFICIENT',
          severity: 'error',
          message: `時間線 ${timeline.row}：路線 ${current.routeName ?? current.routeId} 切換至 ${next.routeName ?? next.routeId} 的緩衝不足（需 ${requiredBuffer} 秒，僅 ${Math.max(0, gapSeconds)} 秒）`,
          detail: {
            timelineRow: timeline.row,
            fromRouteId: current.routeId,
            toRouteId: next.routeId,
            requiredBufferSeconds: requiredBuffer,
            actualGapSeconds: gapSeconds,
          },
        });
      }
    }
  }
}
