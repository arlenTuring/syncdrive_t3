import {
  resolveIntervalMinuteRanges,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import type { PointTopology } from '../../../map-editor/types/pointTopology';
import {
  collectMoveJunctionPasses,
  findJunctionConflictsForBlocks,
} from '../moveJunctionPasses';
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
import { nonZeroYardWorkSeconds } from '../yardWorkMinimum';
import {
  collectStationBerthOccupancies,
  findStationBerthCollisions,
  collectFacilityOccupancies,
  findFacilityOccupancyCollisions,
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

/**
 * 一對相鄰同方向發車該守住的班距目標——驗證、班距補疏、班距修復共用這一支。
 *
 * 優先用<strong>後車自己交路起班當下</strong>記下來的 <code>cycleHeadwayTargetSeconds</code>：
 * 已在尖峰起班的交路，某一腿被挪過時段邊界，門檻仍是起班當時的班距。三處各自查
 * 時段的話，補疏用舊的跨時段較嚴者、修復用交路目標，兩道會互相抵銷。兩班都沒有
 * 交路來源資料（手動製作／舊產物）才退回用當下時刻各自查時段、取較嚴者。
 */
export function resolvePairHeadwayTarget(
  earlier: { plannedStartMinute: number },
  later: { plannedStartMinute: number; cycleHeadwayTargetSeconds?: number },
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
): number | null {
  if (later.cycleHeadwayTargetSeconds != null) return later.cycleHeadwayTargetSeconds;
  return resolvePairHeadwaySeconds(
    earlier.plannedStartMinute,
    later.plannedStartMinute,
    intervals,
    attributes,
  );
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
    {
      startSecond: number;
      routeId?: string;
      blockId: string;
      cycleChainId?: string;
      cycleOriginIntervalId?: string;
      cycleHeadwayTargetSeconds?: number;
    }[]
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
      cycleChainId: block.cycleChainId,
      cycleOriginIntervalId: block.cycleOriginIntervalId,
      cycleHeadwayTargetSeconds: block.cycleHeadwayTargetSeconds,
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
  departures: {
    startSecond: number;
    routeId?: string;
    blockId: string;
    cycleChainId?: string;
    cycleOriginIntervalId?: string;
    cycleHeadwayTargetSeconds?: number;
  }[],
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

    /**
     * 班距目標優先用「後車自己交路起班當下」記下來的值（見 ScheduleTask／
     * GeneratedScheduleBlock 的 cycleHeadwayTargetSeconds 說明）——那才是這一對
     * 發車在生成當下真正被要求要守住的門檻：已在尖峰起班的交路，後續某一腿的時刻
     * 就算被站位讓渡挪到跨過時段邊界，門檻仍是起班當時的尖峰班距，不必因為挪動
     * 就改用離峰的較嚴門檻；新開交路本來就是照它起班當下的時段記下來，不需要另外
     * 判斷「新舊」。兩班都拿不到這個欄位（手動製作／舊產物）才退回用當下時刻各自
     * 查時段、取較嚴者的舊算法。
     */
    const originAware = next.cycleHeadwayTargetSeconds != null;
    const headwayTarget = resolvePairHeadwayTarget(
      { plannedStartMinute: secondToMinute(current.startSecond) },
      {
        plannedStartMinute: secondToMinute(next.startSecond),
        cycleHeadwayTargetSeconds: next.cycleHeadwayTargetSeconds,
      },
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
      /**
       * 依交路來源分類，不是全部套同一句策略說明：
       * - sameChain：同一台車自己交路裡的兩腿（理論上罕見，多半是迴圈路線）。
       * - crossChainSameInterval：兩台不同車，但都在同一個時段起班——真的是這個
       *   時段本身排太擠，不是跨時段邊界造成的。
       * - crossChainAcrossInterval：兩台不同車，交路分別起班於不同時段——用的是
       *   後車自己起班當下的門檻，不是「取兩邊較嚴」；這對真的低於門檻，不是邊界
       *   假象。
       * - legacy：至少一邊沒有交路來源資料（手動製作／舊產物），退回舊的「跨時段
       *   取較嚴者」描述。
       */
      const originClassification: 'sameChain' | 'crossChainSameInterval' | 'crossChainAcrossInterval' | 'legacy' =
        !originAware
          ? 'legacy'
          : current.cycleChainId != null && current.cycleChainId === next.cycleChainId
            ? 'sameChain'
            : current.cycleOriginIntervalId != null
                && current.cycleOriginIntervalId === next.cycleOriginIntervalId
              ? 'crossChainSameInterval'
              : 'crossChainAcrossInterval';
      const message = (() => {
        switch (originClassification) {
          case 'sameChain':
            return `${routeLabel} 相鄰發車 ${earlierLabel}→${laterLabel} 間隔 ${gapSeconds} 秒，`
              + `是同一交路自己的兩腿，仍低於班距目標 ${headwayTarget} 秒`;
          case 'crossChainSameInterval':
            return `${routeLabel} 相鄰發車 ${earlierLabel}→${laterLabel} 間隔 ${gapSeconds} 秒，`
              + `兩班交路都在同一時段起班，低於該時段班距目標 ${headwayTarget} 秒——`
              + `時段本身排太擠，不是跨時段邊界造成的`;
          case 'crossChainAcrossInterval':
            return `${routeLabel} 相鄰發車 ${earlierLabel}→${laterLabel} 間隔 ${gapSeconds} 秒，`
              + `低於後車交路起班當下的班距目標 ${headwayTarget} 秒（起班時段 `
              + `${next.cycleOriginIntervalId ?? '未知'}）——不是邊界誤判，後車自己`
              + `起班當下就該守住這個門檻`;
          case 'legacy':
          default:
            return straddlesInterval
              ? `${routeLabel} 相鄰發車 ${earlierLabel}→${laterLabel} 間隔 ${gapSeconds} 秒，低於跨時段班距下限 ${headwayTarget} 秒（兩時段 ${earlierHw}/${laterHw}，取較嚴者；沒有交路來源資料，無法判斷是否為邊界假象）`
              : `${routeLabel} 相鄰發車 ${earlierLabel}→${laterLabel} 間隔 ${gapSeconds} 秒，低於時段班距 ${headwayTarget} 秒（多半來自補完／延後／多車擠班）`;
        }
      })();
      pushIssue(warnings, {
        code: 'HEADWAY_BELOW_TARGET',
        severity: 'warning',
        kind: 'limit',
        message,
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
          originClassification,
          earlierCycleOriginIntervalId: current.cycleOriginIntervalId ?? null,
          laterCycleOriginIntervalId: next.cycleOriginIntervalId ?? null,
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
        + ` 同時佔用同一個停靠點——前者 ${formatMinuteHms(hit.earlier.startMinute)} 到站、`
        + `${formatMinuteHms(hit.earlier.actualDepartMinute)} 才開走，`
        + `後者 ${formatMinuteHms(hit.later.startMinute)} 就進站，`
        + `重疊 ${Math.round(hit.overlapSeconds)} 秒`,
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
      /**
       * 車<strong>實際</strong>停在哪，優先於「這種整備理論上可能停哪」。
       *
       * <code>exitOptions</code> 是依整備類型與設施分類推導出來的<strong>可能</strong>
       * 出場站清單。但實際停放位置是整備轉場機制逐台決定的，且沒有設施格可用時會
       * 退到正線停靠站——那一站本來就不在推導清單裡。
       *
       * 2026-08-18 實測：待命實際停在「[備用]N2W下行出發」，下一班也正是從那裡發車，
       * 物理上完全一致，卻因為驗證器拿推導清單比對而報成
       * YARD_EXIT_STATION_MISMATCH 硬錯誤。有實際停放站時就以它為準。
       */
      const parkedStationId = yard.yardFacilityStationId?.trim() || null;
      const allowedOrigins = parkedStationId ? [parkedStationId] : exitOptions;
      // 只要起點站是「車真的能開得出去的站」就合法
      if (!originStationId || allowedOrigins.includes(originStationId)) continue;
      const exitStationId = allowedOrigins[0]!;

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
          + `「${allowedOrigins.map(stationLabel).join('」或「')}」，`
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

/**
 * 模板上的整備不能消失，也不能被壓到低於最低工作時間（白皮書 YARD-03）。
 *
 * 讓渡、移動、推移都可以<strong>縮短</strong>整備（有額度、有報告），但不能靠刪卡或壓成零
 * 排出表面沒衝突的班表。這支拿模板原始的整備（開始用 templateStartMinute，結束鎖住）對照
 * 排好的班表：
 * - 找不到對應的區塊（id 相同，或跨午夜切開的 id 前綴）→ 被刪了。
 * - 剩下的總長低於「最低工作時間」與「模板原長」兩者較小的那一個 → 被壓過頭。
 *
 * 最低工作時間：有設定作業時長就用它，沒有的至少一個刻度（yardWorkMinimum.ts）。模板本身就比
 * 設定的作業時長短時，只要求不比模板更短——那是模板與設定不一致，不是排班壓出來的。
 */
export function validateYardWorkPreserved(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  yardTasks: ReadonlyArray<{
    id: string;
    rowIndex: number;
    taskType: string;
    label: string;
    startMinute: number;
    durationMinutes: number;
    templateStartMinute?: number;
  }>;
  maintenanceBody: Record<string, unknown> | null | undefined;
  errors: FeasibilityIssue[];
}): void {
  const blocksById = new Map<string, GeneratedScheduleBlock[]>();
  for (const timeline of args.timelines) {
    for (const block of timeline.blocks) {
      if (!YARD_WORK_CHECK_TYPES.has(block.taskType)) continue;
      const list = blocksById.get(block.id) ?? [];
      list.push(block);
      blocksById.set(block.id, list);
    }
  }
  const findBlocks = (taskId: string): GeneratedScheduleBlock[] => {
    const out = [...(blocksById.get(taskId) ?? [])];
    for (const [id, list] of blocksById) {
      if (id !== taskId && id.startsWith(`${taskId}-`)) out.push(...list);
    }
    return out;
  };
  for (const task of args.yardTasks) {
    if (!YARD_WORK_CHECK_TYPES.has(task.taskType)) continue;
    const endMinute = task.startMinute + task.durationMinutes;
    const templateStart = task.templateStartMinute ?? task.startMinute;
    const templateSeconds = Math.round((endMinute - templateStart) * 60);
    if (templateSeconds <= 0) continue;
    void args.maintenanceBody;
    // 硬下限只有「不能歸零」：移動可以把作業壓到低於設定作業時長（使用者 2026-09-30），那部分逐筆揭露、不擋發布
    const required = Math.min(templateSeconds, nonZeroYardWorkSeconds());
    const blocks = findBlocks(task.id);
    const where = `時間線 ${task.rowIndex}「${task.label}」（模板 ${formatScheduleClockHms(templateStart)} 起 ${Math.round(templateSeconds / 60)} 分鐘）`;
    if (blocks.length === 0) {
      pushIssue(args.errors, {
        code: 'MAINTENANCE_WORK_INSUFFICIENT',
        severity: 'error',
        kind: 'limit',
        message: `${where}在排好的班表裡不見了：整備不能被刪除`,
        detail: { timelineRow: task.rowIndex, blockId: task.id, taskType: task.taskType, remainingWorkSeconds: 0, requiredWorkSeconds: required },
      });
      continue;
    }
    const remaining = Math.round(
      blocks.reduce((sum, block) => sum + Math.max(0, block.plannedEndMinute - block.plannedStartMinute), 0) * 60,
    );
    if (remaining + 1e-6 < required) {
      pushIssue(args.errors, {
        code: 'MAINTENANCE_WORK_INSUFFICIENT',
        severity: 'error',
        kind: 'limit',
        message: `${where}只剩 ${remaining} 秒工作時間，低於最低要求 ${required} 秒`,
        detail: { timelineRow: task.rowIndex, blockId: blocks[0]!.id, taskType: task.taskType, remainingWorkSeconds: remaining, requiredWorkSeconds: required },
      });
    }
  }
}

const YARD_WORK_CHECK_TYPES: ReadonlySet<string> = new Set(['charging', 'servicing', 'inspection', 'washing', 'standby']);

/** 車真的停在裡面的那幾種整備；暫停卡（source 'hold'）同樣代表車還在格子裡 */
/**
 * 設施格佔用驗證：同一格同一時刻只能有一台車。
 *
 * <strong>為什麼這支是後來才有的。</strong>設施佔用先前只記
 * <code>[整備開始, 整備結束]</code>，「整備做完、還沒開走」那段帳上是空的，於是
 * 兩台車同格根本量不出來——2026-08-24 補上{@link 暫停卡 source 'hold'}之後才現形：
 * 同一份班表，補卡前量到 0 次重疊，補卡後 9 次。使用者：「當你的機制有辦法補滿
 * 所有的時間空隙的時候，就能真正的去看待任何的碰撞跟移動。」
 *
 * <strong>重疊記硬錯誤，交接不足記警告。</strong>兩台車同時在一格是物理上做不到
 * 的事，不是偏好問題；而「交接該隔多久」是營運規則，使用者定為
 * <code>2 × 碰撞保護</code>——與站位同一套（後車到站 ≥ 前車實際離站 ＋ 兩倍保護），
 * 留給兩台車移動的差異緩衝。
 *
 * <strong>佔用定義搬到 {@link collectFacilityOccupancies}。</strong>這支原本自己收
 * 「stays」清單，只認 <code>source==='hold'</code> 或整備任務類型的原始
 * <code>[start,end]</code>，等於<strong>依賴</strong>「暫停」卡已經插好才量得到正確
 * 佔用——求解階段（見 closeYardHeadGaps）跑在補卡之前，用的是另一套（沒延伸的）
 * 定義，兩邊會看到不一樣的答案。現在兩邊都呼叫
 * {@link collectFacilityOccupancies}：沒補卡時用空檔推論分析出實際離開時刻，
 * 補了卡就直接採用卡上的時刻——答案一致，「暫停」卡因此只負責<strong>呈現</strong>，
 * 不是佔用判定唯一的資料來源。比對也一併換成
 * {@link findFacilityOccupancyCollisions} 的跨午夜安全比對（見
 * {@link daySegmentOverlapSeconds} 的說明），不再直接比較 start／end 的分鐘數字。
 */
export function validateFacilityOccupancy(
  timelines: GeneratedSchedulePlan['timelines'],
  errors: FeasibilityIssue[],
  options: { collisionProtectionSeconds?: number; warnings?: FeasibilityIssue[] } = {},
): void {
  const protectionSeconds = Math.max(0, options.collisionProtectionSeconds ?? 0);
  const occupancies = collectFacilityOccupancies(timelines);
  const collisions = findFacilityOccupancyCollisions(occupancies, protectionSeconds);

  for (const collision of collisions) {
    const { earlier, later } = collision;
    const detail = {
      facilityNodeId: collision.facilityNodeId,
      facilityLabel: collision.facilityLabel,
      earlierTimelineRow: earlier.timelineRow,
      laterTimelineRow: later.timelineRow,
      blockId: later.blockId,
      earlierBlockId: earlier.blockId,
      overlapSeconds: Math.round(Math.max(0, collision.overlapSeconds)),
      // 沿用既有欄位語意：重疊時為負，交接空檔時為正（collision.gapSeconds 已是這個正負號）
      gapSeconds: Math.round(collision.gapSeconds),
      shortfallSeconds: Math.max(0, protectionSeconds * 2 - collision.gapSeconds),
    };

    if (collision.kind === 'overlap') {
      pushIssue(errors, {
        code: 'FACILITY_SLOT_COLLISION',
        severity: 'error',
        kind: 'limit',
        message:
          `設施格「${collision.facilityLabel}」同時被兩台車佔用：`
          + `時間線 ${earlier.timelineRow} 待到 ${formatMinuteHms(earlier.actualDepartMinute)}，`
          + `時間線 ${later.timelineRow} 卻在 ${formatMinuteHms(later.startMinute)} 就進來，`
          + `重疊 ${Math.round(collision.overlapSeconds)} 秒`,
        detail,
      });
    } else if (options.warnings) {
      pushIssue(options.warnings, {
        code: 'FACILITY_HANDOVER_GAP',
        severity: 'warning',
        kind: 'limit',
        message:
          `設施格「${collision.facilityLabel}」交接太緊：`
          + `時間線 ${earlier.timelineRow} ${formatMinuteHms(earlier.actualDepartMinute)} 離開、`
          + `時間線 ${later.timelineRow} ${formatMinuteHms(later.startMinute)} 進來，`
          + `只隔 ${Math.round(collision.gapSeconds)} 秒`
          + `（需要 ${Math.round(protectionSeconds * 2)} 秒）`,
        detail,
      });
    }
  }
}

type VehiclePlace = { kind: 'station' | 'facility'; id: string; label: string };

function isMoveCard(block: GeneratedScheduleBlock): boolean {
  return (
    block.taskType === 'dispatch'
    || block.source === 'yard_exit_move'
    || block.source === 'yard_entry_move'
  );
}

/**
 * 這張卡開始／結束時車在哪。移動卡回傳 'move'；查不出來回傳 null（不參與判定——
 * 寧可不判，也不要拿猜的地點去報錯）。
 */
function resolveVehiclePlaces(
  block: GeneratedScheduleBlock,
  selectedRoutes: ShiftScheduleSelectedRoute[],
): { start: VehiclePlace; end: VehiclePlace } | 'move' | null {
  if (isMoveCard(block)) return 'move';
  if (block.taskType === 'passenger') {
    const route = resolveRouteForBlock(block, selectedRoutes);
    if (!route) return null;
    const stops = buildBlockStationDepartures(block, route);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first?.stationId || !last?.stationId) return null;
    return {
      start: { kind: 'station', id: first.stationId, label: first.stationName || first.stationId },
      end: { kind: 'station', id: last.stationId, label: last.stationName || last.stationId },
    };
  }
  const stationId = block.yardFacilityStationId?.trim();
  if (stationId) {
    const place: VehiclePlace = { kind: 'station', id: stationId, label: block.yardFacilityLabel ?? stationId };
    return { start: place, end: place };
  }
  const nodeId = block.yardFacilityNodeId?.trim();
  if (nodeId) {
    const place: VehiclePlace = { kind: 'facility', id: nodeId, label: block.yardFacilityLabel ?? nodeId };
    return { start: place, end: place };
  }
  return null;
}

/**
 * 車的位置在時間軸上要接得起來。
 *
 * 同一列依時間排序（日循環：最後一張接回第一張），任兩張相鄰、地點已知的卡之間：
 * 前一張結束時車在 A、後一張開始時要在 B，A ≠ B 就一定要有移動卡。只判定牽涉
 * 設施格的銜接（設施↔正線、設施↔另一格）；正線站與站之間的接續由路線連續性驗證
 * 負責。
 *
 * 只看班表本身，不看產生過程——手改過的班表在發布前重驗證也抓得到。
 * <code>explainedBlockIds</code>：生成時已經用 MAINTENANCE_TRANSFER_REQUIRED_MISSING
 * 講過原因的整備卡，這裡不重複報同一件事。
 */
export function validateVehicleLocationContinuity(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  errors: FeasibilityIssue[];
  explainedBlockIds?: ReadonlySet<string>;
}): void {
  const { timelines, selectedRoutes, errors, explainedBlockIds } = args;
  for (const timeline of timelines) {
    const ordered = [...timeline.blocks].sort(
      (a, b) =>
        a.plannedStartMinute - b.plannedStartMinute
        || (a.plannedEndMinute - a.plannedStartMinute) - (b.plannedEndMinute - b.plannedStartMinute)
        || a.id.localeCompare(b.id),
    );
    type Entry = { block: GeneratedScheduleBlock; places: ReturnType<typeof resolveVehiclePlaces> };
    const entries: Entry[] = ordered.map((block) => ({
      block,
      places: resolveVehiclePlaces(block, selectedRoutes),
    }));
    const located = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.places !== null && entry.places !== 'move');
    if (located.length < 2) continue;

    for (let k = 0; k < located.length; k += 1) {
      const from = located[k]!;
      const to = located[(k + 1) % located.length]!;
      const wraps = k === located.length - 1;
      // 中間任一張卡地點未知，就不判定這一對
      const between = wraps
        ? [...entries.slice(from.index + 1), ...entries.slice(0, to.index)]
        : entries.slice(from.index + 1, to.index);
      if (between.some((entry) => entry.places === null)) continue;
      const hasMove = between.some((entry) => entry.places === 'move');
      if (hasMove) continue;

      const fromPlace = (from.entry.places as { end: VehiclePlace }).end;
      const toPlace = (to.entry.places as { start: VehiclePlace }).start;
      if (fromPlace.kind === toPlace.kind && fromPlace.id === toPlace.id) continue;
      if (fromPlace.kind !== 'facility' && toPlace.kind !== 'facility') continue;
      // 生成時已講過原因的整備卡，可能被暫停卡隔開——同一段同地點停留都算同一件事
      if (explainedBlockIds) {
        const samePlaceRun = (startK: number, step: 1 | -1, side: 'start' | 'end'): string[] => {
          const ids: string[] = [];
          const anchor = located[startK]!;
          const anchorPlace = (anchor.entry.places as Record<'start' | 'end', VehiclePlace>)[side];
          for (let m = 0; m < located.length; m += 1) {
            const item = located[(startK + step * m + located.length * 2) % located.length]!;
            const places = item.entry.places as { start: VehiclePlace; end: VehiclePlace };
            const place = step < 0 ? places.end : places.start;
            if (place.kind !== anchorPlace.kind || place.id !== anchorPlace.id) break;
            ids.push(item.entry.block.id);
          }
          return ids;
        };
        const involved = [
          ...samePlaceRun(k, -1, 'end'),
          ...samePlaceRun((k + 1) % located.length, 1, 'start'),
        ];
        if (involved.some((id) => explainedBlockIds.has(id))) continue;
      }

      const fromBlock = from.entry.block;
      const toBlock = to.entry.block;
      pushIssue(errors, {
        code: 'VEHICLE_LOCATION_DISCONTINUITY',
        severity: 'error',
        kind: 'limit',
        message:
          `時間線 ${timeline.row}：「${fromBlock.label}」${formatMinuteHms(fromBlock.plannedEndMinute)} 結束時車在`
          + `「${fromPlace.label}」，接著「${toBlock.label}」${formatMinuteHms(toBlock.plannedStartMinute)}`
          + ` 要在「${toPlace.label}」，中間沒有任何移動卡——車到不了`,
        detail: {
          timelineRow: timeline.row,
          blockId: toBlock.id,
          fromBlockId: fromBlock.id,
          fromPlaceKind: fromPlace.kind,
          fromPlaceId: fromPlace.id,
          toPlaceKind: toPlace.kind,
          toPlaceId: toPlace.id,
        },
      });
    }
  }
}

/**
 * 移動卡在同一個轉折點貼太近（警告、擋發布）。
 *
 * 排卡時 insertMaintenanceTransferCards 會錯開轉折點，但讓站、提早進廠等策略
 * 事後插的移動卡不經過那一關——2026-09-26 實測基準班表有 2 筆兩台車 40 秒內
 * 經過同一個入口點，沒有任何驗證抓得到。這裡從班表本身重建每張移動卡的經過
 * 時刻（見 collectMoveJunctionPasses），任何來源的移動卡都一起檢查。
 */
export function validateMoveJunctionConflicts(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  topology: PointTopology | null | undefined;
  collisionProtectionSeconds: number;
  warnings: FeasibilityIssue[];
}): void {
  const bufferSeconds = Math.max(0, args.collisionProtectionSeconds) * 2;
  if (!args.topology) return;
  const missing = new Set<string>();
  const passes = collectMoveJunctionPasses(args.timelines, args.topology, (gap) => {
    const key = `${gap.blockId}|${gap.fromLabel}|${gap.toLabel}|${gap.reason}`;
    if (missing.has(key)) return;
    missing.add(key);
    // 經過時刻算不出來＝路徑安全無法驗證；缺資料不能當成沒問題
    const what = gap.reason === 'missing-time'
      ? `經過「${gap.fromLabel}」→「${gap.toLabel}」，路網上這一段沒有行駛時間`
      : gap.reason === 'no-edge'
        ? `經過「${gap.fromLabel}」→「${gap.toLabel}」，路網上這兩點之間沒有路段`
        : gap.reason === 'ambiguous-node'
          ? `經過的「${gap.fromLabel}」在路網上有不只一個同名節點，對不回實際路徑`
          : `經過的「${gap.fromLabel}」在路網上找不到`;
    pushIssue(args.warnings, {
      code: 'MISSING_TRAVEL_TIME',
      severity: 'error',
      kind: 'limit',
      message:
        `時間線 ${gap.timelineRow}：移動卡${what}，無法確認經過時刻與轉折點安全。`
        + (gap.reason === 'missing-time' ? '請到地圖路網補上這一段的行駛時間。' : '請確認地圖路網後重新生成。'),
      detail: {
        timelineRow: gap.timelineRow, blockId: gap.blockId,
        fromLabel: gap.fromLabel, toLabel: gap.toLabel, reason: gap.reason,
      },
    });
  });
  if (bufferSeconds <= 0) return;
  const ids = new Set(passes.map((pass) => pass.blockId));
  const seen = new Set<string>();
  for (const { mine, other, gapSeconds } of findJunctionConflictsForBlocks(passes, ids, bufferSeconds)) {
    if (mine.timelineRow > other.timelineRow) continue;
    const key = `${mine.blockId}|${other.blockId}|${mine.nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pushIssue(args.warnings, {
      code: 'MOVE_JUNCTION_CONFLICT',
      severity: 'warning',
      kind: 'limit',
      message:
        `「${mine.nodeLabel}」：時間線 ${mine.timelineRow} ${formatMinuteHms(secondToMinute(mine.instant))} 經過、`
        + `時間線 ${other.timelineRow} ${formatMinuteHms(secondToMinute(other.instant))} 經過，`
        + `只差 ${Math.round(gapSeconds)} 秒（需要 ${Math.round(bufferSeconds)} 秒）`,
      detail: {
        nodeId: mine.nodeId,
        nodeLabel: mine.nodeLabel,
        blockId: other.blockId,
        earlierBlockId: mine.blockId,
        timelineRow: mine.timelineRow,
        otherTimelineRow: other.timelineRow,
        gapSeconds: Math.round(gapSeconds),
        shortfallSeconds: Math.max(0, bufferSeconds - gapSeconds),
      },
    });
  }
}
