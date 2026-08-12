import {
  resolveIntervalMinuteRanges,
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
  routesShareTurnaroundStation,
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
import { formatScheduleClockHms, blocksConflictOnDayCycle } from '../scheduleDayCycle';
import {
  collectStationBerthOccupancies,
  findStationBerthCollisions,
  type StationBerthOccupancy,
} from '../stationBerthOccupancy';
import {
  resolveGeneratedBlockTripCode,
  type MaintenanceSectionCodeBySection,
} from '../maintenanceSectionCode';
import {
  ROUTE_SUCCESSOR_ALGORITHM_GRAPH,
  listNextInstanceCandidates,
  resolveNextInstanceId,
  type RouteSuccessorPolicy,
} from './routeSuccessorPolicy';

export function resolveHeadwaySecondsAtMinute(
  minute: number,
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
): number | null {
  for (const interval of intervals) {
    // 時段可以跨午夜，那在鐘面上是兩段；問「這一分鐘屬於哪個時段」要兩段都問
    const ranges = resolveIntervalMinuteRanges(interval.startTime, interval.endTime);
    if (!ranges.some((range) => minute >= range.start && minute < range.end)) continue;
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
    // 過渡區塊只是空檔視覺，不參與重疊判定；0 秒的示意卡（例如整備間轉場
    // 同一區域時的 0 秒轉移）不佔用任何時間長度，物理上不可能跟誰「重疊」——
    // 它常常就落在下一段本來就佔用的那一刻，若不排除會被誤判成撞了下一段。
    const sorted = [...timeline.blocks]
      .filter((block) =>
        block.source !== 'transition'
        && block.plannedEndMinute - block.plannedStartMinute > 1e-9)
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i]!;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const next = sorted[j]!;
        // 線性相鄰才可能重疊；日循環上仍要比「午夜後 vs 清晨保養」
        const linearAdjacent =
          current.plannedEndMinute > next.plannedStartMinute + 1e-9;
        const dayCycleHit = blocksConflictOnDayCycle(
          current.plannedStartMinute,
          current.plannedEndMinute,
          next.plannedStartMinute,
          next.plannedEndMinute,
        );
        if (!linearAdjacent && !dayCycleHit) continue;

        // 調度可吃接下整備／行檢開頭（不可偷尾巴）；重疊不得超過調度本身時長
        if (isAllowedMaintenanceDispatchOverlap(current, next)) continue;
        // 進場載客可偷保養尾端：載客串起點不早於保養開始即允許重疊
        if (isAllowedEntryServiceOverlap(current, next)) continue;
        // 反向順序也可能：next 為整備、current 為午夜後正線等
        if (isAllowedMaintenanceDispatchOverlap(next, current)) continue;
        if (isAllowedEntryServiceOverlap(next, current)) continue;

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
  // 禁止整備／行檢 → 調度（偷尾巴）。只允許調度／空駛壓進「接下整備開頭」。
  const dispatchThenYard =
    earlier.source === 'dispatch' && isYardWindowForDispatchOverlap(later);
  if (!dispatchThenYard) return false;

  const yard = later;
  const dispatch = earlier;
  const dispatchDuration = dispatch.plannedEndMinute - dispatch.plannedStartMinute;
  if (dispatchDuration <= 0) return false;
  // 必須自整備起點當下或之前已發（吃開頭）；中途切入不算
  if (dispatch.plannedStartMinute > yard.plannedStartMinute + 1e-9) return false;

  const overlapStart = Math.max(yard.plannedStartMinute, dispatch.plannedStartMinute);
  const overlapEnd = Math.min(yard.plannedEndMinute, dispatch.plannedEndMinute);
  const overlap = overlapEnd - overlapStart;
  if (overlap <= 0) return true;
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
  return formatScheduleClockHms(minute);
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
      const deficitSeconds = headwayTarget - gapSeconds;
      const severityBand =
        deficitSeconds <= 30
          ? 'mild'
          : deficitSeconds > 180
            ? 'severe'
            : 'moderate';
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
          deficitSeconds,
          severityBand,
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
    // 跨午夜的時段在鐘面上是兩段；班次要兩段都撿，不然午夜之後那半段的班次
    // 會整批不受這條檢查管
    const ranges = resolveIntervalMinuteRanges(interval.startTime, interval.endTime);
    if (ranges.length === 0) continue;

    const attribute = attributes.find((item) => item.id === interval.attributeId);
    const headway = attribute?.headwaySeconds;
    if (headway == null || headway <= 0) continue;

    const blocksInInterval = passengerBlocks.filter((block) => {
      const minute = block.anchorStartMinute;
      return ranges.some((range) => minute >= range.start && minute < range.end);
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
  // 連續性解析須含備用（站位約束可能改派）；輪替／恢復空檔仍用主路線環
  const continuityByInstance = new Map<string, ShiftScheduleSelectedRoute>();
  for (const route of [...routeById.values(), ...routesForRecovery]) {
    continuityByInstance.set(resolveSelectedRouteInstanceId(route), route);
  }
  const routesForContinuity = [...continuityByInstance.values()];
  if (successorPolicy) {
    validateRouteSuccessorContinuity(
      timelines,
      routesForContinuity,
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

function isBackupOfExpectedInstance(
  nextRoute: ShiftScheduleSelectedRoute,
  expectedInstanceId: string,
  routes: ShiftScheduleSelectedRoute[],
): boolean {
  const byInstance = nextRoute.backupForInstanceId?.trim();
  if (byInstance && byInstance === expectedInstanceId) return true;
  const byRouteId = nextRoute.backupForRouteId?.trim();
  if (!byRouteId) return false;
  const expected = routes.find(
    (route) => resolveSelectedRouteInstanceId(route) === expectedInstanceId,
  );
  return Boolean(expected && byRouteId === expected.routeId);
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
      // 中間隔了充電／保養／行檢／待命等非正線時，交路由出場相位或進場載客重新對齊，
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
      const allowedNextIds = successorPolicy
        ? new Set(
            listNextInstanceCandidates(successorPolicy, currentInstanceId, {
              allowSecondary: true,
            }).map((item) => item.instanceId),
          )
        : new Set([
            orderedInstanceIds[
              (orderedInstanceIds.indexOf(currentInstanceId) + 1)
              % orderedInstanceIds.length
            ]!,
          ]);
      const preferredNextId = successorPolicy
        ? resolveNextInstanceId(successorPolicy, currentInstanceId, {
            allowSecondary: true,
          })?.instanceId
        : [...allowedNextIds][0];

      const successorMatchesExpected =
        allowedNextIds.has(nextInstanceId)
        || (
          Boolean(preferredNextId)
          && isBackupOfExpectedInstance(
            nextRoute,
            preferredNextId!,
            selectedRoutes,
          )
          && routesShareTurnaroundStation(currentRoute, nextRoute)
        );

      if (!successorMatchesExpected) {
        pushIssue(errors, {
          code: 'ROUTE_SUCCESSOR_MISMATCH',
          severity: 'error',
          message: `時間線 ${timeline.row}：${currentRoute.routeCode}（${currentInstanceId}）下一趟應為關聯圖合法出邊`
            + `（偏好 ${preferredNextId ?? '無'}），實際為 ${nextRoute.routeCode}（${nextInstanceId}）`,
          detail: {
            timelineRow: timeline.row,
            earlierBlockId: currentBlock.id,
            laterBlockId: nextBlock.id,
            fromInstanceId: currentInstanceId,
            expectedInstanceId: preferredNextId,
            allowedNextInstanceIds: [...allowedNextIds],
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

/** 兩班正線之間是否夾了非正線任務（整備／充電／行檢／待命等） */
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

const MAX_BERTH_COLLISION_REPORTS = 40;

/**
 * 硬約束：不同車不得同時佔用同一停靠點（到站～離站自然區間重疊）。
 */
export function validateStationBerthCollisions(
  timelines: GeneratedSchedulePlan['timelines'],
  selectedRoutes: ShiftScheduleSelectedRoute[],
  errors: FeasibilityIssue[],
  options?: {
    /**
     * 碰撞保護時間（秒）。不給就只檢查到離站區間重疊（舊行為）；
     * 給了才會另外檢查「後車到站 ≥ 前車實際離站 + 2 × 此值」。
     */
    collisionProtectionSeconds?: number;
    /** 碰撞保護不足只是警告，不擋生成；沒給就退回寫進 errors。 */
    warnings?: FeasibilityIssue[];
    /** 整備區塊代號，用來把班次代號（如 PTN1120）算出來寫進訊息 */
    sectionCodes?: MaintenanceSectionCodeBySection | null;
  },
): void {
  const collisionProtectionSeconds = options?.collisionProtectionSeconds;
  const occupancies = collectStationBerthOccupancies(
    timelines,
    selectedRoutes,
    collisionProtectionSeconds != null ? { collisionProtectionSeconds } : null,
  );
  const collisions = findStationBerthCollisions(occupancies, selectedRoutes);
  const protectionSink = options?.warnings ?? errors;

  // 用班次代號稱呼班次（畫面上看到的就是代號），不要只講路線代號＋時間線
  const blockById = new Map<string, GeneratedScheduleBlock>();
  for (const timeline of timelines) {
    for (const block of timeline.blocks) blockById.set(block.id, block);
  }
  const tripCodeOf = (occ: StationBerthOccupancy): string => {
    const block = blockById.get(occ.blockId);
    if (!block) return occ.routeCode ?? '正線';
    return resolveGeneratedBlockTripCode(block, 0, options?.sectionCodes ?? null);
  };
  /**
   * 訊息一律用<strong>班次卡的起訖</strong>，不要用站位佔用窗——
   * 佔用窗常常只有 10 秒，跟畫面上的班次卡對不起來（2026-08-08 使用者回報）。
   */
  const labelOf = (occ: StationBerthOccupancy): string =>
    `${tripCodeOf(occ)}（時間線 ${occ.timelineRow}）`
    + ` ${formatMinuteHms(occ.blockStartMinute)}–${formatMinuteHms(occ.blockEndMinute)}`;

  /**
   * 同一個停靠點最多同時停了幾台車（不同時間線才算）。
   * 佔用區間用「到站 → 真正開走」——真正開走含末站滯留，
   * 這才是車實際佔著站位的時間，不是只有靠站那幾十秒。
   */
  const peakConcurrentAtStation = (stationId: string): {
    peak: number;
    atMinute: number;
    longestIdle: StationBerthOccupancy | null;
    /** 尖峰那一刻實際佔著這個停靠點的班次（每列取一班） */
    atPeak: StationBerthOccupancy[];
  } => {
    const spans = occupancies.filter((occ) => occ.stationId === stationId);
    let longestIdle: StationBerthOccupancy | null = null;
    for (const occ of spans) {
      const idle = occ.actualDepartMinute - occ.startMinute;
      if (!longestIdle || idle > longestIdle.actualDepartMinute - longestIdle.startMinute) {
        longestIdle = occ;
      }
    }

    // 同一台車在同一站可能留下兩段占用：前一趟「到站」與下一趟「發車」，
    // 兩段在轉頭的那一刻首尾相接。直接掃描會在接點瞬間 +1 才 -1，
    // 把一台車算成兩台（實測 N2W 因此報成 4 台，實際只有 3 台）。
    // 車不會跟自己碰撞，先<strong>依時間線合併</strong>相接／重疊的占用再掃描。
    const byRow = new Map<number, Array<{ start: number; end: number }>>();
    for (const occ of spans) {
      const list = byRow.get(occ.timelineRow) ?? [];
      list.push({ start: occ.startMinute, end: occ.actualDepartMinute });
      byRow.set(occ.timelineRow, list);
    }

    const events: Array<{ minute: number; delta: number }> = [];
    for (const list of byRow.values()) {
      list.sort((a, b) => a.start - b.start || a.end - b.end);
      let merged: { start: number; end: number } | null = null;
      for (const span of list) {
        if (merged && span.start <= merged.end + 1e-9) {
          merged.end = Math.max(merged.end, span.end);
          continue;
        }
        if (merged) {
          events.push({ minute: merged.start, delta: 1 });
          events.push({ minute: merged.end, delta: -1 });
        }
        merged = { ...span };
      }
      if (merged) {
        events.push({ minute: merged.start, delta: 1 });
        events.push({ minute: merged.end, delta: -1 });
      }
    }
    events.sort((a, b) => a.minute - b.minute || b.delta - a.delta);
    let current = 0;
    let peak = 0;
    let atMinute = 0;
    for (const event of events) {
      current += event.delta;
      if (current > peak) {
        peak = current;
        atMinute = event.minute;
      }
    }
    /**
     * 尖峰那一刻<strong>到底是哪幾班</strong>。
     *
     * 只給「同時最多 2 台（07:03:20）」而不點名，使用者沒辦法去畫面上找是誰；
     * 而後面接著舉的「停最久的是 TN1146（11:50）」是<strong>另一件事</strong>，
     * 兩個時刻差了四個多小時，並排在同一句裡只會讓人以為自己看錯
     * （2026-08-12 使用者：「這個跟 16:00 的時間也差太多，我根本看不懂問題」）。
     *
     * 同一列可能留下兩段占用（到站、發車），所以每一列只取一班當代表。
     */
    const atPeak: StationBerthOccupancy[] = [];
    if (peak > 1) {
      const seenRows = new Set<number>();
      for (const occ of [...spans].sort((a, b) => a.startMinute - b.startMinute)) {
        if (occ.startMinute > atMinute + 1e-9) continue;
        if (occ.actualDepartMinute < atMinute - 1e-9) continue;
        if (seenRows.has(occ.timelineRow)) continue;
        seenRows.add(occ.timelineRow);
        atPeak.push(occ);
      }
    }
    return { peak, atMinute, longestIdle, atPeak };
  };

  const protectionByStation = new Map<string, {
    stationId: string;
    stationName: string;
    /**
     * 不重複的班次配對。
     *
     * 同一台車在同一站常常留下<strong>兩段</strong>佔用（前一趟到站、下一趟發車），
     * 兩兩配對會把「同一對班次」重複算好幾次——併發台數那邊早就做了同列合併
     * （不然一台車會被算成兩台），配對數這裡卻沒有，於是報出來的數字虛胖。
     * 改成以「班次卡對」為單位去重（2026-08-12 使用者：「為什麼他是寫 40 對？
     * 而實際上只有看到一對？」——顯示的是一則彙總，但那個 40 本身也灌水了）。
     */
    pairKeys: Set<string>;
    worst: (typeof collisions)[number];
  }>();

  let reported = 0;
  let protectionReported = 0;
  for (const hit of collisions) {
    const isProtectionGap = hit.kind === 'protection_gap';
    const sink = isProtectionGap ? protectionSink : errors;
    const count = isProtectionGap ? protectionReported : reported;
    if (count >= MAX_BERTH_COLLISION_REPORTS) {
      continue;
    }
    const earlierLabel = labelOf(hit.earlier);
    const laterLabel = labelOf(hit.later);
    const detail = {
      stationId: hit.stationId,
      stationName: hit.stationName,
      earlierBlockId: hit.earlier.blockId,
      laterBlockId: hit.later.blockId,
      earlierTripCode: tripCodeOf(hit.earlier),
      laterTripCode: tripCodeOf(hit.later),
      earlierTimelineRow: hit.earlier.timelineRow,
      laterTimelineRow: hit.later.timelineRow,
      /** 班次卡起訖（畫面上看到的） */
      earlierBlockRange: [hit.earlier.blockStartMinute, hit.earlier.blockEndMinute],
      laterBlockRange: [hit.later.blockStartMinute, hit.later.blockEndMinute],
      /** 該站位的佔用窗（通常只有幾秒，與班次卡起訖不同） */
      earlierBerthWindow: [hit.earlier.startMinute, hit.earlier.endMinute],
      laterBerthWindow: [hit.later.startMinute, hit.later.endMinute],
      earlierActualDepartMinute: hit.earlier.actualDepartMinute,
      earlierBerthClearMinute: hit.earlier.berthClearMinute,
      earlierEarliestNextArrivalMinute: hit.earlier.protectedUntilMinute,
      overlapSeconds: hit.overlapSeconds,
      clearanceGapSeconds: hit.clearanceGapSeconds,
      requiredClearanceSeconds: hit.requiredClearanceSeconds,
      protectionShortfallSeconds: hit.protectionShortfallSeconds,
      blockId: hit.later.blockId,
    };
    if (isProtectionGap) {
      // 碰撞保護不足往往是<strong>同一個結構性問題</strong>被拆成幾百對班次
      // （例：一個停靠點同時停了 4 台車，就會兩兩配對出一大堆）。
      // 逐對列出只是噪音，先累積起來，迴圈結束後每個站位彙總成一則。
      const bucket = protectionByStation.get(hit.stationId) ?? {
        stationId: hit.stationId,
        stationName: hit.stationName,
        pairKeys: new Set<string>(),
        worst: hit,
      };
      bucket.pairKeys.add(
        [hit.earlier.blockId, hit.later.blockId].sort().join('|'),
      );
      if (hit.protectionShortfallSeconds > bucket.worst.protectionShortfallSeconds) {
        bucket.worst = hit;
      }
      protectionByStation.set(hit.stationId, bucket);
      protectionReported += 1;
      continue;
    }
    pushIssue(sink, {
      code: 'STATION_BERTH_COLLISION',
      severity: 'error',
      kind: 'limit',
      message:
        `${hit.stationName} 站位碰撞：${earlierLabel} 與 ${laterLabel}`
        + ` 同時佔用同一個停靠點，重疊 ${Math.round(hit.overlapSeconds)} 秒`,
      detail,
    });
    reported += 1;
  }

  for (const bucket of protectionByStation.values()) {
    const { peak, atMinute, longestIdle, atPeak } = peakConcurrentAtStation(bucket.stationId);
    const peakLabel = atPeak
      .map((occ) =>
        `${tripCodeOf(occ)}（時間線 ${occ.timelineRow}，`
        + `${formatMinuteHms(occ.startMinute)}–${formatMinuteHms(occ.actualDepartMinute)}）`)
      .join('、');
    const idleMinutes = longestIdle
      ? (longestIdle.actualDepartMinute - longestIdle.startMinute)
      : 0;
    const longestLabel = longestIdle
      ? `${tripCodeOf(longestIdle)}（時間線 ${longestIdle.timelineRow}）`
        + ` ${formatMinuteHms(longestIdle.startMinute)} 到站、`
        + `${formatMinuteHms(longestIdle.actualDepartMinute)} 才開走，`
        + `停了 ${idleMinutes.toFixed(1)} 分鐘`
      : '';
    pushIssue(protectionSink, {
      code: 'STATION_BERTH_PROTECTION_GAP',
      severity: 'warning',
      kind: 'actionable',
      message:
        // 這一則掛在「違規最嚴重的那一對」的卡片上，訊息卻只講尖峰與停最久的
        // ——兩者常常都不是這張卡本人，使用者點開會覺得整段跟自己無關
        // （2026-08-12：點 TN1342 卻只看到 08:51 與 16:35 的事）。先講這張卡自己的那一對。
        `這一班：${tripCodeOf(bucket.worst.later)} 到「${bucket.stationName}」時，`
        + `前一班 ${tripCodeOf(bucket.worst.earlier)} 還沒清乾淨`
        + `（要等到 ${formatMinuteHms(bucket.worst.earlier.protectedUntilMinute)}，`
        + `差 ${Math.round(bucket.worst.protectionShortfallSeconds)} 秒）。`
        + `\n這一站整體：${formatMinuteHms(atMinute)} 同時有 ${peak} 台車停在這裡`
        + `${peakLabel ? `——${peakLabel}` : ''}，但一個停靠點只能停 1 台；`
        + `整天在這一站共有 ${bucket.pairKeys.size} 對班次不滿足碰撞保護`
        + `（同一站的都收在這一則裡，不逐對列出）`
        + (longestLabel ? `；其中停最久的是另一班 ${longestLabel}` : ''),
      detail: {
        stationId: bucket.stationId,
        stationName: bucket.stationName,
        peakConcurrentVehicles: peak,
        peakAtMinute: atMinute,
        affectedPairCount: bucket.pairKeys.size,
        longestIdleBlockId: longestIdle?.blockId ?? null,
        longestIdleMinutes: idleMinutes,
        blockId: bucket.worst.later.blockId,
        earlierBlockId: bucket.worst.earlier.blockId,
        laterBlockId: bucket.worst.later.blockId,
        worstShortfallSeconds: bucket.worst.protectionShortfallSeconds,
      },
    });
  }

  const overlapTotal = collisions.filter((hit) => hit.kind === 'overlap').length;
  if (overlapTotal > reported) {
    pushIssue(errors, {
      code: 'STATION_BERTH_COLLISION',
      severity: 'error',
      kind: 'limit',
      message:
        `另有 ${overlapTotal - reported} 處停靠點站位碰撞未逐條列出（共 ${overlapTotal} 處）`,
      detail: { totalCollisions: overlapTotal, reported },
    });
  }
  // 碰撞保護不足已改成「每個站位一則彙總」，不再逐對列出，所以沒有「另有 N 則」的概念。
}

/**
 * 硬約束：每條時間線在每一個整備段內的正線趟數須為路線群組大小的整數倍
 * 整備做完之後，車就停在<strong>該設施的出場站</strong>。所以整備結束後的第一段班次，
 * 起點站一定要是那一站——不是的話，那台車根本不在起點，這班開不了。
 *
 * 2026-08-08 加入。實際踩到的案例：行檢設施在 M、出來接 T3上行，
 * 引擎卻排出一段 <code>PNT</code>（行檢後跑 NT，起點 N2W）。成因是插入調度營運班次時，
 * 查不到出場站就退回「全部首班起點站」，等於認為車可以從任何一站冒出來。
 * 那個退路已移除，這道驗證則是<strong>最後一關</strong>：不管是哪條路徑排出來的，
 * 只要起點站接不上出場站就擋下來，不要再讓物理上做不到的班表流到使用者手上。
 */
export function validateYardExitContinuity(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  /**
   * 整備類型 → 車<strong>可能</strong>停在哪幾站。
   * 保養涵蓋保養設施（M 系→T3上行）與洗車（W1→N2W），光看班次卡分不出是哪一種，
   * 所以要接受全部可能；只拿偏好的那一站比對會把合法班次誤判成錯誤（2026-08-08）。
   */
  yardExitStationOptionsByTaskType: Partial<Record<string, string[]>>;
  sectionCodes?: MaintenanceSectionCodeBySection | null;
  errors: FeasibilityIssue[];
}): void {
  const { timelines, selectedRoutes, yardExitStationOptionsByTaskType, errors } = args;

  // stationId 對使用者沒有意義（畫面上看到的是站名），訊息一律用站名
  const stationNameById = new Map<string, string>();
  for (const route of selectedRoutes) {
    for (const dwell of route.stationDwells ?? []) {
      const name = dwell.stationName?.trim();
      if (name && !stationNameById.has(dwell.stationId)) {
        stationNameById.set(dwell.stationId, name);
      }
    }
  }
  const stationLabel = (stationId: string): string =>
    stationNameById.get(stationId) ?? stationId;

  const isYardBlock = (block: GeneratedScheduleBlock): boolean =>
    block.source === 'template_bar'
    && (block.taskType === 'charging'
      || block.taskType === 'servicing'
      || block.taskType === 'inspection'
      || block.taskType === 'standby');

  for (const timeline of timelines) {
    const ordered = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute
        || a.id.localeCompare(b.id),
    );

    for (let i = 0; i < ordered.length; i += 1) {
      const yard = ordered[i]!;
      if (!isYardBlock(yard)) continue;
      const exitOptions = yardExitStationOptionsByTaskType[yard.taskType] ?? [];
      if (exitOptions.length === 0) continue;

      // 連續整備串（保養→行檢）只看串尾那一段的出場站
      let next: GeneratedScheduleBlock | null = null;
      for (let j = i + 1; j < ordered.length; j += 1) {
        const candidate = ordered[j]!;
        if (candidate.taskType === 'idle' || candidate.source === 'transition') continue;
        if (isYardBlock(candidate)) { next = null; break; }
        if (candidate.taskType === 'passenger') { next = candidate; }
        break;
      }
      if (!next) continue;

      const route = resolveRouteForBlock(next, selectedRoutes);
      const originStationId = route?.stationIds[0]?.trim() || null;
      // 只要起點站是「任何一個可能的出場站」就合法
      if (!originStationId || exitOptions.includes(originStationId)) continue;
      const exitStationId = exitOptions[0]!;

      // 站名比 stationId 好認；來源決定是哪一條程式路徑排出來的，查錯時最關鍵
      const sourceLabel =
        next.source === 'entry_service'
          ? '整備後的調度營運班次'
          : next.source === 'relief_loop'
            ? '站位讓渡班次'
            : '一般正線（整備後第一班）';
      pushIssue(errors, {
        code: 'YARD_EXIT_STATION_MISMATCH',
        severity: 'error',
        kind: 'actionable',
        message:
          `時間線 ${timeline.row}：「${yard.label}」做完後車停在`
          + `「${exitOptions.map(stationLabel).join('」或「')}」，`
          + `但接著排的 ${resolveGeneratedBlockTripCode(next, i, args.sectionCodes ?? null)}`
          + `（${sourceLabel}）是從「${stationLabel(originStationId)}」發車，`
          + '車不在那裡開不了',
        detail: {
          timelineRow: timeline.row,
          yardBlockId: yard.id,
          yardTaskType: yard.taskType,
          blockId: next.id,
          blockSource: next.source,
          exitStationId,
          exitStationOptions: exitOptions,
          exitStationName: exitOptions.map(stationLabel).join(' / '),
          originStationId,
          originStationName: stationLabel(originStationId),
          routeId: next.routeId,
          routeCode: next.routeCode,
        },
      });
    }
  }
}

/**
 * 硬約束：每條時間線在每一個整備段內的正線趟數須為路線群組大小的整數倍
 * （跑完一整輪才能進充電／收班；全天總數整除不算過關）。
 */
export function validateRotationCyclesComplete(
  timelines: GeneratedSchedulePlan['timelines'],
  routeCount: number,
  errors: FeasibilityIssue[],
): void {
  if (routeCount <= 1) return;

  const isYard = (block: GeneratedScheduleBlock): boolean => {
    if (block.source !== 'template_bar') return false;
    return (
      block.taskType === 'charging'
      || block.taskType === 'servicing'
      || block.taskType === 'inspection'
      || block.taskType === 'standby'
    );
  };

  for (const timeline of timelines) {
    const ordered = [...timeline.blocks].sort(
      (a, b) =>
        a.plannedStartMinute - b.plannedStartMinute
        || a.id.localeCompare(b.id),
    );

    let stretch: GeneratedScheduleBlock[] = [];
    const flush = () => {
      if (stretch.length === 0) return;
      if (stretch.length % routeCount === 0) {
        stretch = [];
        return;
      }
      const last = stretch[stretch.length - 1]!;
      const lastLabel = last.routeCode ?? last.routeName ?? last.label;
      pushIssue(errors, {
        code: 'ROTATION_CYCLE_INCOMPLETE',
        severity: 'error',
        message:
          `時間線 ${timeline.row} 整備前未跑完路線群組來回`
          + `（本段正線 ${stretch.length} 趟，須為 ${routeCount} 的整數倍）。`
          + `最後一趟：${lastLabel}`,
        detail: {
          timelineRow: timeline.row,
          passengerTripCount: stretch.length,
          routeCount,
          blockId: last.id,
          lastRouteId: last.routeId,
          lastRouteName: last.routeName,
        },
      });
      stretch = [];
    };

    for (const block of ordered) {
      if (isYard(block)) {
        flush();
        continue;
      }
      if (block.source === 'template_bar' && block.taskType === 'passenger') {
        stretch.push(block);
      }
    }
    flush();
  }
}
