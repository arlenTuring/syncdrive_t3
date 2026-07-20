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
  resolveInterTripGapSeconds,
  resolveFleetPhysicalHeadwayFloorSeconds,
  resolveRouteMinTurnaroundBudgetSeconds,
  resolveRouteRotationMinSeconds,
} from './physics';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
} from './types';
import { minuteToSecond, secondToMinute, pushIssue } from './types';
import { resolveEffectiveRouteTravelSeconds } from '../stationLegTravel';

export function resolveHeadwaySecondsAtMinute(
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

/**
 * 同方向相鄰兩班的班距下限：取兩班各自所在時段班距的較大者。
 * （切時段 300→180 或 180→300 都必須守住較嚴的一邊。）
 */
export function resolvePairHeadwaySeconds(
  earlierMinute: number,
  laterMinute: number,
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
): number | null {
  const earlier = resolveHeadwaySecondsAtMinute(earlierMinute, intervals, attributes);
  const later = resolveHeadwaySecondsAtMinute(laterMinute, intervals, attributes);
  if (earlier == null && later == null) return null;
  return Math.max(earlier ?? 0, later ?? 0);
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
    // 過渡區塊只是空檔視覺，不參與重疊判定
    const sorted = [...timeline.blocks]
      .filter((block) => block.source !== 'transition')
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i]!;
      const next = sorted[i + 1]!;
      if (current.plannedEndMinute > next.plannedStartMinute + 1e-9) {
        const currentLabel = formatBlockConflictLabel(current);
        const nextLabel = formatBlockConflictLabel(next);
        pushIssue(errors, {
          code: 'TIMELINE_OVERLAP',
          severity: 'error',
          message: `時間線 ${timeline.row} 任務時間重疊：${currentLabel} 與 ${nextLabel}`,
          detail: {
            timelineRow: timeline.row,
            blockId: current.id,
            nextBlockId: next.id,
            earlierLabel: currentLabel,
            laterLabel: nextLabel,
            earlierEndMinute: current.plannedEndMinute,
            laterStartMinute: next.plannedStartMinute,
          },
        });
      }
    }
  }
}

function formatBlockConflictLabel(block: GeneratedScheduleBlock): string {
  const code = block.routeCode?.trim() || null;
  const start = formatMinuteHms(block.plannedStartMinute);
  const end = formatMinuteHms(block.plannedEndMinute);
  const name = block.routeName ?? block.label;
  if (code) return `${code}${start.replaceAll(':', '').slice(0, 4)} ${name}（${start}–${end}）`;
  return `${name}（${start}–${end}）`;
}

function formatMinuteHms(minute: number): string {
  const totalSeconds = Math.max(0, Math.round(minute * 60));
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
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
  // 班距只在同一路線（同方向）的相鄰發車之間有定義；
  // 不同方向（如上行 vs 下行）的發車交錯不構成班距違規
  const departuresByRoute = new Map<
    string,
    { startSecond: number; routeId?: string; blockId: string }[]
  >();
  for (const block of blocks) {
    if (block.taskType !== 'passenger' || block.source !== 'template_bar') continue;
    const key = block.routeId ?? '__unassigned__';
    const list = departuresByRoute.get(key) ?? [];
    list.push({
      // 以實際計畫發車驗證（調整後以 planned 為準）
      startSecond: minuteToSecond(block.plannedStartMinute),
      routeId: block.routeId,
      blockId: block.id,
    });
    departuresByRoute.set(key, list);
  }

  for (const [, departures] of departuresByRoute) {
    departures.sort((a, b) => a.startSecond - b.startSecond);
    validateSameRouteHeadway(
      departures,
      intervals,
      attributes,
      routeById,
      errors,
      warnings,
      timelineCount,
    );
  }
}

function validateSameRouteHeadway(
  departures: { startSecond: number; routeId?: string; blockId: string }[],
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
  routeById: Map<string, ShiftScheduleSelectedRoute>,
  errors: FeasibilityIssue[],
  warnings: FeasibilityIssue[],
  timelineCount: number,
): void {
  for (let i = 0; i < departures.length - 1; i += 1) {
    const current = departures[i]!;
    const next = departures[i + 1]!;
    const gapSeconds = next.startSecond - current.startSecond;
    if (gapSeconds <= 0) continue;

    const currentRoute = current.routeId ? routeById.get(current.routeId) : undefined;
    const minTravel =
      resolveEffectiveRouteTravelSeconds(currentRoute ?? { stationIds: [] })?.minTravelTimeSeconds
      ?? currentRoute?.minTravelTimeSeconds
      ?? currentRoute?.avgTravelTimeSeconds
      ?? 0;
    const dwellTotal = currentRoute
      ? (sumStationDwellSecondsWithSlack(
          currentRoute.stationDwells,
          currentRoute.dwellSlackSeconds,
        ) ?? 0)
      : 0;
    const singleVehicleCycle = snapUpToClockAlignSeconds(minTravel + dwellTotal);
    const fleetPhysicalFloor = currentRoute
      ? resolveFleetPhysicalHeadwayFloorSeconds(currentRoute, timelineCount)
      : snapUpToClockAlignSeconds(singleVehicleCycle / Math.max(1, timelineCount));

    const earlierLabel = formatMinuteHms(secondToMinute(current.startSecond));
    const laterLabel = formatMinuteHms(secondToMinute(next.startSecond));
    const routeLabel = currentRoute?.routeName ?? current.routeId ?? '正線';

    if (fleetPhysicalFloor > 0 && gapSeconds < fleetPhysicalFloor) {
      pushIssue(errors, {
        code: 'HEADWAY_PHYSICAL_IMPOSSIBLE',
        severity: 'error',
        message: `${routeLabel} 相鄰發車 ${earlierLabel}→${laterLabel} 間隔 ${gapSeconds} 秒，低於車隊物理可達班距 ${fleetPhysicalFloor} 秒`,
        detail: {
          earlierBlockId: current.blockId,
          laterBlockId: next.blockId,
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

    const headwayTarget = resolvePairHeadwaySeconds(
      secondToMinute(current.startSecond),
      secondToMinute(next.startSecond),
      intervals,
      attributes,
    );
    if (headwayTarget != null && gapSeconds < headwayTarget) {
      pushIssue(warnings, {
        code: 'HEADWAY_BELOW_TARGET',
        severity: 'warning',
        message: `${routeLabel} 相鄰發車 ${earlierLabel}→${laterLabel} 間隔 ${gapSeconds} 秒，低於時段班距 ${headwayTarget} 秒（取兩班時段較嚴者）`,
        detail: {
          earlierBlockId: current.blockId,
          laterBlockId: next.blockId,
          earlierDepartureMinute: secondToMinute(current.startSecond),
          laterDepartureMinute: secondToMinute(next.startSecond),
          gapSeconds,
          targetHeadwaySeconds: headwayTarget,
          routeId: current.routeId,
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
      const travel =
        resolveEffectiveRouteTravelSeconds(route ?? { stationIds: [] })?.avgTravelTimeSeconds
        ?? route?.avgTravelTimeSeconds
        ?? block.travelSeconds;
      const dwell = route
        ? (sumStationDwellSecondsWithSlack(route.stationDwells, route.dwellSlackSeconds)
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

/**
 * S1＋S2：同一時間線相鄰正線空檔須 ≥ 恢復時間；
 * 換路線時另加前一路線換線緩衝（兩者相加）。
 */
export function validateRouteSwitchBuffers(
  timelines: GeneratedSchedulePlan['timelines'],
  routeById: Map<string, ShiftScheduleSelectedRoute>,
  errors: FeasibilityIssue[],
  minimumRecoveryTimeSeconds = 0,
): void {
  for (const timeline of timelines) {
    const passengerBars = [...timeline.blocks]
      .filter((block) => block.source === 'template_bar' && block.taskType === 'passenger' && block.routeId)
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);

    for (let i = 0; i < passengerBars.length - 1; i += 1) {
      const current = passengerBars[i]!;
      const next = passengerBars[i + 1]!;
      if (!current.routeId || !next.routeId) continue;

      const isRouteSwitch = current.routeId !== next.routeId;
      const route = routeById.get(current.routeId);
      const requiredGap = resolveInterTripGapSeconds({
        minimumRecoveryTimeSeconds,
        previousRouteSwitchBufferSeconds: route?.switchBufferAfterSeconds,
        isRouteSwitch,
      });
      if (requiredGap <= 0) continue;

      const gapSeconds = Math.round((next.plannedStartMinute - current.plannedEndMinute) * 60);
      if (gapSeconds >= requiredGap) continue;

      if (isRouteSwitch) {
        pushIssue(errors, {
          code: 'ROUTE_SWITCH_BUFFER_INSUFFICIENT',
          severity: 'error',
          message: `時間線 ${timeline.row}：路線 ${current.routeName ?? current.routeId} 切換至 ${next.routeName ?? next.routeId} 的空檔不足（需恢復 ${minimumRecoveryTimeSeconds} 秒＋換線緩衝，共 ${requiredGap} 秒；僅 ${Math.max(0, gapSeconds)} 秒）`,
          detail: {
            timelineRow: timeline.row,
            fromRouteId: current.routeId,
            toRouteId: next.routeId,
            requiredGapSeconds: requiredGap,
            minimumRecoveryTimeSeconds,
            requiredBufferSeconds: requiredGap - minimumRecoveryTimeSeconds,
            actualGapSeconds: gapSeconds,
          },
        });
      } else {
        pushIssue(errors, {
          code: 'RECOVERY_INSUFFICIENT',
          severity: 'error',
          message: `時間線 ${timeline.row}：${current.label} 與下一班之間的空檔不足恢復時間（需至少 ${minimumRecoveryTimeSeconds} 秒，僅 ${Math.max(0, gapSeconds)} 秒）`,
          detail: {
            timelineRow: timeline.row,
            fromRouteId: current.routeId,
            toRouteId: next.routeId,
            gapSeconds,
            minimumRecoveryTimeSeconds,
          },
        });
      }
    }
  }
}

/**
 * 硬約束：每條時間線的正線趟數須為路線群組大小的整數倍（跑完一整輪才能收班／進整備）。
 */
export function validateRotationCyclesComplete(
  timelines: GeneratedSchedulePlan['timelines'],
  routeCount: number,
  errors: FeasibilityIssue[],
): void {
  if (routeCount <= 1) return;
  for (const timeline of timelines) {
    const passengerBars = [...timeline.blocks]
      .filter((block) => block.source === 'template_bar' && block.taskType === 'passenger')
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    if (passengerBars.length === 0) continue;
    if (passengerBars.length % routeCount === 0) continue;

    const last = passengerBars[passengerBars.length - 1]!;
    const lastLabel = last.routeCode ?? last.routeName ?? last.label;
    pushIssue(errors, {
      code: 'ROTATION_CYCLE_INCOMPLETE',
      severity: 'error',
      message: `時間線 ${timeline.row} 未跑完路線群組來回（正線 ${passengerBars.length} 趟，須為 ${routeCount} 的整數倍）。最後一趟：${lastLabel}`,
      detail: {
        timelineRow: timeline.row,
        passengerTripCount: passengerBars.length,
        routeCount,
        blockId: last.id,
        lastRouteId: last.routeId,
        lastRouteName: last.routeName,
      },
    });
  }
}
