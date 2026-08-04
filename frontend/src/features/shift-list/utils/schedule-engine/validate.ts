import {
  parseIntervalStartMinutes,
  parseIntervalEndMinutes,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import { resolveSelectedRouteInstanceId } from '../../types/create';
import {
  resolveRouteOriginStation,
  resolveRouteTerminalStation,
} from '../routeRelationGraph';
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
import {
  buildBlockStationDepartures,
  resolveBlockStationDepartureFeasibility,
  resolveRouteForBlock,
} from '../buildBlockStationDepartures';
import {
  ROUTE_SUCCESSOR_ALGORITHM_GRAPH,
  resolveNextInstanceId,
  type RouteSuccessorPolicy,
} from './routeSuccessorPolicy';

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

/** 1.6 折返時限：單路線 error；多路線一整輪用鎖定組合（有則）或執行順序加總 warning */
export function validateTurnaroundLimits(
  selectedRoutes: ShiftScheduleSelectedRoute[],
  minimumRecoveryTimeSeconds: number,
  turnaroundLimitSeconds: number | null,
  errors: FeasibilityIssue[],
  warnings: FeasibilityIssue[],
  lockedRotationMinSeconds: number | null = null,
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
    const rotationMin =
      lockedRotationMinSeconds != null && lockedRotationMinSeconds > 0
        ? lockedRotationMinSeconds
        : resolveRouteRotationMinSeconds(selectedRoutes);
    if (rotationMin != null && rotationMin > turnaroundLimitSeconds) {
      pushIssue(warnings, {
        code: 'ROUTE_ROTATION_OVER_TURNAROUND',
        severity: 'warning',
        message:
          lockedRotationMinSeconds != null
            ? `鎖定全優先路線組合最快一輪（${rotationMin} 秒）超過車輛折返時限（${turnaroundLimitSeconds} 秒）`
            : `多路線一整輪加切換緩衝（${rotationMin} 秒）超過車輛折返時限（${turnaroundLimitSeconds} 秒）`,
        detail: {
          rotationMinSeconds: rotationMin,
          turnaroundLimitSeconds,
          lockedCombination: lockedRotationMinSeconds != null,
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
      if (current.plannedEndMinute <= next.plannedStartMinute + 1e-9) continue;

      // 調度可與保養／行前尾端重疊，但重疊不得超過調度本身時長（不到站佔位）
      if (isAllowedMaintenanceDispatchOverlap(current, next)) continue;
      // 進場載客可偷保養尾端：載客串起點不早於保養開始即允許重疊
      if (isAllowedEntryServiceOverlap(current, next)) continue;

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

function isYardWindowForDispatchOverlap(block: GeneratedScheduleBlock): boolean {
  return (
    block.source === 'template_bar'
    && (block.taskType === 'servicing' || block.taskType === 'inspection')
  );
}

function isAllowedMaintenanceDispatchOverlap(
  earlier: GeneratedScheduleBlock,
  later: GeneratedScheduleBlock,
): boolean {
  const yardThenDispatch =
    isYardWindowForDispatchOverlap(earlier) && later.source === 'dispatch';
  const dispatchThenYard =
    earlier.source === 'dispatch' && isYardWindowForDispatchOverlap(later);
  if (!yardThenDispatch && !dispatchThenYard) return false;

  const yard = yardThenDispatch ? earlier : later;
  const dispatch = yardThenDispatch ? later : earlier;
  const dispatchDuration = dispatch.plannedEndMinute - dispatch.plannedStartMinute;
  if (dispatchDuration <= 0) return false;

  const overlapStart = Math.max(yard.plannedStartMinute, dispatch.plannedStartMinute);
  const overlapEnd = Math.min(yard.plannedEndMinute, dispatch.plannedEndMinute);
  const overlap = overlapEnd - overlapStart;
  if (overlap <= 0) return true;
  // 重疊 ≤ 調度時長，且調度結束不得早於整備結束超過「調度全長」（即最多吃掉整段空駛）
  return overlap <= dispatchDuration + 1e-9;
}

/**
 * 進場載客（載客調度）偷保養尾端：允許與保養（servicing）視窗重疊，
 * 但載客串的起點不得早於保養開始（只偷尾巴，不吃整段之前）。
 */
function isAllowedEntryServiceOverlap(
  earlier: GeneratedScheduleBlock,
  later: GeneratedScheduleBlock,
): boolean {
  const yardThenEntry =
    earlier.source === 'template_bar'
    && earlier.taskType === 'servicing'
    && later.source === 'entry_service';
  const entryThenYard =
    earlier.source === 'entry_service'
    && later.source === 'template_bar'
    && later.taskType === 'servicing';
  if (!yardThenEntry && !entryThenYard) return false;

  const yard = yardThenEntry ? earlier : later;
  const entry = yardThenEntry ? later : earlier;
  return entry.plannedStartMinute >= yard.plannedStartMinute - 1e-9;
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
      const earlierHw = resolveHeadwaySecondsAtMinute(
        secondToMinute(current.startSecond),
        intervals,
        attributes,
      );
      const laterHw = resolveHeadwaySecondsAtMinute(
        secondToMinute(next.startSecond),
        intervals,
        attributes,
      );
      const straddlesInterval =
        earlierHw != null && laterHw != null && earlierHw !== laterHw;
      pushIssue(warnings, {
        code: 'HEADWAY_BELOW_TARGET',
        severity: 'warning',
        kind: 'limit',
        message: straddlesInterval
          ? `${routeLabel} 相鄰發車 ${earlierLabel}→${laterLabel} 間隔 ${gapSeconds} 秒，低於跨時段班距下限 ${headwayTarget} 秒（兩時段 ${earlierHw}/${laterHw}，取較嚴者；此對班多半非乾淨脈衝）`
          : `${routeLabel} 相鄰發車 ${earlierLabel}→${laterLabel} 間隔 ${gapSeconds} 秒，低於時段班距 ${headwayTarget} 秒（多半來自補完／延後／多車擠班）`,
        detail: {
          earlierBlockId: current.blockId,
          laterBlockId: next.blockId,
          earlierDepartureMinute: secondToMinute(current.startSecond),
          laterDepartureMinute: secondToMinute(next.startSecond),
          gapSeconds,
          targetHeadwaySeconds: headwayTarget,
          earlierIntervalHeadwaySeconds: earlierHw,
          laterIntervalHeadwaySeconds: laterHw,
          straddlesInterval,
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
 * S1＋S2：同一時間線相鄰正線空檔須 ≥ 恢復時間（折返／同路線）
 * 或僅換線緩衝（導通中段繼任）。
 */
export function validateRouteSwitchBuffers(
  timelines: GeneratedSchedulePlan['timelines'],
  routeById: Map<string, ShiftScheduleSelectedRoute>,
  errors: FeasibilityIssue[],
  minimumRecoveryTimeSeconds = 0,
  rotationRoutes: ShiftScheduleSelectedRoute[] = [],
  successorPolicy?: RouteSuccessorPolicy,
): void {
  const routesForRecovery =
    rotationRoutes.length > 0 ? rotationRoutes : [...routeById.values()];
  if (successorPolicy) {
    validateRouteSuccessorContinuity(
      timelines,
      routesForRecovery,
      errors,
      successorPolicy,
    );
  }
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
      const nextRoute = routeById.get(next.routeId);
      const includeRecovery =
        !isRouteSwitch
        || !route
        || !nextRoute
        || shouldIncludeRecoveryForTimelineSuccessor(
          route,
          nextRoute,
          routesForRecovery,
        );
      const requiredGap = resolveInterTripGapSeconds({
        minimumRecoveryTimeSeconds,
        previousRouteSwitchBufferSeconds: route?.switchBufferAfterSeconds,
        isRouteSwitch,
        includeRecovery,
        previousRoute: route ?? undefined,
        nextRoute: nextRoute ?? undefined,
      });
      if (requiredGap <= 0) continue;

      const gapSeconds = Math.round((next.plannedStartMinute - current.plannedEndMinute) * 60);
      if (gapSeconds >= requiredGap) continue;

      if (isRouteSwitch) {
        pushIssue(errors, {
          code: 'ROUTE_SWITCH_BUFFER_INSUFFICIENT',
          severity: 'error',
          message: includeRecovery
            ? `時間線 ${timeline.row}：路線 ${current.routeName ?? current.routeId} 切換至 ${next.routeName ?? next.routeId} 的空檔不足（需恢復 ${minimumRecoveryTimeSeconds} 秒＋換線緩衝，共 ${requiredGap} 秒；僅 ${Math.max(0, gapSeconds)} 秒）`
            : `時間線 ${timeline.row}：路線 ${current.routeName ?? current.routeId} 切換至 ${next.routeName ?? next.routeId} 的空檔不足（需換線緩衝 ${requiredGap} 秒；僅 ${Math.max(0, gapSeconds)} 秒）`,
          detail: {
            timelineRow: timeline.row,
            fromRouteId: current.routeId,
            toRouteId: next.routeId,
            requiredGapSeconds: requiredGap,
            minimumRecoveryTimeSeconds,
            requiredBufferSeconds: includeRecovery
              ? requiredGap - minimumRecoveryTimeSeconds
              : requiredGap,
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

function shouldIncludeRecoveryForTimelineSuccessor(
  previousRoute: ShiftScheduleSelectedRoute,
  nextRoute: ShiftScheduleSelectedRoute,
  rotationRoutes: ShiftScheduleSelectedRoute[],
): boolean {
  if (previousRoute.routeId === nextRoute.routeId) return true;
  const previousInstanceId = resolveSelectedRouteInstanceId(previousRoute);
  const nextInstanceId = resolveSelectedRouteInstanceId(nextRoute);
  const previousIndex = rotationRoutes.findIndex(
    (route) => resolveSelectedRouteInstanceId(route) === previousInstanceId,
  );
  const nextIndex = rotationRoutes.findIndex(
    (route) => resolveSelectedRouteInstanceId(route) === nextInstanceId,
  );
  if (previousIndex < 0 || nextIndex < 0 || rotationRoutes.length <= 1) return true;
  if (nextIndex !== (previousIndex + 1) % rotationRoutes.length) return true;
  return nextIndex === 0;
}

function resolveBlockRouteInstance(args: {
  block: GeneratedScheduleBlock;
  routes: ShiftScheduleSelectedRoute[];
  timelineRow: number;
  errors: FeasibilityIssue[];
}): ShiftScheduleSelectedRoute | null {
  const explicitInstanceId = args.block.routeInstanceId?.trim();
  if (explicitInstanceId) {
    const explicit = args.routes.find(
      (route) => resolveSelectedRouteInstanceId(route) === explicitInstanceId,
    );
    if (explicit) return explicit;
    pushIssue(args.errors, {
      code: 'ROUTE_INSTANCE_AMBIGUOUS',
      severity: 'error',
      message: `時間線 ${args.timelineRow}：班次 ${args.block.routeCode ?? args.block.routeId ?? args.block.label} 指定的路線實例 ${explicitInstanceId} 不在目前 selected routes`,
      detail: {
        timelineRow: args.timelineRow,
        blockId: args.block.id,
        routeId: args.block.routeId,
        routeInstanceId: explicitInstanceId,
      },
    });
    return null;
  }

  const candidates = args.routes.filter(
    (route) => route.routeId === args.block.routeId,
  );
  if (candidates.length === 1) return candidates[0]!;

  pushIssue(args.errors, {
    code: 'ROUTE_INSTANCE_AMBIGUOUS',
    severity: 'error',
    message:
      candidates.length > 1
        ? `時間線 ${args.timelineRow}：班次 ${args.block.routeCode ?? args.block.routeId ?? args.block.label} 僅有 routeId，無法在 ${candidates.length} 個同路線實例中判定關聯圖節點`
        : `時間線 ${args.timelineRow}：班次 ${args.block.routeCode ?? args.block.routeId ?? args.block.label} 無法解析對應路線實例`,
    detail: {
      timelineRow: args.timelineRow,
      blockId: args.block.id,
      routeId: args.block.routeId,
      routeInstanceId: args.block.routeInstanceId,
      candidateInstanceIds: candidates.map(resolveSelectedRouteInstanceId),
    },
  });
  return null;
}

/**
 * 硬約束：同車相鄰 passenger blocks 必須依 instance successor，
 * 且前趟 terminal station 必須等於後趟 origin station。
 * 若兩班正線之間隔了整備／充電等非正線，交路由出場相位重新開輪，不套用本檢查。
 */
export function validateRouteSuccessorContinuity(
  timelines: GeneratedSchedulePlan['timelines'],
  selectedRoutes: ShiftScheduleSelectedRoute[],
  errors: FeasibilityIssue[],
  successorPolicy?: RouteSuccessorPolicy,
): void {
  if (successorPolicy && !successorPolicy.valid) {
    pushIssue(errors, {
      code: 'ROUTE_SUCCESSOR_POLICY_INVALID',
      severity: 'error',
      message: `關聯圖繼任策略無效（${successorPolicy.issue ?? 'UNKNOWN'}），禁止退回 executionOrder 產班`,
      detail: {
        algorithm: successorPolicy.algorithm,
        policyIssue: successorPolicy.issue,
      },
    });
    return;
  }
  // 無 Step 4 關聯圖的舊資料只能使用相容 ring；其測試／資料可能沒有可供
  // 地理驗證的真實端點。硬 successor 與停靠點連續性只對已驗證 graph 啟用。
  if (
    !successorPolicy
    || successorPolicy.algorithm !== ROUTE_SUCCESSOR_ALGORITHM_GRAPH
  ) {
    return;
  }
  if (selectedRoutes.length === 0) return;

  const orderedInstanceIds = selectedRoutes.map(resolveSelectedRouteInstanceId);

  for (const timeline of timelines) {
    const passengerBlocks = [...timeline.blocks]
      .filter(
        (block) =>
          block.source === 'template_bar'
          && block.taskType === 'passenger'
          && block.routeId,
      )
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);

    for (let i = 0; i < passengerBlocks.length - 1; i += 1) {
      const currentBlock = passengerBlocks[i]!;
      const nextBlock = passengerBlocks[i + 1]!;
      // 中間隔了充電／保養／行前／機動等非正線時，交路由出場相位或進場載客重新對齊，
      // 不要求與進整備前最後一班無縫 successor。
      if (hasNonPassengerBetween(timeline.blocks, currentBlock, nextBlock)) {
        continue;
      }
      const currentRoute = resolveBlockRouteInstance({
        block: currentBlock,
        routes: selectedRoutes,
        timelineRow: timeline.row,
        errors,
      });
      const nextRoute = resolveBlockRouteInstance({
        block: nextBlock,
        routes: selectedRoutes,
        timelineRow: timeline.row,
        errors,
      });
      if (!currentRoute || !nextRoute) continue;

      const currentInstanceId = resolveSelectedRouteInstanceId(currentRoute);
      const nextInstanceId = resolveSelectedRouteInstanceId(nextRoute);
      const expectedInstanceId = successorPolicy
        ? resolveNextInstanceId(successorPolicy, currentInstanceId)?.instanceId
        : orderedInstanceIds[
          (orderedInstanceIds.indexOf(currentInstanceId) + 1)
          % orderedInstanceIds.length
        ];

      if (!expectedInstanceId || expectedInstanceId !== nextInstanceId) {
        pushIssue(errors, {
          code: 'ROUTE_SUCCESSOR_MISMATCH',
          severity: 'error',
          message: `時間線 ${timeline.row}：${currentRoute.routeCode}（${currentInstanceId}）下一趟應為 ${expectedInstanceId ?? '無可用 successor'}，實際為 ${nextRoute.routeCode}（${nextInstanceId}）`,
          detail: {
            timelineRow: timeline.row,
            earlierBlockId: currentBlock.id,
            laterBlockId: nextBlock.id,
            fromInstanceId: currentInstanceId,
            expectedInstanceId,
            actualInstanceId: nextInstanceId,
          },
        });
      }

      const terminalStationId =
        resolveRouteTerminalStation(currentRoute)?.stationId ?? null;
      const originStationId =
        resolveRouteOriginStation(nextRoute)?.stationId ?? null;
      if (
        !terminalStationId
        || !originStationId
        || terminalStationId !== originStationId
      ) {
        pushIssue(errors, {
          code: 'ROUTE_STATION_DISCONTINUITY',
          severity: 'error',
          message: `時間線 ${timeline.row}：${currentRoute.routeCode} 終點 ${terminalStationId ?? '未知'} 無法銜接 ${nextRoute.routeCode} 起點 ${originStationId ?? '未知'}`,
          detail: {
            timelineRow: timeline.row,
            earlierBlockId: currentBlock.id,
            laterBlockId: nextBlock.id,
            fromInstanceId: currentInstanceId,
            toInstanceId: nextInstanceId,
            terminalStationId,
            originStationId,
          },
        });
      }
    }
  }
}

/** 兩班正線之間是否夾了非正線任務（整備／充電／行前／機動等） */
function hasNonPassengerBetween(
  blocks: GeneratedScheduleBlock[],
  earlier: GeneratedScheduleBlock,
  later: GeneratedScheduleBlock,
): boolean {
  const windowStart = earlier.plannedEndMinute;
  const windowEnd = later.plannedStartMinute;
  if (windowEnd <= windowStart + 1e-9) return false;
  return blocks.some(
    (block) =>
      block.taskType !== 'passenger'
      && block.plannedStartMinute < windowEnd - 1e-9
      && block.plannedEndMinute > windowStart + 1e-9,
  );
}

/** 逐站明細與班次卡共用同一秒級預算；不可讓末站出發超過 block end。 */
export function validateStationTimingsWithinBlocks(
  timelines: GeneratedSchedulePlan['timelines'],
  selectedRoutes: ShiftScheduleSelectedRoute[],
  errors: FeasibilityIssue[],
): void {
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger' || block.source !== 'template_bar') continue;
      const route = resolveRouteForBlock(block, selectedRoutes);
      const feasibility = resolveBlockStationDepartureFeasibility(block, route);
      if (!feasibility) continue;

      const stops = buildBlockStationDepartures(block, route);
      const blockStartSecond = minuteToSecond(block.plannedStartMinute);
      const blockEndSecond = minuteToSecond(block.plannedEndMinute);
      const lastDepartureSecond =
        stops.length > 0
          ? minuteToSecond(stops[stops.length - 1]!.departureMinute)
          : null;
      if (
        feasibility.feasible
        && stops.length > 0
        && lastDepartureSecond != null
        && lastDepartureSecond <= blockEndSecond
        && minuteToSecond(stops[0]!.arrivalMinute) >= blockStartSecond
      ) {
        continue;
      }

      pushIssue(errors, {
        code: 'STATION_TIMING_INFEASIBLE',
        severity: 'error',
        message:
          `時間線 ${timeline.row}：${block.routeCode ?? block.routeName ?? block.label}`
          + ' 的完整停靠／站間時間無法放入班次卡秒數',
        detail: {
          timelineRow: timeline.row,
          blockId: block.id,
          routeId: block.routeId,
          blockStartSecond,
          blockEndSecond,
          lastDepartureSecond,
          feasibility,
        },
      });
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
