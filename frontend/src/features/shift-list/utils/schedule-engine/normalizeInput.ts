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
import type { MaintenanceFirstTripOrigin } from '../maintenanceFirstTripOrigins';
import { resolveRotationOffsetForExitStation } from '../maintenanceFirstTripOrigins';
import {
  buildYardRotationExitByTaskType,
  isStandbyDispatchableForMainline,
  shouldApplyYardExitRotationAlign,
} from '../maintenancePostTaskPolicy';
import { resolveRouteClearanceInsertGapSeconds } from '../stationClearanceInsert';
import { resolveEffectiveRouteTravelSeconds } from '../stationLegTravel';
import type { TaskTypeKey } from '../../../time-templates/types/editor';
import {
  sortSelectedRoutesByExecutionOrder,
  normalizeMinimumRecoveryTimeSeconds,
  resolveInterTripGapSeconds,
  resolvePassengerRouteOccupancy,
  shouldIncludeRecoveryForRouteSwitch,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  resolveFleetPhysicalHeadwayFloorSeconds,
  snapUpToClockAlignSeconds,
} from './physics';
import type { ShiftScheduleCreateDraft, ShiftScheduleSelectedRoute } from '../../types/create';
import { resolveSelectedRouteInstanceId } from '../../types/create';
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
import {
  buildRouteSuccessorPolicy,
  estimatePolicyCycleSeconds,
  ROUTE_SUCCESSOR_ALGORITHM_GRAPH,
  resolveRouteIndexInRotation,
  resolveStartInstanceId,
  type RouteSuccessorPolicy,
} from './routeSuccessorPolicy';
import { emptyShiftRouteRelationGraph } from '../routeRelationGraph';
import { emptyShiftRouteThroughAnchorsDraft } from '../routeRelationThroughCycles';

export type PassengerTimetableMode = 'template' | 'headway';

type ActivePassengerWindow = {
  /** 使用者在時間模板中宣告的正線開始秒 */
  startSecond: number;
  /**
   * 可掛車的最早秒。正線優先讓渡餘裕只允許占用「接下整備的開頭」，
   * 不得提前結束前一整備，因此此值等於 startSecond。
   */
  dispatchStartSecond: number;
  endSecond: number;
  /** 視窗後接下整備（或空時段邊界）的開始秒；無則不套用切入餘裕閘門 */
  nextMaintenanceStartSecond: number | null;
  /** 接下整備／空時段的切入餘裕（秒）：回程最晚可占用整備開頭至此秒數 */
  entrySlackSeconds: number;
};

export type EngineInput = {
  shiftId?: string;
  scheduleRowCount: number;
  confirmedTasks: ScheduleTask[];
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  passengerRoutes: ShiftScheduleSelectedRoute[];
  /** 主路線（輪替／班距）；不含備用 */
  selectedRoutes: ShiftScheduleSelectedRoute[];
  /** Step 4 備用路線（站位約束改派用；不進輪替） */
  backupRoutes: ShiftScheduleSelectedRoute[];
  maintenanceBody: Record<string, unknown> | null;
  maintenanceEntrySlackBySection: MaintenanceEntrySlackBySection;
  emptyIntervalMainlineSlackSeconds: number;
  minimumRecoveryTimeSeconds: number;
  turnaroundLimitSeconds: number | null;
  passengerTimetableMode: PassengerTimetableMode;
  timetableGenerationAlgorithm?: string;
  /** 目前啟用地圖拓樸抽出的首班起點站（設施→停靠） */
  firstTripOrigins: MaintenanceFirstTripOrigin[];
  /** Step 4 關聯圖／折返錨點繼任策略 */
  successorPolicy: RouteSuccessorPolicy;
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
  /** 目前啟用地圖拓樸的首班起點站目錄 */
  firstTripOrigins?: MaintenanceFirstTripOrigin[];
};

function resolveRouteOccupancySeconds(route: ShiftScheduleSelectedRoute): number {
  return resolvePassengerRouteOccupancy(route)?.occupancySeconds ?? 0;
}

/** 自輪替索引起估完一整輪剩餘占用（含班間恢復／換線；相位≠0 時繞回補齊） */
function estimateRemainingCycleSeconds(
  startRouteIndex: number,
  passengerRoutes: ShiftScheduleSelectedRoute[],
  minimumRecoveryTimeSeconds: number,
  successorPolicy?: RouteSuccessorPolicy,
): number {
  if (successorPolicy) {
    const startRoute = passengerRoutes[startRouteIndex] ?? passengerRoutes[0];
    if (!startRoute) return 0;
    return estimatePolicyCycleSeconds(
      successorPolicy,
      resolveSelectedRouteInstanceId(startRoute),
      minimumRecoveryTimeSeconds,
    );
  }
  const routeCount = passengerRoutes.length;
  if (routeCount === 0) return 0;
  let total = 0;
  for (let hop = 0; hop < routeCount; hop += 1) {
    const index = (startRouteIndex + hop) % routeCount;
    const route = passengerRoutes[index]!;
    if (hop > 0) {
      const prev = passengerRoutes[(startRouteIndex + hop - 1) % routeCount]!;
      total += resolveInterTripGapSeconds({
        minimumRecoveryTimeSeconds,
        previousRouteSwitchBufferSeconds: prev.switchBufferAfterSeconds,
        isRouteSwitch: prev.routeId !== route.routeId,
        includeRecovery: shouldIncludeRecoveryForRouteSwitch({
          previousRoute: prev,
          nextRoute: route,
          rotationRoutes: passengerRoutes,
        }),
        previousRoute: prev,
        nextRoute: route,
      });
    }
    total += resolveRouteOccupancySeconds(route);
  }
  return total;
}

type PlannedCycleLeg = {
  route: ShiftScheduleSelectedRoute;
  routeIndex: number;
  startSecond: number;
  occupancySeconds: number;
  endSecond: number;
};

/**
 * 整輪各腿相對已掛同向班次，是否都滿足目標班距（含過去與未來）。
 * 過往只擋「候選發車之前」，且未來只守物理地板 → 會允許 ~20s 級同向重疊。
 */
function cycleViolatesSameRouteHeadway(args: {
  legs: PlannedCycleLeg[];
  trackedLegs: TrackedPassengerLeg[];
  requiredHeadwayFor: (
    route: ShiftScheduleSelectedRoute,
    leg: PlannedCycleLeg,
    legIndex: number,
  ) => number;
  excludeTaskIndexes?: Set<number>;
}): string | null {
  const { legs, trackedLegs, requiredHeadwayFor, excludeTaskIndexes } = args;
  for (let legIndex = 0; legIndex < legs.length; legIndex += 1) {
    const leg = legs[legIndex]!;
    const required = requiredHeadwayFor(leg.route, leg, legIndex);
    if (required <= 0) continue;
    for (const other of trackedLegs) {
      if (excludeTaskIndexes?.has(other.taskIndex)) continue;
      if (other.routeId !== leg.route.routeId) continue;
      const gap = Math.abs(leg.startSecond - other.startSecond);
      if (gap < required) {
        return (
          `同方向班距不足（本輪 ${leg.startSecond}s 對已掛 ${other.startSecond}s，`
          + `間隔 ${gap}s < 目標 ${required}s）`
        );
      }
    }
  }
  return null;
}

/**
 * 從指定相位展開一整個合法交路。
 *
 * 班距脈衝只決定第一段的開始；後續 route legs 必須沿同車 successor chain
 * 連續完成，不能再各自等待另一個班距脈衝。
 */
function buildPlannedCycleLegs(args: {
  startRouteIndex: number;
  startSecond: number;
  passengerRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  useMinimumOccupancy?: boolean;
}): PlannedCycleLeg[] {
  const {
    startRouteIndex,
    startSecond,
    passengerRoutes,
    minimumRecoveryTimeSeconds,
    useMinimumOccupancy = false,
  } = args;
  const routeCount = passengerRoutes.length;
  if (routeCount === 0) return [];

  const legs: PlannedCycleLeg[] = [];
  let cursor = startSecond;
  let previousRoute: ShiftScheduleSelectedRoute | null = null;

  for (let hop = 0; hop < routeCount; hop += 1) {
    const routeIndex = (startRouteIndex + hop) % routeCount;
    const route = passengerRoutes[routeIndex]!;
    if (previousRoute) {
      cursor = snapUpToClockAlignSeconds(
        cursor + resolveInterTripGapSeconds({
          minimumRecoveryTimeSeconds,
          previousRouteSwitchBufferSeconds: previousRoute.switchBufferAfterSeconds,
          isRouteSwitch: previousRoute.routeId !== route.routeId,
          includeRecovery: shouldIncludeRecoveryForRouteSwitch({
            previousRoute,
            nextRoute: route,
            rotationRoutes: passengerRoutes,
          }),
          previousRoute,
          nextRoute: route,
        }),
      );
    }

    const occupancy = resolvePassengerRouteOccupancy(route);
    const occupancySeconds = occupancy
      ? useMinimumOccupancy
        ? occupancy.minOccupancySeconds
        : occupancy.occupancySeconds
      : 0;
    if (occupancySeconds <= 0) return [];
    const endSecond = cursor + occupancySeconds;
    legs.push({
      route,
      routeIndex,
      startSecond: cursor,
      occupancySeconds,
      endSecond,
    });
    cursor = endSecond;
    previousRoute = route;
  }

  return legs;
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

/** 已掛上的正線腿（供同方向班距查詢與局部讓路回推） */
type TrackedPassengerLeg = {
  taskIndex: number;
  row: number;
  routeId: string;
  route: ShiftScheduleSelectedRoute;
  startSecond: number;
  occupancySeconds: number;
  headwaySeconds: number;
  /** 同輪第一腿的 taskIndex */
  cycleAnchorTaskIndex: number;
};

function isHeadwayBlockedRejection(reason: string | undefined): boolean {
  if (!reason) return false;
  return (
    reason.startsWith('最早可發延遲')
    || reason === '最早可發已跨下一脈衝'
  );
}

function latestDepartureBefore(
  legs: TrackedPassengerLeg[],
  routeId: string,
  beforeSecond: number,
  excludeTaskIndexes?: Set<number>,
): number | null {
  let best: number | null = null;
  for (const leg of legs) {
    if (leg.routeId !== routeId) continue;
    if (excludeTaskIndexes?.has(leg.taskIndex)) continue;
    if (leg.startSecond >= beforeSecond) continue;
    if (best == null || leg.startSecond > best) best = leg.startSecond;
  }
  return best;
}

function latestDepartureOnRoute(
  legs: TrackedPassengerLeg[],
  routeId: string,
  excludeTaskIndexes?: Set<number>,
): TrackedPassengerLeg | null {
  let best: TrackedPassengerLeg | null = null;
  for (const leg of legs) {
    if (leg.routeId !== routeId) continue;
    if (excludeTaskIndexes?.has(leg.taskIndex)) continue;
    if (!best || leg.startSecond > best.startSecond) best = leg;
  }
  return best;
}

/**
 * 方向感知掛車：每個發車脈衝已標定路線（方向），只派給「輪替正好輪到該方向」
 * 且位於正線視窗內的車輛。
 *
 * 準點優先；若車因恢復／換線略晚：
 * - 該方向已有前班：只要延後不跨越下一脈衝即可掛上（吸收累積遲到）
 * - 該方向尚無前班：最多延後 120s（避免開班把脈衝拖離格位）
 * - 上一趟用「均」太晚就緒：可把上一趟占用壓到「快」再掛，優先於略過脈衝
 * - 仍掛不上且僅因同方向班距擋住：可局部回推已掛的衝突班次（讓路），優先承接脈衝
 *
 * 同方向班距下限：上一班實際發車 + max(前班時段班距, 本班時段班距)。
 * 正線優先整備讓渡：
 * - 正線視窗結束前開出的整輪，可在切入餘裕內占用下一整備開頭。
 * - 不得提前結束前一整備來預出車（讓渡餘裕只作用於整備開頭）。
 * - 跨入新正線視窗時，輪替對齊整輪邊界（與 assignRoutes 硬輪替一致）。
 * - 視窗前若為行前／充電／機動且拓樸有明確出場站，且該列之後仍有正線模板，
 *   輪替相位才對齊該站起點路線（例：行前出場 T3 → 首班 TN／TS）。
 *   純機動、無後續正線時不對齊、不強制跑出場方向。
 * - 班距地板只看候選發車之前的同方向班次，避免被已掛但更晚的交路中段腿卡死。
 * - 機動視窗可視為可派正線，但僅限「該機動開始後仍有正線視窗」的列
 *   （正線優先，不代表必須占滿機動；純機動列不派正線）。
 * - 保養的最壞出場交路由展開後 insertMaintenanceEntryServiceTrips 處理。
 */
function assignDirectionalDepartures(args: {
  departures: DirectionalHeadwayDeparture[];
  scheduleRowCount: number;
  passengerRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  /** row → 正線可用視窗；未提供時視為全日可用（headway 模式） */
  rowActiveWindows?: Map<number, ActivePassengerWindow[]>;
  /** 非正線模板任務（判斷視窗前整備類型） */
  nonPassengerTasks?: ScheduleTask[];
  /** 全部模板任務（判斷整備後是否還有正線） */
  templateTasks?: ScheduleTask[];
  /** 整備類型 → 出場站 stationId（行前／充電／機動） */
  yardRotationExitByTaskType?: Partial<Record<TaskTypeKey, string>>;
  /** Step 4 繼任策略；提供時以策略決定開輪相位與整輪估時 */
  successorPolicy?: RouteSuccessorPolicy;
  /** 掛不上班距需求時留下可觀測 issue，不再靜默丟棄 */
  warnings?: FeasibilityIssue[];
}): ScheduleTask[] {
  const {
    departures,
    scheduleRowCount,
    passengerRoutes,
    minimumRecoveryTimeSeconds,
    rowActiveWindows,
    nonPassengerTasks = [],
    templateTasks = [],
    yardRotationExitByTaskType = {},
    successorPolicy,
    warnings,
  } = args;
  const routeCount = passengerRoutes.length;
  if (scheduleRowCount <= 0 || departures.length === 0 || routeCount === 0) return [];

  const freeAt = Array.from({ length: scheduleRowCount + 1 }, () => 0);
  /** 各列上一趟正線（用來在趕不上脈衝時把上一趟從均壓到快） */
  const lastPassengerByRow: Array<{
    taskIndex: number;
    route: ShiftScheduleSelectedRoute;
    startSecond: number;
    /** 實際採用的占用（均或已壓到快） */
    occupancyUsed: number;
  } | null> = Array.from({ length: scheduleRowCount + 1 }, () => null);
  const rotationIndex = Array.from({ length: scheduleRowCount + 1 }, () => 0);
  const rotationPhaseByRow = Array.from({ length: scheduleRowCount + 1 }, () => 0);
  const windowKeyByRow = Array.from(
    { length: scheduleRowCount + 1 },
    () => '' as string,
  );
  /** 各方向上一班所屬時段班距：切時段時與本班取 max */
  const lastHeadwaySecondsByRouteId = new Map<string, number>();
  const tasks: ScheduleTask[] = [];
  const trackedLegs: TrackedPassengerLeg[] = [];

  const requiredHeadwayForRoute = (
    route: ShiftScheduleSelectedRoute,
    fallbackHeadwaySeconds: number,
  ): number => {
    const prevHeadway = lastHeadwaySecondsByRouteId.get(route.routeId)
      ?? fallbackHeadwaySeconds;
    const fleetPhysicalFloor = resolveFleetPhysicalHeadwayFloorSeconds(
      route,
      scheduleRowCount,
    );
    return Math.max(prevHeadway, fallbackHeadwaySeconds, fleetPhysicalFloor);
  };

  /**
   * 行前／充電／機動後「調撥開輪」相對前車的插入間距：
   * 衝突站靠站／離站＋遲到佔站＋緩衝％，**不用**營運班距／車隊物理地板。
   */
  const clearanceInsertGapSecondsForRoute = (
    route: ShiftScheduleSelectedRoute,
  ): number =>
    resolveRouteClearanceInsertGapSeconds(
      route,
      resolveEffectiveRouteTravelSeconds(route),
    );

  const isYardExitClearanceInsert = (
    row: number,
    windowStartSecond: number,
  ): boolean => {
    const preceding = findPrecedingNonPassengerTask(
      nonPassengerTasks,
      row,
      windowStartSecond,
    );
    if (!preceding) return false;
    return (
      preceding.taskType === 'inspection'
      || preceding.taskType === 'charging'
      || preceding.taskType === 'standby'
    );
  };

  /**
   * 班距地板只看「候選發車之前」的同方向班次。
   * 行前調撥開輪改用車站清除間距；一般營運仍用目標班距。
   */
  const headwayFloorForRoute = (
    route: ShiftScheduleSelectedRoute,
    fallbackHeadwaySeconds: number,
    excludeTaskIndexes?: Set<number>,
    beforeSecond?: number,
    options?: { clearanceInsert?: boolean },
  ): number => {
    const priorSecond =
      beforeSecond == null
        ? latestDepartureOnRoute(
            trackedLegs,
            route.routeId,
            excludeTaskIndexes,
          )?.startSecond ?? null
        : latestDepartureBefore(
            trackedLegs,
            route.routeId,
            beforeSecond,
            excludeTaskIndexes,
          );
    if (priorSecond == null) return 0;
    const gapSeconds = options?.clearanceInsert
      ? clearanceInsertGapSecondsForRoute(route)
      : requiredHeadwayForRoute(route, fallbackHeadwaySeconds);
    return snapUpToClockAlignSeconds(priorSecond + gapSeconds);
  };

  const findWindow = (
    row: number,
    timeSec: number,
    windowsByRow = rowActiveWindows,
  ): ActivePassengerWindow | null => {
    if (!windowsByRow) {
      return {
        startSecond: 0,
        dispatchStartSecond: 0,
        endSecond: 24 * 3600,
        nextMaintenanceStartSecond: null,
        entrySlackSeconds: DEFAULT_MAINTENANCE_ENTRY_SLACK_SECONDS,
      };
    }
    const windows = windowsByRow.get(row) ?? [];
    return windows.find(
      (win) => timeSec >= win.dispatchStartSecond && timeSec < win.endSecond,
    ) ?? null;
  };
  const windowKey = (win: ActivePassengerWindow): string =>
    `${win.startSecond}-${win.endSecond}`;

  const resolveWindowRotationPhase = (row: number, windowStartSecond: number): number => {
    const preceding = findPrecedingNonPassengerTask(
      nonPassengerTasks,
      row,
      windowStartSecond,
    );
    if (!preceding) return 0;
    const exitStationId = yardRotationExitByTaskType[preceding.taskType];
    const yardEndMinute = preceding.startMinute + preceding.durationMinutes;
    if (
      shouldApplyYardExitRotationAlign({
        exitStationId,
        templateTasks,
        row,
        yardEndMinute,
      })
    ) {
      if (successorPolicy) {
        const startId = resolveStartInstanceId(successorPolicy, exitStationId);
        if (!startId) return 0;
        const index = resolveRouteIndexInRotation(successorPolicy, startId);
        return index >= 0 ? index : 0;
      }
      return resolveRotationOffsetForExitStation(passengerRoutes, exitStationId) ?? 0;
    }
    if (preceding.taskType === 'servicing') {
      return 0;
    }
    // 充電／行前／機動無明確出場，或整備後無正線：延續進入整備前的輪替相位
    return ((rotationIndex[row]! % routeCount) + routeCount) % routeCount;
  };

  for (let index = 0; index < departures.length; index += 1) {
    const departure = departures[index]!;
    const pulseRoute = passengerRoutes[departure.routeIndex];
    if (!pulseRoute || pulseRoute.routeId !== departure.routeId) continue;

    // 下一脈衝邊界：延後若跨越此線，應留給下一脈衝，避免雙掛
    const nextPulseSecond = pulseSecond(departure);

    /**
     * 週期脈衝（routeIndex 恒為 0）代表「一台車開一整輪」。
     * 行前／充電／機動出場後相位可能落在 TN 等非 0 起點；必須依該車相位
     * 起班（例如 T 出場 → TN），不可再要求對齊脈衝的 canonical 起點路線。
     * 班距地板也依「此車實際起班路線」計算，避免用 NT 班距卡住 TN 出場。
     */
    const resolveStartRouteIndex = (row: number): number =>
      ((rotationIndex[row]! % routeCount) + routeCount) % routeCount;

    const resolveRowHeadwayGate = (
      row: number,
      excludeTaskIndexes?: Set<number>,
      beforeSecond?: number,
      windowStartSecond?: number,
    ): {
      headwayFloor: number;
      maxDelaySeconds: number;
      requiredHeadway: number;
      startRoute: ShiftScheduleSelectedRoute;
      clearanceInsert: boolean;
    } => {
      const startRoute = passengerRoutes[resolveStartRouteIndex(row)]!;
      const clearanceInsert =
        windowStartSecond != null
        && isYardExitClearanceInsert(row, windowStartSecond);
      const requiredHeadway = clearanceInsert
        ? clearanceInsertGapSecondsForRoute(startRoute)
        : requiredHeadwayForRoute(startRoute, departure.headwaySeconds);
      const headwayFloor = headwayFloorForRoute(
        startRoute,
        departure.headwaySeconds,
        excludeTaskIndexes,
        beforeSecond,
        { clearanceInsert },
      );
      const hasPriorSameDirection = headwayFloor > 0;
      /**
       * 開班／該方向尚無前班：最多小幅延後 120s（避免 00:00 上行拖到 00:07:50）。
       * 營運中已有同方向前班：只要延後不跨越下一脈衝即可掛上。
       * 行前調撥：requiredHeadway 已是清除間距（通常遠小於營運班距）。
       */
      return {
        startRoute,
        requiredHeadway,
        headwayFloor,
        clearanceInsert,
        maxDelaySeconds: hasPriorSameDirection
          ? Math.max(0, requiredHeadway - SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS)
          : 120,
      };
    };

    let chosenRow = -1;
    let chosenStartSecond = departure.startSecond;
    let chosenCompressPreviousTo: number | null = null;
    let chosenUseMinimumCycle = false;
    let bestScore = Number.POSITIVE_INFINITY;
    const rejectionByRow = new Map<number, string>();

    const evaluateRow = (
      row: number,
      earliestFree: number,
      winAtPulse: ActivePassengerWindow,
      compressPreviousTo: number | null,
      compressionPenalty: number,
    ): void => {
      const rotation = rotationIndex[row]!;
      const startRouteIndex = resolveStartRouteIndex(row);
      const provisionalEarliest = Math.max(
        departure.startSecond,
        earliestFree,
        winAtPulse.dispatchStartSecond,
      );
      const gate = resolveRowHeadwayGate(
        row,
        undefined,
        provisionalEarliest,
        winAtPulse.startSecond,
      );
      const startSecond = Math.max(provisionalEarliest, gate.headwayFloor);
      const delay = startSecond - departure.startSecond;
      if (delay > gate.maxDelaySeconds) {
        rejectionByRow.set(
          row,
          `最早可發延遲 ${delay}s，超過上限 ${gate.maxDelaySeconds}s`,
        );
        return;
      }
      if (startSecond >= nextPulseSecond) {
        rejectionByRow.set(row, '最早可發已跨下一脈衝');
        return;
      }
      if (startSecond >= winAtPulse.endSecond || !findWindow(row, startSecond)) {
        rejectionByRow.set(row, '最早可發已超出正線視窗');
        return;
      }

      // 整輪：開輪腿若為行前調撥用清除間距；其後各腿仍守營運班距。
      const headwayForLeg = (
        route: ShiftScheduleSelectedRoute,
        _leg: PlannedCycleLeg,
        legIndex: number,
      ) =>
        gate.clearanceInsert && legIndex === 0
          ? clearanceInsertGapSecondsForRoute(route)
          : requiredHeadwayForRoute(route, departure.headwaySeconds);
      let useMinimumCycle = false;
      let plannedLegs = buildPlannedCycleLegs({
        startRouteIndex,
        startSecond,
        passengerRoutes,
        minimumRecoveryTimeSeconds,
        useMinimumOccupancy: false,
      });
      if (plannedLegs.length !== routeCount) {
        rejectionByRow.set(row, '無法展開完整交路占用');
        return;
      }
      {
        const conflict = cycleViolatesSameRouteHeadway({
          legs: plannedLegs,
          trackedLegs,
          requiredHeadwayFor: headwayForLeg,
        });
        if (conflict) {
          rejectionByRow.set(row, conflict);
          return;
        }
      }

      const phase = rotationPhaseByRow[row] ?? 0;
      if (
        rotation % routeCount === phase
        && winAtPulse.nextMaintenanceStartSecond != null
      ) {
        const cycleNeed = estimateRemainingCycleSeconds(
          startRouteIndex,
          passengerRoutes,
          minimumRecoveryTimeSeconds,
          successorPolicy,
        );
        const latestAllowedEnd =
          winAtPulse.nextMaintenanceStartSecond + winAtPulse.entrySlackSeconds;
        if (startSecond + cycleNeed > latestAllowedEnd) {
          const minimumLegs = buildPlannedCycleLegs({
            startRouteIndex,
            startSecond,
            passengerRoutes,
            minimumRecoveryTimeSeconds,
            useMinimumOccupancy: true,
          });
          const minimumEnd =
            minimumLegs.length === routeCount
              ? minimumLegs[minimumLegs.length - 1]!.endSecond
              : Number.POSITIVE_INFINITY;
          const minimumConflict =
            minimumLegs.length === routeCount
              ? cycleViolatesSameRouteHeadway({
                  legs: minimumLegs,
                  trackedLegs,
                  requiredHeadwayFor: headwayForLeg,
                })
              : '無法展開完整交路占用';
          if (minimumEnd > latestAllowedEnd || minimumConflict) {
            rejectionByRow.set(
              row,
              `完整交路均／快最早結束 ${startSecond + cycleNeed}s/${minimumEnd}s，`
              + (
                minimumConflict
                  ? '快模式會壓低同方向班距'
                  : `超過整備讓渡上限 ${latestAllowedEnd}s`
              ),
            );
            return;
          }
          useMinimumCycle = true;
          plannedLegs = minimumLegs;
        }
      }

      const score =
        delay * 1e9
        + (compressionPenalty + (useMinimumCycle ? 1 : 0)) * 1e7
        + startSecond * 1e3
        + earliestFree;
      if (score < bestScore) {
        bestScore = score;
        chosenRow = row;
        chosenStartSecond = startSecond;
        chosenCompressPreviousTo = compressPreviousTo;
        chosenUseMinimumCycle = useMinimumCycle;
      }
    };

    const prepareRowWindow = (
      row: number,
      windowsByRow = rowActiveWindows,
    ): ActivePassengerWindow | null => {
      let winAtPulse = findWindow(row, departure.startSecond, windowsByRow);
      const probeGate = resolveRowHeadwayGate(
        row,
        undefined,
        undefined,
        winAtPulse?.startSecond,
      );
      if (!winAtPulse && windowsByRow) {
        // 換班邊界：脈衝稍早於下一個正線視窗時，可延後到新車開始值勤，
        // 但仍不得跨下一脈衝或超過一般 soft-delay 上限。
        winAtPulse = (windowsByRow.get(row) ?? []).find(
          (win) =>
            win.dispatchStartSecond > departure.startSecond
            && win.dispatchStartSecond < nextPulseSecond
            && win.dispatchStartSecond - departure.startSecond
              <= probeGate.maxDelaySeconds,
        ) ?? null;
      }
      if (!winAtPulse) {
        rejectionByRow.set(row, '脈衝時刻沒有正線可用視窗');
        return null;
      }
      const nextWindowKey = windowKey(winAtPulse);
      if (windowKeyByRow[row] !== nextWindowKey) {
        const phase = resolveWindowRotationPhase(row, winAtPulse.startSecond);
        rotationIndex[row] =
          Math.ceil(rotationIndex[row]! / routeCount) * routeCount + phase;
        rotationPhaseByRow[row] = phase;
        windowKeyByRow[row] = nextWindowKey;
      }
      // 週期脈衝不要求相位＝departure.routeIndex；出場站相位在展開交路時生效。
      return winAtPulse;
    };

    const resolveFreeTimes = (
      row: number,
    ): {
      freeAtUsed: number;
      freeAtMin: number;
      prevMinOccupancy: number | null;
      canCompressPrevious: boolean;
    } => {
      const prevPlacement = lastPassengerByRow[row];
      let freeAtUsed = freeAt[row]!;
      let freeAtMin = freeAt[row]!;
      let prevMinOccupancy: number | null = null;
      let canCompressPrevious = false;
      const rotation = rotationIndex[row]!;
      const nextRoute = passengerRoutes[resolveStartRouteIndex(row)]!;

      if (prevPlacement) {
        const prevOcc = resolvePassengerRouteOccupancy(prevPlacement.route);
        if (prevOcc) {
          prevMinOccupancy = prevOcc.minOccupancySeconds;
          const gapSeconds = resolveInterTripGapSeconds({
            minimumRecoveryTimeSeconds,
            previousRouteSwitchBufferSeconds: prevPlacement.route.switchBufferAfterSeconds,
            isRouteSwitch: prevPlacement.route.routeId !== nextRoute.routeId,
            includeRecovery: shouldIncludeRecoveryForRouteSwitch({
              previousRoute: prevPlacement.route,
              nextRoute,
              rotationRoutes: passengerRoutes,
            }),
            previousRoute: prevPlacement.route,
            nextRoute,
          });
          freeAtUsed = snapUpToClockAlignSeconds(
            prevPlacement.startSecond + prevPlacement.occupancyUsed + gapSeconds,
          );
          freeAtMin = snapUpToClockAlignSeconds(
            prevPlacement.startSecond + prevOcc.minOccupancySeconds + gapSeconds,
          );
          canCompressPrevious =
            prevPlacement.occupancyUsed > prevOcc.minOccupancySeconds
            && freeAtMin < freeAtUsed;
        }
      } else if (freeAt[row]! > 0) {
        const prevRoute = passengerRoutes[
          (rotation - 1 + routeCount) % routeCount
        ]!;
        const gapSeconds = resolveInterTripGapSeconds({
          minimumRecoveryTimeSeconds,
          previousRouteSwitchBufferSeconds: prevRoute.switchBufferAfterSeconds,
          isRouteSwitch: prevRoute.routeId !== nextRoute.routeId,
          includeRecovery: shouldIncludeRecoveryForRouteSwitch({
            previousRoute: prevRoute,
            nextRoute,
            rotationRoutes: passengerRoutes,
          }),
          previousRoute: prevRoute,
          nextRoute,
        });
        freeAtUsed = snapUpToClockAlignSeconds(freeAt[row]! + gapSeconds);
        freeAtMin = freeAtUsed;
      }

      return { freeAtUsed, freeAtMin, prevMinOccupancy, canCompressPrevious };
    };

    // 1) 平常：上一趟用均（已採用占用）
    for (let row = 1; row <= scheduleRowCount; row += 1) {
      const winAtPulse = prepareRowWindow(row);
      if (!winAtPulse) continue;
      const { freeAtUsed } = resolveFreeTimes(row);
      evaluateRow(row, freeAtUsed, winAtPulse, null, 0);
    }

    // 2) 僅當用均完全掛不上，才把上一趟壓到快再試
    if (chosenRow < 0) {
      for (let row = 1; row <= scheduleRowCount; row += 1) {
        const winAtPulse = prepareRowWindow(row);
        if (!winAtPulse) continue;
        const { freeAtMin, prevMinOccupancy, canCompressPrevious } = resolveFreeTimes(row);
        if (!canCompressPrevious || prevMinOccupancy == null) continue;
        const prev = lastPassengerByRow[row]!;
        evaluateRow(
          row,
          freeAtMin,
          winAtPulse,
          prevMinOccupancy,
          prev.occupancyUsed - prevMinOccupancy,
        );
      }
    }

    // 3) 同方向班距讓路：僅因班距地板太晚而掛不上時，回推已掛衝突班次
    if (chosenRow < 0) {
      type YieldPlan = {
        row: number;
        startSecond: number;
        useMinimumCycle: boolean;
        compressPreviousTo: number | null;
        yieldSeconds: number;
        blockerTaskIndex: number;
        shiftedStarts: Map<number, number>;
        score: number;
      };
      let bestYield: YieldPlan | null = null;

      for (let row = 1; row <= scheduleRowCount; row += 1) {
        if (!isHeadwayBlockedRejection(rejectionByRow.get(row))) continue;
        const winAtPulse = prepareRowWindow(row);
        if (!winAtPulse) continue;

        const startRouteIndex = resolveStartRouteIndex(row);
        const startRoute = passengerRoutes[startRouteIndex]!;
        const blocker = latestDepartureOnRoute(trackedLegs, startRoute.routeId);
        if (!blocker || blocker.row === row) continue;

        const exclude = new Set<number>();
        const chain = trackedLegs
          .filter(
            (leg) =>
              leg.cycleAnchorTaskIndex === blocker.cycleAnchorTaskIndex
              && leg.taskIndex >= blocker.taskIndex,
          )
          .sort((a, b) => a.taskIndex - b.taskIndex);
        for (const leg of chain) exclude.add(leg.taskIndex);

        const { freeAtUsed } = resolveFreeTimes(row);
        const provisionalEarliest = Math.max(
          departure.startSecond,
          freeAtUsed,
          winAtPulse.dispatchStartSecond,
        );
        const gateWithoutBlocker = resolveRowHeadwayGate(
          row,
          exclude,
          provisionalEarliest,
          winAtPulse.startSecond,
        );
        const desiredStart = Math.max(
          provisionalEarliest,
          gateWithoutBlocker.headwayFloor,
        );
        const delay = desiredStart - departure.startSecond;
        if (delay > gateWithoutBlocker.maxDelaySeconds) continue;
        if (desiredStart >= nextPulseSecond) continue;
        if (desiredStart >= winAtPulse.endSecond || !findWindow(row, desiredStart)) {
          continue;
        }

        const yieldTo = snapUpToClockAlignSeconds(
          desiredStart + gateWithoutBlocker.requiredHeadway,
        );
        const yieldSeconds = yieldTo - blocker.startSecond;
        if (yieldSeconds <= 0) continue;

        // 模擬回推阻擋腿及其同輪後續腿
        const shiftedStarts = new Map<number, number>();
        let cursor = yieldTo;
        let yieldFeasible = true;
        for (let chainIndex = 0; chainIndex < chain.length; chainIndex += 1) {
          const leg = chain[chainIndex]!;
          if (chainIndex > 0) {
            const prev = chain[chainIndex - 1]!;
            const prevNewStart = shiftedStarts.get(prev.taskIndex)!;
            const originalGap = Math.max(
              0,
              leg.startSecond - (prev.startSecond + prev.occupancySeconds),
            );
            cursor = snapUpToClockAlignSeconds(
              prevNewStart + prev.occupancySeconds + originalGap,
            );
          }
          shiftedStarts.set(leg.taskIndex, cursor);

          const prior = latestDepartureBefore(
            trackedLegs,
            leg.routeId,
            cursor,
            exclude,
          );
          const routeHeadway = requiredHeadwayForRoute(
            leg.route,
            leg.headwaySeconds,
          );
          if (prior != null && cursor - prior < routeHeadway) {
            yieldFeasible = false;
            break;
          }

          // 被回推後不得超出「候選發車 + 一班距」以外（本式 yieldTo 恰為此上限）
          if (cursor > yieldTo + SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS) {
            yieldFeasible = false;
            break;
          }
        }
        if (!yieldFeasible) continue;

        const lastShifted = chain[chain.length - 1]!;
        const lastShiftedStart = shiftedStarts.get(lastShifted.taskIndex)!;
        const lastShiftedEnd = lastShiftedStart + lastShifted.occupancySeconds;
        const blockerWindow = findWindow(blocker.row, lastShiftedStart)
          ?? findWindow(blocker.row, blocker.startSecond);
        if (blockerWindow) {
          const latestAllowedEnd =
            blockerWindow.nextMaintenanceStartSecond != null
              ? blockerWindow.nextMaintenanceStartSecond + blockerWindow.entrySlackSeconds
              : blockerWindow.endSecond;
          if (lastShiftedEnd > latestAllowedEnd) continue;
        }

        // 候選車整輪在讓路後的班距仍成立
        let useMinimumCycle = false;
        const phase = rotationPhaseByRow[row] ?? 0;
        const rotation = rotationIndex[row]!;
        if (
          rotation % routeCount === phase
          && winAtPulse.nextMaintenanceStartSecond != null
        ) {
          const cycleNeed = estimateRemainingCycleSeconds(
            startRouteIndex,
            passengerRoutes,
            minimumRecoveryTimeSeconds,
            successorPolicy,
          );
          const latestAllowedEnd =
            winAtPulse.nextMaintenanceStartSecond + winAtPulse.entrySlackSeconds;
          if (desiredStart + cycleNeed > latestAllowedEnd) {
            const minimumLegs = buildPlannedCycleLegs({
              startRouteIndex,
              startSecond: desiredStart,
              passengerRoutes,
              minimumRecoveryTimeSeconds,
              useMinimumOccupancy: true,
            });
            const minimumEnd =
              minimumLegs.length === routeCount
                ? minimumLegs[minimumLegs.length - 1]!.endSecond
                : Number.POSITIVE_INFINITY;
            const minimumConflict =
              minimumLegs.length === routeCount
                ? cycleViolatesSameRouteHeadway({
                    legs: minimumLegs,
                    trackedLegs,
                    requiredHeadwayFor: (route, _leg, legIndex) =>
                      gateWithoutBlocker.clearanceInsert && legIndex === 0
                        ? clearanceInsertGapSecondsForRoute(route)
                        : requiredHeadwayForRoute(route, departure.headwaySeconds),
                    excludeTaskIndexes: exclude,
                  })
                : 'missing';
            if (minimumEnd > latestAllowedEnd || minimumConflict) continue;
            useMinimumCycle = true;
          }
        }

        const previewLegs = buildPlannedCycleLegs({
          startRouteIndex,
          startSecond: desiredStart,
          passengerRoutes,
          minimumRecoveryTimeSeconds,
          useMinimumOccupancy: useMinimumCycle,
        });
        if (previewLegs.length !== routeCount) continue;
        const headwayForYield = (
          route: ShiftScheduleSelectedRoute,
          _leg: PlannedCycleLeg,
          legIndex: number,
        ) =>
          gateWithoutBlocker.clearanceInsert && legIndex === 0
            ? clearanceInsertGapSecondsForRoute(route)
            : requiredHeadwayForRoute(route, departure.headwaySeconds);
        if (
          cycleViolatesSameRouteHeadway({
            legs: previewLegs,
            trackedLegs,
            requiredHeadwayFor: headwayForYield,
            excludeTaskIndexes: exclude,
          })
        ) {
          continue;
        }
        // 讓路後的新時刻也要與候選整輪守班距
        {
          let yieldHeadwayOk = true;
          for (let legIndex = 0; legIndex < previewLegs.length; legIndex += 1) {
            const leg = previewLegs[legIndex]!;
            const required = headwayForYield(leg.route, leg, legIndex);
            if (required <= 0) continue;
            for (const chainLeg of chain) {
              if (chainLeg.routeId !== leg.route.routeId) continue;
              const newStart = shiftedStarts.get(chainLeg.taskIndex);
              if (newStart == null) continue;
              if (Math.abs(leg.startSecond - newStart) < required) {
                yieldHeadwayOk = false;
                break;
              }
            }
            if (!yieldHeadwayOk) break;
          }
          if (!yieldHeadwayOk) continue;
        }

        // 出場相位剛開窗優先；回推秒數與候選延遲愈小愈好
        const yardOpenBonus = rotation % routeCount === phase && phase !== 0 ? 0 : 1e8;
        const score =
          yardOpenBonus
          + yieldSeconds * 1e6
          + delay * 1e3
          + desiredStart;
        if (!bestYield || score < bestYield.score) {
          bestYield = {
            row,
            startSecond: desiredStart,
            useMinimumCycle,
            compressPreviousTo: null,
            yieldSeconds,
            blockerTaskIndex: blocker.taskIndex,
            shiftedStarts,
            score,
          };
        }
      }

      if (bestYield) {
        for (const leg of trackedLegs) {
          const newStart = bestYield.shiftedStarts.get(leg.taskIndex);
          if (newStart == null) continue;
          leg.startSecond = newStart;
          const task = tasks[leg.taskIndex];
          if (task) {
            task.startMinute = secondToMinute(newStart);
            task.durationMinutes = Math.max(1, leg.occupancySeconds / 60);
          }
        }
        const shiftedOnRow = trackedLegs
          .filter((leg) => bestYield.shiftedStarts.has(leg.taskIndex))
          .sort((a, b) => a.startSecond - b.startSecond);
        const lastOnBlockerRow = shiftedOnRow[shiftedOnRow.length - 1];
        if (lastOnBlockerRow) {
          freeAt[lastOnBlockerRow.row] =
            lastOnBlockerRow.startSecond + lastOnBlockerRow.occupancySeconds;
          lastPassengerByRow[lastOnBlockerRow.row] = {
            taskIndex: lastOnBlockerRow.taskIndex,
            route: lastOnBlockerRow.route,
            startSecond: lastOnBlockerRow.startSecond,
            occupancyUsed: lastOnBlockerRow.occupancySeconds,
          };
        }
        chosenRow = bestYield.row;
        chosenStartSecond = bestYield.startSecond;
        chosenUseMinimumCycle = bestYield.useMinimumCycle;
        chosenCompressPreviousTo = bestYield.compressPreviousTo;
      }
    }

    if (chosenRow < 0) {
      const hadDispatchableServiceWindow = [...rejectionByRow.values()].some(
        (reason) => reason !== '脈衝時刻沒有正線可用視窗',
      );
      if (
        warnings
        && hadDispatchableServiceWindow
        && successorPolicy?.algorithm === ROUTE_SUCCESSOR_ALGORITHM_GRAPH
      ) {
        pushIssue(warnings, {
          code: 'UNSERVED_SERVICE_PULSE',
          severity: 'warning',
          message:
            `班距需求 ${Math.floor(departure.startSecond / 3600)
              .toString()
              .padStart(2, '0')}:${Math.floor((departure.startSecond % 3600) / 60)
              .toString()
              .padStart(2, '0')} 無可用車承接，該時段實際 PPHPD 將低於目標`,
          detail: {
            departureSecond: departure.startSecond,
            headwaySeconds: departure.headwaySeconds,
            intervalId: departure.intervalId,
            intervalName: departure.intervalName,
            rowRejections: Object.fromEntries(rejectionByRow),
          },
        });
      }
      continue;
    }

    if (
      chosenCompressPreviousTo != null
      && lastPassengerByRow[chosenRow]
    ) {
      const prev = lastPassengerByRow[chosenRow]!;
      const prevTask = tasks[prev.taskIndex];
      if (prevTask) {
        prevTask.durationMinutes = Math.max(1, chosenCompressPreviousTo / 60);
      }
      prev.occupancyUsed = chosenCompressPreviousTo;
    }

    const cycleLegs = buildPlannedCycleLegs({
      startRouteIndex: resolveStartRouteIndex(chosenRow),
      startSecond: chosenStartSecond,
      passengerRoutes,
      minimumRecoveryTimeSeconds,
      useMinimumOccupancy: chosenUseMinimumCycle,
    });
    if (cycleLegs.length !== routeCount) continue;

    let finalTaskIndex = -1;
    let cycleAnchorTaskIndex = tasks.length;
    for (const [legIndex, leg] of cycleLegs.entries()) {
      finalTaskIndex = tasks.length;
      if (legIndex === 0) cycleAnchorTaskIndex = finalTaskIndex;
      tasks.push({
        id:
          `template-pax-${departure.intervalId}-${leg.route.routeId}`
          + `-${index + 1}-${legIndex + 1}-${leg.startSecond}`,
        rowIndex: chosenRow,
        taskType: 'passenger',
        startMinute: secondToMinute(leg.startSecond),
        durationMinutes: Math.max(1, leg.occupancySeconds / 60),
        label: '正線',
      });
      trackedLegs.push({
        taskIndex: finalTaskIndex,
        row: chosenRow,
        routeId: leg.route.routeId,
        route: leg.route,
        startSecond: leg.startSecond,
        occupancySeconds: leg.occupancySeconds,
        headwaySeconds: departure.headwaySeconds,
        cycleAnchorTaskIndex,
      });
      lastHeadwaySecondsByRouteId.set(leg.route.routeId, departure.headwaySeconds);
    }

    const finalLeg = cycleLegs[cycleLegs.length - 1]!;
    freeAt[chosenRow] = finalLeg.endSecond;
    lastPassengerByRow[chosenRow] = {
      taskIndex: finalTaskIndex,
      route: finalLeg.route,
      startSecond: finalLeg.startSecond,
      occupancyUsed: finalLeg.occupancySeconds,
    };
    // 一個班距脈衝已完整展開整輪；下一次仍從同一相位開輪。
    rotationIndex[chosenRow] += routeCount;
  }

  return tasks;
}

function pulseSecond(departure: DirectionalHeadwayDeparture): number {
  return departure.startSecond + departure.headwaySeconds;
}

/**
 * 完整交路可依 entry slack 占用下一整備開頭；先把整備 task 的開始推到整輪
 * 真實結束，避免 expand 依原始 start 排序時把整備插進同一輪中段。
 * 整備尾端鎖定，僅壓縮其可用時長。
 */
function deferNonPassengerTasksAfterCycleSpill(
  nonPassengerTasks: ScheduleTask[],
  passengerTasks: ScheduleTask[],
): void {
  const passengerByRow = new Map<number, ScheduleTask[]>();
  for (const task of passengerTasks) {
    const list = passengerByRow.get(task.rowIndex) ?? [];
    list.push(task);
    passengerByRow.set(task.rowIndex, list);
  }

  for (const task of nonPassengerTasks) {
    const originalStartSecond = minuteToSecondApprox(task.startMinute);
    const originalEndSecond = minuteToSecondApprox(
      task.startMinute + task.durationMinutes,
    );
    let deferredStartSecond = originalStartSecond;

    for (const passenger of passengerByRow.get(task.rowIndex) ?? []) {
      const passengerStart = minuteToSecondApprox(passenger.startMinute);
      const passengerEnd = minuteToSecondApprox(
        passenger.startMinute + passenger.durationMinutes,
      );
      if (
        passengerStart < originalEndSecond
        && passengerEnd > originalStartSecond
      ) {
        deferredStartSecond = Math.max(deferredStartSecond, passengerEnd);
      }
    }

    if (deferredStartSecond <= originalStartSecond) continue;
    task.startMinute = secondToMinute(deferredStartSecond);
    task.durationMinutes = Math.max(
      0,
      secondToMinute(originalEndSecond - deferredStartSecond),
    );
  }
}

/** 找該列在視窗開始前、結束時間最靠近的非正線任務 */
function findPrecedingNonPassengerTask(
  nonPassengerTasks: ScheduleTask[],
  row: number,
  windowStartSecond: number,
): ScheduleTask | null {
  let best: ScheduleTask | null = null;
  let bestEnd = -1;
  for (const task of nonPassengerTasks) {
    if (task.rowIndex !== row) continue;
    const endSec = Math.round((task.startMinute + task.durationMinutes) * 60);
    if (endSec > windowStartSecond + 1) continue;
    if (endSec >= bestEnd) {
      best = task;
      bestEnd = endSec;
    }
  }
  return best;
}

function buildHeadwayPassengerTasks(args: {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  scheduleRowCount: number;
  passengerRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  errors: FeasibilityIssue[];
  warnings?: FeasibilityIssue[];
  successorPolicy?: RouteSuccessorPolicy;
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
    successorPolicy: args.successorPolicy,
    warnings: args.warnings,
  });
}

/**
 * 1.1 讀取輸入：模板任務、路線、整備、恢復時間、折返時限。
 * headway 模式可在沒有模板正線任務時，依班距生成正線錨點。
 */
export function normalizeEngineInput(
  args: NormalizeInputArgs,
  errors: FeasibilityIssue[],
  warnings: FeasibilityIssue[] = errors,
): EngineInput | null {
  const template = parseStoredTemplateBody(args.templateBody);
  const mode: PassengerTimetableMode = args.passengerTimetableMode ?? 'template';

  const selectedRoutes = args.draft.routeGroups.selectedRoutes.filter((route) =>
    !route.backupForInstanceId && !route.backupForRouteId,
  );
  const backupRoutes = args.draft.routeGroups.selectedRoutes.filter((route) =>
    Boolean(route.backupForInstanceId?.trim() || route.backupForRouteId?.trim()),
  );
  const orderedSelected = sortSelectedRoutesByExecutionOrder(selectedRoutes);
  const minimumRecovery = normalizeMinimumRecoveryTimeSeconds(
    args.draft.routeGroups.minimumRecoveryTimeSeconds,
  );
  const successorPolicy = buildRouteSuccessorPolicy({
    routes: orderedSelected,
    graph:
      args.draft.routeGroups.routeRelationGraph ?? emptyShiftRouteRelationGraph(),
    throughAnchors:
      args.draft.routeGroups.throughAnchors ?? emptyShiftRouteThroughAnchorsDraft(),
    minimumRecoveryTimeSeconds: minimumRecovery,
  });
  if (!successorPolicy.valid) {
    pushIssue(errors, {
      code: 'ROUTE_SUCCESSOR_POLICY_INVALID',
      severity: 'error',
      message:
        `路線關聯圖尚未形成可用的已驗證交路（${successorPolicy.issue ?? 'UNKNOWN'}），`
        + '已停止排班，避免退回執行順序產生跨停靠點錯接',
      detail: {
        algorithm: successorPolicy.algorithm,
        policyIssue: successorPolicy.issue,
      },
    });
    return null;
  }
  // 掛車／輪替／補完一律走策略輪替環（圖模式＝參考導通；否則＝執行順序）
  const passengerRoutes = successorPolicy.rotationRoutes;
  const maintenanceBody =
    args.draft.maintenanceTask.skipped ? null : (args.maintenanceTaskBody ?? null);
  const slackBySection = parseMaintenanceEntrySlackBySection(
    args.draft.maintenanceTask.entrySlackBySection,
  );
  const emptyIntervalMainlineSlackSeconds = parseEmptyIntervalMainlineSlackSeconds(
    args.draft.timeTemplate.emptyIntervalMainlineSlackSeconds,
  );
  const emptyRanges = listEmptyAttributeMinuteRanges(template.intervals);
  const firstTripOrigins = args.firstTripOrigins ?? [];
  const yardRotationExitByTaskType = buildYardRotationExitByTaskType({
    origins: firstTripOrigins,
    maintenanceBody,
  });

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
      minimumRecoveryTimeSeconds: minimumRecovery,
      errors,
      successorPolicy,
      warnings,
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
    deferNonPassengerTasksAfterCycleSpill(nonPassengerTasks, generatedPassenger);
    confirmedTasks = [
      ...nonPassengerTasks.filter((task) => task.durationMinutes > 0),
      ...generatedPassenger,
    ];
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
    const dispatchWindowTasks = templateTasks.filter((task) => {
      if (task.taskType === 'passenger') return true;
      if (task.taskType !== 'standby') return false;
      // 純機動列不派正線；僅「機動之後仍有正線」才把機動當可派視窗
      return isStandbyDispatchableForMainline(templateTasks, task);
    });
    for (const pTask of dispatchWindowTasks) {
      const startSec = pTask.startMinute * 60;
      const endSec = (pTask.startMinute + pTask.durationMinutes) * 60;
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
        // 讓渡餘裕只可占用接下整備開頭，不可提前裁前一整備尾端出車。
        dispatchStartSecond: startSec,
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
      nonPassengerTasks,
      templateTasks,
      yardRotationExitByTaskType,
      successorPolicy,
      warnings,
    });

    deferNonPassengerTasksAfterCycleSpill(nonPassengerTasks, passengerTasks);
    confirmedTasks = [
      ...nonPassengerTasks.filter((task) => task.durationMinutes > 0),
      ...passengerTasks,
    ];
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

  // v2 起班脈衝在掛車時已原子化展開完整 route chain；不可再以任務開始時間
  // 掃描「補完」，否則跨入整備開頭的同一輪會被誤判成中斷並重複插入回程。

  return {
    shiftId: args.shiftId,
    scheduleRowCount: template.scheduleRowCount,
    confirmedTasks,
    intervals: template.intervals,
    attributes: template.attributes,
    passengerRoutes,
    selectedRoutes,
    backupRoutes,
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
    firstTripOrigins,
    successorPolicy,
  };
}
