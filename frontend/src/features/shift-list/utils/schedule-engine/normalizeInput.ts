import type { PointTopology } from '../../../map-editor/types/pointTopology';
import type { MapAreaObject } from '../../../map-editor/types/area';
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
  buildYardExitStationOptionsByTaskType,
  buildYardRotationExitByTaskType,
  isStandbyDispatchableForMainline,
  resolveContiguousYardBusyUntilMinute,
  resolveYardPostTaskPolicy,
  shouldApplyYardExitRotationAlign,
} from '../maintenancePostTaskPolicy';
import { resolveRouteClearanceInsertGapSeconds } from '../stationClearanceInsert';
import { isWorkYardTaskType, minimumYardWorkSeconds } from '../yardWorkMinimum';
import { extractFacilityMapCodes } from '../maintenanceFirstTripOrigins';
import { FACILITY_SECTION_BY_TASK_TYPE, nodeMatchesMoveCardCodes } from '../moveCardShared';
import { findTopologyPath } from '../findTopologyPath';
import { resolveEffectiveRouteTravelSeconds } from '../stationLegTravel';
import type { TaskTypeKey } from '../../../time-templates/types/editor';
import {
  sortSelectedRoutesByExecutionOrder,
  normalizeMinimumRecoveryTimeSeconds,
  normalizeCollisionProtectionSeconds,
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
import type { FeasibilityIssue, ServicePulseRecord, ServicePulseStatus } from './types';
import { pushIssue, secondToMinute } from './types';
import {
  generateDirectionalDeparturesFromHeadway,
  TIMETABLE_GENERATION_ALGORITHM,
  type DirectionalHeadwayDeparture,
} from './generateDepartures';
import {
  buildRouteSuccessorPolicy,
  estimatePolicyCycleSeconds,
  resolveLockedRotationMinSeconds,
  resolveNextInstanceId,
  resolveRouteIndexInRotation,
  resolveStartInstanceId,
  ROUTE_SUCCESSOR_ALGORITHM_GRAPH,
  type RouteSuccessorPolicy,
} from './routeSuccessorPolicy';
import { emptyShiftRouteRelationGraph } from '../routeRelationGraph';
import { emptyShiftRouteThroughAnchorsDraft } from '../routeRelationThroughCycles';
import { isStandbyLikeTaskType } from '../../../time-templates/types/editor';

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
  nextMaintenanceEntrySeconds?: ReadonlyMap<string, number>;
  /**
   * 這個視窗是「待命，而且待命一結束就接正線」時，記待命的結束秒。
   * 交班時要去充電的車必須提早收班（充電準時開始、不縮短），接手的車如果等到待命整點
   * 結束才出來，中間的脈衝就沒有車開。待命是最不在乎早幾分鐘結束的整備，所以允許它的
   * 尾巴提早結束來接班——只在沒有其他車能開時才用，見 assignDirectionalDepartures。
   */
  standbyEndSecond?: number;
  /** 待命提早結束的額度，除了「一整輪」之外再加的秒數（交班車進充電要預留的時間） */
  standbyReleaseExtraSeconds?: number;
};

export type EngineInput = {
  shiftId?: string;
  scheduleRowCount: number;
  confirmedTasks: ScheduleTask[];
  /** 時刻表要求的班距脈衝總數＝服務需求的分母（承接率用）。非範本模式為 0。 */
  servicePulseDemand: number;
  /** 應開服務明細（每個脈衝的掛車結果）；非範本模式為空陣列 */
  servicePulses: ServicePulseRecord[];
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  passengerRoutes: ShiftScheduleSelectedRoute[];
  /** 主路線（輪替／班距）；不含僅掛 backupFor* 的草稿相容列 */
  selectedRoutes: ShiftScheduleSelectedRoute[];
  /**
   * 草稿相容：曾以 backupFor* 標的路線。站位／開站候選會併入 successorPolicy.routesByInstanceId；
   * 真正下一跳仍以關聯圖優／次邊為準，不是「誰的備用槽」。
   */
  backupRoutes: ShiftScheduleSelectedRoute[];
  /** 模板原本的整備任務（讓渡縮短前的副本），給最終驗證核對整備沒有被刪或壓過頭 */
  templateYardTasks?: ScheduleTask[];
  maintenanceBody: Record<string, unknown> | null;
  maintenanceEntrySlackBySection: MaintenanceEntrySlackBySection;
  emptyIntervalMainlineSlackSeconds: number;
  minimumRecoveryTimeSeconds: number;
  /**
   * 碰撞保護時間（秒）：後車到站不得早於前車實際離站 + 2 × 此值。
   * 站位求解、班距補疏／修復、整備後調度班次、最終驗證共用同一個值。
   */
  collisionProtectionSeconds: number;
  /** 整備類型 → 出場站 stationId；驗證「整備後第一段班次接不接得上」要用 */
  yardRotationExitByTaskType: Partial<Record<TaskTypeKey, string>>;
  /** 各整備類型「車可能停在哪幾站」；驗證「車在不在那一站」用 */
  yardExitStationOptionsByTaskType: Partial<Record<TaskTypeKey, string[]>>;
  turnaroundLimitSeconds: number | null;
  passengerTimetableMode: PassengerTimetableMode;
  timetableGenerationAlgorithm?: string;
  /** 目前啟用地圖拓樸抽出的首班起點站（設施→停靠） */
  firstTripOrigins: MaintenanceFirstTripOrigin[];
  /** Step 4 關聯圖／折返錨點繼任策略 */
  successorPolicy: RouteSuccessorPolicy;
  /**
   * 完整路網拓樸。整備／調度入廠卡要自己找「站 → 設施」的路徑
   * （設施之間 N×M 種組合，不可能要使用者一條條畫），只有 firstTripOrigins 不夠。
   */
  pointTopology?: PointTopology | null;
  /**
   * 地圖場域管理模組的 Area 容器清單（含各 Area 底下的 facilities）。
   * 整備挑位置時用來偏好「同一個場區」（排序權重）。移動時間一律照拓樸路徑算：同區域但
   * 沒有路徑、或路徑缺行駛時間，就是到不了，不當 0 秒（2026-09-28）。
   */
  areas?: MapAreaObject[] | null;
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
  /** 完整拓樸；入廠卡尋路用 */
  pointTopology?: PointTopology | null;
  /** 地圖場域管理模組的 Area 容器清單；整備間轉場判斷同區域用 */
  areas?: MapAreaObject[] | null;
  /**
   * 掛脈衝時，本輪某一腿晚於既有同向班次卻貼太近：預設直接放棄這一台車（舊行為）；
   * 打開則改成「再往後推到所需間隔」繼續試（仍守脈衝期限、整備視窗、完整交路）。
   * 會改變後面所有脈衝的承接，好壞要看整張班表——由呼叫端在副本上比較後決定用不用。
   */
  allowBumpPastEarlierSameRoute?: boolean;
  /**
   * 派車回饋限制：某個脈衝不能派給某一列。由上一次完整生成「移動卡排不出來、或派出去的班次
   * 被刪掉」推出來（見 generate.ts 的 deriveAssignmentCuts），再派一次車時遵守。
   */
  assignmentCuts?: AssignmentCut[];
  /**
   * 待命提早結束接班（預設關）。交班時要去充電的車必須提早收班，接手的車若等到待命整點結束
   * 才出來，交班前的脈衝就沒有車開；打開後「待命後緊接正線」的車可以提早出來接。
   *
   * 預設關的原因（2026-11-14 實測，地圖 v0.5）：派車排得出來，但交班那幾分鐘線上多兩台車，
   * 接手車要到發車月台的路（正線空檔、充電區唯一的出入口）排不開——多開 20 班，硬錯誤卻從
   * 4 筆變 10 筆。交班的進出順序沒有解決之前打開只會把「沒車開」換成「月台碰撞」。
   */
  allowStandbyEarlyRelease?: boolean;
  /**
   * 同樣準時的時候，在線車優先於從整備區叫出來的新車（預設開；給 false 才關）。
   * 見 assignDirectionalDepartures 的 freshFromYard。
   */
  preferCirculatingVehicles?: boolean;
};

/**
 * 派車回饋限制：這個脈衝不要派給這一列（reason 寫進拒絕原因）。
 * row 為 {@link STANDBY_RELEASE_CUT_ROW} 時不是指某一列，而是「這個脈衝不要用待命提早接班」。
 */
export type AssignmentCut = { pulseId: string; row: number; reason: string };

/** 沒有第 0 列：拿來表示「這個脈衝不要用待命提早接班」的限制 */
export const STANDBY_RELEASE_CUT_ROW = 0;

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
 * 圖模式只沿關聯圖短邊走，不得用偏好路徑無邊繞回。
 */
function buildPlannedCycleLegs(args: {
  startRouteIndex: number;
  startSecond: number;
  passengerRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  useMinimumOccupancy?: boolean;
  successorPolicy?: RouteSuccessorPolicy;
}): PlannedCycleLeg[] {
  const {
    startRouteIndex,
    startSecond,
    passengerRoutes,
    minimumRecoveryTimeSeconds,
    useMinimumOccupancy = false,
    successorPolicy,
  } = args;

  if (
    successorPolicy
    && successorPolicy.valid
    && successorPolicy.algorithm === ROUTE_SUCCESSOR_ALGORITHM_GRAPH
  ) {
    const startRoute = passengerRoutes[startRouteIndex];
    if (!startRoute) return [];
    const maxHops = Math.max(1, successorPolicy.canonicalCycleInstanceIds.length);
    const legs: PlannedCycleLeg[] = [];
    let cursor = startSecond;
    let previousRoute: ShiftScheduleSelectedRoute | null = null;
    let currentId = resolveSelectedRouteInstanceId(startRoute);

    for (let hop = 0; hop < maxHops; hop += 1) {
      const route =
        successorPolicy.routesByInstanceId.get(currentId)
        ?? (hop === 0 ? startRoute : null);
      if (!route) break;
      if (previousRoute) {
        cursor = snapUpToClockAlignSeconds(
          cursor
            + resolveInterTripGapSeconds({
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
      const routeIndex = Math.max(
        0,
        resolveRouteIndexInRotation(successorPolicy, currentId),
      );
      legs.push({
        route,
        routeIndex: routeIndex >= 0 ? routeIndex : hop,
        startSecond: cursor,
        occupancySeconds,
        endSecond,
      });
      cursor = endSecond;
      previousRoute = route;
      // 成輪優先：優先邊斷開時改走次要短邊，不可半輪收在 ST。
      const next =
        resolveNextInstanceId(successorPolicy, currentId)
        ?? resolveNextInstanceId(successorPolicy, currentId, {
          allowSecondary: true,
        });
      if (!next) break;
      currentId = next.instanceId;
    }
    return legs;
  }

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

/**
 * 長整備的讓渡門檻：超過這個時長，才允許正線吃它的開頭。
 *
 * 使用者（2026-08-18）：「正線完的那個整備如果超過一小時，可以讓渡他一次」。
 * 短整備（例如 30 分鐘的行檢）本來就沒有多少可讓的餘地，讓了反而排擠整備本身。
 */
const LONG_YARD_YIELD_THRESHOLD_SECONDS = 3600;

/**
 * 正線讓渡餘裕：一次 ＝ 一個完整輪迴。
 *
 * <strong>為什麼不是固定分鐘數。</strong>原本五個整備區段各設一個
 * <code>entrySlackSeconds</code>（預設一律 600 秒）。同一個數字套在 30 分鐘的行檢
 * 與 4.4 小時的待命上：對行檢是三分之一、太寬鬆；對待命連 4% 都不到、太吝嗇——
 * 而待命正是最不在乎晚幾分鐘開始的那一種。實測（2026-08-18）有 6 則「整輪跑不完」
 * 與 9 則「最早可發已超出正線視窗」的拒絕，車其實跑得完，只是會多吃整備開頭幾分鐘。
 *
 * <strong>改成以輪迴為單位。</strong>使用者（2026-08-18）：「一次就是一條路線的
 * 來回……就是一個輪迴」。讓渡的意義是「讓這台車把手上這一輪跑完再進場」，額度
 * 自然就是一輪的時間，不需要另外設定，也不會多讓一秒。
 *
 * <strong>「一次」的邊界由既有機制保證。</strong>額度是「整備開始 + 一輪」這條
 * 固定線（見 cycleViolatesMaintenanceEntryPolicy），不是每掛一輪就往後推一次；
 * 第二輪的結束時刻一樣要落在同一條線之前，因此天然只讓得出一輪。
 */
function resolveYardEntrySlackSeconds(args: {
  taskType: ScheduleTask['taskType'];
  yardDurationSeconds: number;
  lockedRotationSeconds: number | null;
  slackBySection: MaintenanceEntrySlackBySection;
}): number {
  const { taskType, yardDurationSeconds, lockedRotationSeconds, slackBySection } = args;
  if (
    lockedRotationSeconds != null
    && lockedRotationSeconds > 0
    && yardDurationSeconds > LONG_YARD_YIELD_THRESHOLD_SECONDS
  ) {
    // 使用者把設定值調得比一輪還大時，照設定值（2026-11-15：設定值加大要有作用）
    return Math.max(lockedRotationSeconds, resolveMaintenanceEntrySlackSeconds(taskType, slackBySection));
  }
  // 短整備、或沒有鎖定導通組合（算不出一輪要多久）：沿用各區段既有設定
  return resolveMaintenanceEntrySlackSeconds(taskType, slackBySection);
}

function resolveNextMaintenanceAfterWindow(
  row: number,
  windowEndSecond: number,
  nonPassengerTasks: ScheduleTask[],
  slackBySection: MaintenanceEntrySlackBySection,
  lockedRotationSeconds: number | null,
  maintenanceBody: Record<string, unknown> | null,
  templateTasks: ReadonlyArray<ScheduleTask> = [],
): { startSecond: number; entrySlackSeconds: number; taskType: string } | null {
  const sameDayNext = nonPassengerTasks
    .filter(
      (task) =>
        task.rowIndex === row
        && minuteToSecondApprox(task.startMinute) >= windowEndSecond - 1e-9,
    )
    .sort((a, b) => a.startMinute - b.startMinute)[0];
  /**
   * 一天是循環的：這個時段之後當天已經沒有任何任務時，「下一個整備」就是隔天最早的那一個
   * （例：正線 22:00–24:00 之後接 00:00 的充電）。只看當天的話，日尾的時段會被當成後面
   * 什麼都沒有，最後一輪就跑過午夜、吃掉隔天一開始的充電。
   */
  const wrappedNext = sameDayNext
    ? null
    : resolveFirstTaskOfNextDay(row, windowEndSecond, nonPassengerTasks, templateTasks);
  const next = sameDayNext ?? wrappedNext;
  if (!next) return null;
  const dayOffsetSeconds = wrappedNext ? SECONDS_PER_DAY : 0;
  const yardDurationSeconds = Math.round(next.durationMinutes * 60);
  const allowance = resolveYardEntrySlackSeconds({
    taskType: next.taskType,
    yardDurationSeconds,
    lockedRotationSeconds,
    slackBySection,
  });
  /**
   * 額度（手填 H 或長整備的一輪）是「最多能占多少開頭」；占完之後整備仍要留下最低工作時間，
   * 不能被壓成零（白皮書 YARD-03、YARD-04）。所以實際可用的額度不超過「整備長度 − 最低工作時間」，
   * 會吃光整備的那一輪在這裡就不是合法候選。
   */
  /**
   * 充電跟其他整備一樣照「正線優先讓渡餘裕」讓（使用者 2026-11-15：以正線為主，整備任務設定的額度
   * 每一種整備都適用）。2026-11-13 曾被改成充電額度一律 0，結果每次有車離線去充電，離線前那一輪
   * 都沒有車開。
   */
  const keepSeconds = minimumYardWorkSeconds(next.taskType, maintenanceBody);
  return {
    startSecond: minuteToSecondApprox(next.startMinute) + dayOffsetSeconds,
    taskType: next.taskType,
    entrySlackSeconds: Math.max(0, Math.min(allowance, yardDurationSeconds - keepSeconds)),
  };
}

const SECONDS_PER_DAY = 24 * 3600;

/**
 * 這個時段是該時間線當天的最後一件事時，回傳隔天最早的那個整備任務；否則回 null。
 * 隔天最早的是正線（或當天後面還有別的任務）就不算——那不是「時段結束後接整備」。
 */
function resolveFirstTaskOfNextDay(
  row: number,
  windowEndSecond: number,
  nonPassengerTasks: ReadonlyArray<ScheduleTask>,
  templateTasks: ReadonlyArray<ScheduleTask>,
): ScheduleTask | null {
  const rowTemplate = templateTasks.filter((task) => task.rowIndex === row);
  if (rowTemplate.length === 0) return null;
  const somethingLaterToday = rowTemplate.some(
    (task) => minuteToSecondApprox(task.startMinute) >= windowEndSecond - 1e-9,
  );
  if (somethingLaterToday) return null;
  const firstStartMinute = Math.min(...rowTemplate.map((task) => task.startMinute));
  const firstYard = nonPassengerTasks
    .filter((task) => task.rowIndex === row)
    .sort((a, b) => a.startMinute - b.startMinute)[0];
  if (!firstYard || firstYard.startMinute > firstStartMinute + 1e-9) return null;
  // 隔天那個任務要排在這個時段結束之後；時段自己就跨過午夜、蓋到它的話不處理
  if (minuteToSecondApprox(firstYard.startMinute) + SECONDS_PER_DAY < windowEndSecond - 1e-9) return null;
  return firstYard;
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

function isAcceptablePlannedCycleLength(
  legs: PlannedCycleLeg[],
  routeCount: number,
  successorPolicy?: RouteSuccessorPolicy,
): boolean {
  if (legs.length === 0) return false;
  if (
    successorPolicy?.valid
    && successorPolicy.algorithm === ROUTE_SUCCESSOR_ALGORITHM_GRAPH
  ) {
    // 關聯圖同樣必須走完 canonical 全輪（例如 NT→TS→ST→TN），
    // 不得因邊斷開或 map 缺員就掛出半輪進充電。
    const expected = Math.max(
      1,
      successorPolicy.canonicalCycleInstanceIds.length || routeCount,
    );
    return legs.length === expected;
  }
  return legs.length === routeCount;
}

/**
 * 整備讓渡政策：
 *
 * 讓渡的本質是「<strong>整備開始時刻會往後移</strong>」，不是「正線可以在整備進行中偷跑」。
 * 車一路在外面跑，跑到超過原定整備開始時刻也沒關係（在餘裕內），整備就晚點開始
 * （開始往後推、結束鎖住不動、時長被壓縮）。真正不該發生的是
 * <strong>車已經進去整備了，卻又冒出一段正線</strong>。
 *
 * 所以只檢查兩件事：
 * - <strong>整輪必須在整備開始前發車</strong>——代表這台車在整備開始時就已經在路上了。
 *   中段各腿可以晚於整備開始，那只是同一台車還沒回來，整備本來就會等它。
 * - 整輪結束不得超過 nextMaintStart + entrySlack（讓渡餘裕上限）。
 *
 * 2026-08-08 更正：舊版檢查<strong>每一腿</strong>都不得晚於整備開始，等於把餘裕廢掉——
 * 一輪四腿只要總長超過「整備開始 − 發車時刻」，就必然有某一腿晚於整備開始而被擋，
 * 使用者設的 10 分鐘讓渡餘裕形同無效（實測 600 秒與 3000 秒產出完全相同）。
 */
function cycleViolatesMaintenanceEntryPolicy(args: {
  legs: PlannedCycleLeg[];
  nextMaintenanceStartSecond: number | null;
  entrySlackSeconds: number;
  nextMaintenanceEntrySeconds?: ReadonlyMap<string, number>;
}): string | null {
  const { legs, nextMaintenanceStartSecond } = args;
  if (nextMaintenanceStartSecond == null || legs.length === 0) return null;
  const maintStart = nextMaintenanceStartSecond;
  const latestEnd = maintStart + Math.max(0, args.entrySlackSeconds);

  const first = legs[0]!;
  if (first.startSecond + 1e-9 >= maintStart) {
    return (
      `整輪須於整備開始前發車`
      + `（${first.startSecond}s ≥ 整備 ${maintStart}s；車已進整備就得等整備做完才出來）`
    );
  }

  const last = legs[legs.length - 1]!;
  const entrySeconds = args.nextMaintenanceEntrySeconds?.get(last.route.stationIds.at(-1)?.trim() ?? '');
  // 讓渡額度是全部：跑完最後一輪再進到充電位，都要落在額度內（使用者 2026-11-15）
  if (entrySeconds != null && last.endSecond + entrySeconds > latestEnd + 1e-9) {
    return `整備前交路結束 ${last.endSecond}s，加恢復及最短合法入廠 ${entrySeconds}s，超過整備讓渡上限 ${latestEnd}s`;
  }
  if (last.endSecond > latestEnd + 1e-9) {
    return `整輪結束 ${last.endSecond}s 超過整備讓渡上限 ${latestEnd}s`;
  }
  return null;
}

function isHeadwayBlockedRejection(reason: string | undefined): boolean {
  if (!reason) return false;
  return (
    reason.startsWith('最早可發延遲')
    || reason === '最早可發已跨下一脈衝'
    || reason.startsWith('同方向班距不足')
    || reason.includes('壓低同方向班距')
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
 * - 視窗前若為行檢／充電／待命且拓樸有明確出場站，且該列之後仍有正線模板，
 *   輪替相位才對齊該站起點路線（例：行檢出場 T3 → 首班 TN／TS）。
 *   純待命、無後續正線時不對齊、不強制跑出場方向。
 * - 班距地板只看候選發車之前的同方向班次，避免被已掛但更晚的交路中段腿卡死。
 * - 待命視窗可視為可派正線，但僅限「該待命開始後仍有正線視窗」的列
 *   （正線優先，不代表必須占滿待命；純待命列不派正線）。
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
  /** 整備類型 → 出場站 stationId（行檢／充電／待命） */
  yardRotationExitByTaskType?: Partial<Record<TaskTypeKey, string>>;
  /** Step 4 繼任策略；提供時以策略決定開輪相位與整輪估時 */
  successorPolicy?: RouteSuccessorPolicy;
  /** 掛不上班距需求時留下可觀測 issue，不再靜默丟棄 */
  warnings?: FeasibilityIssue[];
  /** 見 NormalizeInputArgs.allowBumpPastEarlierSameRoute */
  allowBumpPastEarlierSameRoute?: boolean;
  /** 見 NormalizeInputArgs.assignmentCuts */
  assignmentCuts?: AssignmentCut[];
  /** 應開服務明細：每個脈衝寫一筆掛車結果（含沒車開的原因），不靜默丟棄 */
  pulseLedger?: ServicePulseRecord[];
  /** 見 NormalizeInputArgs.allowStandbyEarlyRelease */
  allowStandbyEarlyRelease?: boolean;
  /** 見 NormalizeInputArgs.preferCirculatingVehicles */
  preferCirculatingVehicles?: boolean;
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
    allowBumpPastEarlierSameRoute = false,
    pulseLedger,
    assignmentCuts = [],
    allowStandbyEarlyRelease = false,
    preferCirculatingVehicles = true,
  } = args;
  const cutsByPulse = new Map<string, Map<number, string>>();
  for (const cut of assignmentCuts) {
    const byRow = cutsByPulse.get(cut.pulseId) ?? new Map<number, string>();
    byRow.set(cut.row, cut.reason);
    cutsByPulse.set(cut.pulseId, byRow);
  }
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
   * 行檢／充電／待命後「調撥開輪」相對前車的插入間距：
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
      || isStandbyLikeTaskType(preceding.taskType)
    );
  };

  /**
   * 班距地板只看「候選發車之前」的同方向班次。
   * 行檢調撥開輪改用車站清除間距；一般營運仍用目標班距。
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
  /** 起點落在「待命後緊接正線」的待命裡＝這一班是待命提早結束接的 */
  const startsInsideReleasableStandby = (row: number, startSecond: number): boolean => {
    const win = findWindow(row, startSecond);
    return win?.standbyEndSecond != null && startSecond < win.standbyEndSecond - 1e-9;
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
    // 充電／行檢／待命／保養無明確出場，或整備後無正線：延續進入整備前的輪替相位
    return ((rotationIndex[row]! % routeCount) + routeCount) % routeCount;
  };

  for (let index = 0; index < departures.length; index += 1) {
    const departure = departures[index]!;
    const pulseId = servicePulseIdOf(departure);
    /** 這個脈衝沒有車開：寫進明細，並留一則可觀測的 issue（擋部署，見 PUBLISH_BLOCKING_CODES） */
    const recordUnserved = (
      status: Exclude<ServicePulseStatus, 'assigned'>,
      reason: string,
      rowRejections?: Record<string, string>,
    ) => {
      pulseLedger?.push({
        pulseId,
        departureSecond: departure.startSecond,
        headwaySeconds: departure.headwaySeconds,
        intervalId: departure.intervalId,
        intervalName: departure.intervalName,
        routeId: departure.routeId,
        status,
        reason,
        ...(rowRejections ? { rowRejections } : {}),
      });
      if (status === 'no_service_window' || !warnings) return;
      pushIssue(warnings, {
        code: 'UNSERVED_SERVICE_PULSE',
        severity: 'warning',
        message:
          `班距需求 ${formatClockSecond(departure.startSecond)} 無可用車承接（${reason}），`
          + '該時段實際 PPHPD 將低於目標',
        detail: {
          pulseId,
          departureSecond: departure.startSecond,
          headwaySeconds: departure.headwaySeconds,
          intervalId: departure.intervalId,
          intervalName: departure.intervalName,
          status,
          reason,
          ...(rowRejections ? { rowRejections } : {}),
        },
      });
    };
    const pulseRoute = passengerRoutes[departure.routeIndex];
    if (!pulseRoute || pulseRoute.routeId !== departure.routeId) {
      recordUnserved('unserved', `脈衝起班路線 ${departure.routeId} 不在目前的路線執行順序裡`);
      continue;
    }

    // 下一脈衝邊界：延後若跨越此線，應留給下一脈衝，避免雙掛
    const nextPulseSecond = pulseSecond(departure);

    /**
     * 週期脈衝（routeIndex 恒為 0）代表「一台車開一整輪」。
     * 行檢／充電／待命出場後相位可能落在 TN 等非 0 起點；必須依該車相位
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
       * 行檢調撥：requiredHeadway 已是清除間距（通常遠小於營運班距）。
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
    /** strict＝一般掛車；recovery＝漏掛後放寬跨脈衝／延後上限再搶一次 */
    const hangPolicy = {
      maxDelayScale: 1,
      pulseSlackSeconds: 0,
      /** 待命提早結束接班：一般與壓快都掛不上之後才打開 */
      standbyRelease: false,
    };
    /**
     * 這個起點可不可以用「待命提早結束」承接。條件：
     * 1. 待命之後緊接正線（視窗有 standbyEndSecond）。
     * 2. 待命不能被吃光（至少留一個排班刻度）。
     * 3. 最多提早「一整輪＋交班車進充電要預留的時間」：這正好是交班車開不了的那一段；
     *    再早出來，車開完一輪還接不上自己的正線時段，只會停在月台上占位置。
     */
    const standbyReleaseAllowed = (
      row: number,
      win: ActivePassengerWindow,
      startSecond: number,
    ): boolean => {
      if (!hangPolicy.standbyRelease || win.standbyEndSecond == null) return false;
      if (startSecond >= win.standbyEndSecond) return false;
      if (startSecond < win.startSecond + SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS) return false;
      const legs = buildPlannedCycleLegs({
        startRouteIndex: resolveStartRouteIndex(row),
        startSecond,
        passengerRoutes,
        minimumRecoveryTimeSeconds,
        useMinimumOccupancy: false,
        successorPolicy,
      });
      const last = legs[legs.length - 1];
      if (!last) return false;
      const leadSeconds = last.endSecond - startSecond + (win.standbyReleaseExtraSeconds ?? 0);
      return win.standbyEndSecond - startSecond <= leadSeconds;
    };

    const evaluateRow = (
      row: number,
      earliestFree: number,
      winAtPulse: ActivePassengerWindow,
      compressPreviousTo: number | null,
      compressionPenalty: number,
    ): void => {
      const cutReason = cutsByPulse.get(pulseId)?.get(row);
      if (cutReason) {
        rejectionByRow.set(row, `回饋限制：${cutReason}`);
        return;
      }
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
      let startSecond = Math.max(provisionalEarliest, gate.headwayFloor);
      // 整備連串（保養→行檢…）內不得掛正線：起點若落在串內，硬推到串尾。
      // 例外：待命接正線、而且沒有其他車能開時，待命的尾巴可以提早結束（standbyReleaseAllowed）
      const releasedFromStandby = standbyReleaseAllowed(row, winAtPulse, startSecond);
      if (!releasedFromStandby) {
        const busyUntilMinute = resolveContiguousYardBusyUntilMinute(
          nonPassengerTasks,
          row,
          secondToMinute(startSecond),
        );
        if (
          busyUntilMinute != null
          && startSecond < minuteToSecondApprox(busyUntilMinute) - 1e-9
        ) {
          startSecond = snapUpToClockAlignSeconds(
            minuteToSecondApprox(busyUntilMinute),
          );
        }
      }
      const delay = startSecond - departure.startSecond;
      const maxDelaySeconds = Math.max(
        0,
        Math.round(gate.maxDelaySeconds * hangPolicy.maxDelayScale),
      );
      if (delay > maxDelaySeconds) {
        rejectionByRow.set(
          row,
          `最早可發延遲 ${delay}s，超過上限 ${maxDelaySeconds}s`,
        );
        return;
      }
      const pulseDeadline =
        nextPulseSecond + Math.max(0, hangPolicy.pulseSlackSeconds);
      if (startSecond >= pulseDeadline) {
        rejectionByRow.set(
          row,
          hangPolicy.pulseSlackSeconds > 0
            ? '最早可發已超出補掛允許的跨脈衝範圍'
            : '最早可發已跨下一脈衝',
        );
        return;
      }
      if (startSecond >= winAtPulse.endSecond || !findWindow(row, startSecond)) {
        rejectionByRow.set(row, '最早可發已超出正線視窗');
        return;
      }
      // 推過整備串後仍不得坐落任一整備內（銜接點以外）
      if (!releasedFromStandby) {
        const busyUntilMinute = resolveContiguousYardBusyUntilMinute(
          nonPassengerTasks,
          row,
          secondToMinute(startSecond),
        );
        if (
          busyUntilMinute != null
          && secondToMinute(startSecond) < busyUntilMinute - 1e-9
        ) {
          rejectionByRow.set(row, '最早可發仍落在整備任務內');
          return;
        }
      }

      // 整輪：開輪腿若為行檢調撥用清除間距；其後各腿仍守營運班距。
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
        successorPolicy,
      });
      if (!isAcceptablePlannedCycleLength(plannedLegs, routeCount, successorPolicy)) {
        rejectionByRow.set(row, '無法展開完整交路占用');
        return;
      }
      {
        let conflict = cycleViolatesSameRouteHeadway({
          legs: plannedLegs,
          trackedLegs,
          requiredHeadwayFor: headwayForLeg,
        });
        // 被已掛、但更晚的同向班次卡住時：往後推到對方＋所需班距（承接脈衝優先於準點）
        for (let bumpAttempt = 0; conflict && bumpAttempt < 24; bumpAttempt += 1) {
          let neededBump = 0;
          for (let legIndex = 0; legIndex < plannedLegs.length; legIndex += 1) {
            const leg = plannedLegs[legIndex]!;
            const required = headwayForLeg(leg.route, leg, legIndex);
            if (required <= 0) continue;
            for (const other of trackedLegs) {
              if (other.routeId !== leg.route.routeId) continue;
              const gap = Math.abs(leg.startSecond - other.startSecond);
              if (gap + 1e-9 >= required) continue;
              // 晚於對方卻貼太近：預設放棄；選配打開時同一個公式就是「再晚到所需間隔」
              if (leg.startSecond > other.startSecond + 1e-9 && !allowBumpPastEarlierSameRoute) {
                neededBump = -1;
                break;
              }
              neededBump = Math.max(
                neededBump,
                other.startSecond + required - leg.startSecond,
              );
            }
            if (neededBump < 0) break;
          }
          if (neededBump < 0) break;
          if (neededBump <= 1e-9) break;
          startSecond = snapUpToClockAlignSeconds(startSecond + neededBump);
          const bumpedDelay = startSecond - departure.startSecond;
          if (bumpedDelay > maxDelaySeconds) {
            rejectionByRow.set(
              row,
              `同方向班距不足且前推延遲 ${bumpedDelay}s 超過上限 ${maxDelaySeconds}s`,
            );
            return;
          }
          if (startSecond >= pulseDeadline) {
            rejectionByRow.set(row, '同方向班距前推已跨下一脈衝');
            return;
          }
          if (startSecond >= winAtPulse.endSecond || !findWindow(row, startSecond)) {
            rejectionByRow.set(row, '同方向班距前推已超出正線視窗');
            return;
          }
          plannedLegs = buildPlannedCycleLegs({
            startRouteIndex,
            startSecond,
            passengerRoutes,
            minimumRecoveryTimeSeconds,
            useMinimumOccupancy: useMinimumCycle,
            successorPolicy,
          });
          if (!isAcceptablePlannedCycleLength(plannedLegs, routeCount, successorPolicy)) {
            rejectionByRow.set(row, '無法展開完整交路占用');
            return;
          }
          conflict = cycleViolatesSameRouteHeadway({
            legs: plannedLegs,
            trackedLegs,
            requiredHeadwayFor: headwayForLeg,
          });
        }
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
        if (startSecond + cycleNeed > latestAllowedEnd || cycleViolatesMaintenanceEntryPolicy({ legs: plannedLegs, ...winAtPulse })) {
          const minimumLegs = buildPlannedCycleLegs({
            startRouteIndex,
            startSecond,
            passengerRoutes,
            minimumRecoveryTimeSeconds,
            useMinimumOccupancy: true,
            successorPolicy,
          });
          const minimumOk = isAcceptablePlannedCycleLength(
            minimumLegs,
            routeCount,
            successorPolicy,
          );
          const minimumEnd =
            minimumOk
              ? minimumLegs[minimumLegs.length - 1]!.endSecond
              : Number.POSITIVE_INFINITY;
          const minimumConflict =
            minimumOk
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

      // 一律守整備讓渡：可借開頭結束，但任何一腿不得在整備開始後發車。
      {
        const entryPolicyViolation = cycleViolatesMaintenanceEntryPolicy({
          legs: plannedLegs,
          nextMaintenanceStartSecond: winAtPulse.nextMaintenanceStartSecond,
          entrySlackSeconds: winAtPulse.entrySlackSeconds,
          nextMaintenanceEntrySeconds: winAtPulse.nextMaintenanceEntrySeconds,
        });
        if (entryPolicyViolation) {
          rejectionByRow.set(row, entryPolicyViolation);
          return;
        }
      }

      /**
       * 同樣準時的時候，在線車優先。
       *
       * 這個時段還沒跑過任何一輪的車，是要從整備區叫出來的車。兩台車都能準時（延遲相同）接這一班
       * 時，先給已經在線上跑的那台。以前同分是比「誰空得比較久」，結果永遠是還在整備區的新車贏：
       * 新車一上線就把班次拿光，原本在線的車回到終點站沒有班可發，停在月台上等好幾分鐘，後面進站
       * 的車就撞上（2026-11-15 實測 14:00：三班全給新車，在線的兩台各在月台停 8 分鐘）。
       *
       * 只當同分時的先後，不拿延遲去換：試過「在線車晚兩分鐘以內也優先」，整天班次平均晚 87 秒、
       * 夜間晚到 10 分鐘，違反「照班表準時」。
       */
      const freshFromYard =
        preferCirculatingVehicles && earliestFree <= winAtPulse.dispatchStartSecond + 1e-9;
      const score =
        delay * 1e9
        + (freshFromYard ? 5e8 : 0)
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
            && win.dispatchStartSecond
              < nextPulseSecond + Math.max(0, hangPolicy.pulseSlackSeconds)
            && win.dispatchStartSecond - departure.startSecond
              <= Math.max(
                0,
                Math.round(probeGate.maxDelaySeconds * hangPolicy.maxDelayScale),
              ),
        ) ?? null;
      }
      if (!winAtPulse) {
        rejectionByRow.set(row, '脈衝時刻沒有正線可用視窗');
        return null;
      }
      const nextWindowKey = windowKey(winAtPulse);
      if (windowKeyByRow[row] !== nextWindowKey) {
        // 待命接正線的視窗：車是從待命的位置出來，相位看待命本身，不看待命之前那一段整備
        const phase = resolveWindowRotationPhase(
          row,
          winAtPulse.standbyEndSecond ?? winAtPulse.startSecond,
        );
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
    const scoreAllRows = (mode: 'normal' | 'compress') => {
      for (let row = 1; row <= scheduleRowCount; row += 1) {
        const winAtPulse = prepareRowWindow(row);
        if (!winAtPulse) continue;
        if (mode === 'normal') {
          const { freeAtUsed } = resolveFreeTimes(row);
          evaluateRow(row, freeAtUsed, winAtPulse, null, 0);
          continue;
        }
        const { freeAtMin, prevMinOccupancy, canCompressPrevious } =
          resolveFreeTimes(row);
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
    };

    scoreAllRows('normal');

    // 2) 僅當用均完全掛不上，才把上一趟壓到快再試
    if (chosenRow < 0) {
      scoreAllRows('compress');
    }

    // 2.5) 待命提早結束接班：值勤中的車都開不了，才讓「待命後接正線」的車早點出來。
    //      試排時這一班的提早接班排不出出廠移動（STANDBY_RELEASE_CUT_ROW）就不再用，回到整點才出來
    if (
      chosenRow < 0
      && allowStandbyEarlyRelease
      && !cutsByPulse.get(pulseId)?.has(STANDBY_RELEASE_CUT_ROW)
    ) {
      hangPolicy.standbyRelease = true;
      bestScore = Number.POSITIVE_INFINITY;
      rejectionByRow.clear();
      scoreAllRows('normal');
      if (chosenRow < 0) {
        scoreAllRows('compress');
      }
    }

    // 3) 補掛：尖峰／肩段放大延遲與跨脈衝餘裕後再評分（讓路前先擴門檻）
    if (chosenRow < 0) {
      const isPeakLikeHeadway = departure.headwaySeconds <= 240;
      const isShoulderLikeHeadway = departure.headwaySeconds >= 400;
      hangPolicy.maxDelayScale = isPeakLikeHeadway ? 3 : isShoulderLikeHeadway ? 4 : 2;
      hangPolicy.pulseSlackSeconds = Math.max(
        departure.headwaySeconds * (isPeakLikeHeadway ? 2 : isShoulderLikeHeadway ? 3 : 1),
        SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS * 6,
      );
      bestScore = Number.POSITIVE_INFINITY;
      rejectionByRow.clear();
      scoreAllRows('normal');
      if (chosenRow < 0) {
        scoreAllRows('compress');
      }
    }

    // 4) 同方向班距讓路：僅因班距擋住時，回推已掛衝突班次
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
        const yieldMaxDelay = Math.max(
          0,
          Math.round(gateWithoutBlocker.maxDelaySeconds * hangPolicy.maxDelayScale),
        );
        if (delay > yieldMaxDelay) continue;
        if (
          desiredStart
          >= nextPulseSecond + Math.max(0, hangPolicy.pulseSlackSeconds)
        ) {
          continue;
        }
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
          const entrySeconds = blockerWindow.nextMaintenanceEntrySeconds?.get(lastShifted.route.stationIds.at(-1)?.trim() ?? '') ?? 0;
          if (lastShiftedEnd + entrySeconds > latestAllowedEnd) continue;
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
              successorPolicy,
            });
            const minimumOk = isAcceptablePlannedCycleLength(
              minimumLegs,
              routeCount,
              successorPolicy,
            );
            const minimumEnd =
              minimumOk
                ? minimumLegs[minimumLegs.length - 1]!.endSecond
                : Number.POSITIVE_INFINITY;
            const minimumConflict =
              minimumOk
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
          successorPolicy,
        });
        if (!isAcceptablePlannedCycleLength(previewLegs, routeCount, successorPolicy)) continue;
        if (
          cycleViolatesMaintenanceEntryPolicy({
            legs: previewLegs,
            nextMaintenanceStartSecond: winAtPulse.nextMaintenanceStartSecond,
            entrySlackSeconds: winAtPulse.entrySlackSeconds,
            nextMaintenanceEntrySeconds: winAtPulse.nextMaintenanceEntrySeconds,
          })
        ) {
          continue;
        }
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
      const rowRejections = Object.fromEntries(rejectionByRow);
      if (hadDispatchableServiceWindow) {
        recordUnserved('no_vehicle', '沒有任何一列能合法承接', rowRejections);
      } else {
        recordUnserved('no_service_window', '這個時刻所有列都沒有正線視窗', rowRejections);
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
      successorPolicy,
    });
    if (!isAcceptablePlannedCycleLength(cycleLegs, routeCount, successorPolicy)) {
      recordUnserved('unserved', `運用 ${chosenRow} 展開的整輪交路腿數不完整`);
      continue;
    }
    {
      const winAtCommit = findWindow(chosenRow, chosenStartSecond);
      if (
        winAtCommit
        && cycleViolatesMaintenanceEntryPolicy({
          legs: cycleLegs,
          nextMaintenanceStartSecond: winAtCommit.nextMaintenanceStartSecond,
          entrySlackSeconds: winAtCommit.entrySlackSeconds,
          nextMaintenanceEntrySeconds: winAtCommit.nextMaintenanceEntrySeconds,
        })
      ) {
        recordUnserved('unserved', `運用 ${chosenRow} 這一輪會壓進下一段整備超過讓渡額度`);
        continue;
      }
    }

    /**
     * 整輪<strong>真正起班</strong>的時段，不一定是承接的那一脈所屬的時段。
     *
     * 脈衝時刻只是需求；這一輪被延後、推過時段邊界才真正開出去時，它從來沒有在舊
     * 時段出發過，不能沿用「已出發交路守舊時段班距」的待遇——那個待遇是給已經在
     * 路上、後來才被挪過邊界的腿。這種情形改記真正起班時所在時段，門檻取兩邊較嚴者
     * （跟跨時段第一脈同一條規則）。
     */
    const cycleOrigin = (() => {
      let governing: DirectionalHeadwayDeparture | null = null;
      for (const candidate of departures) {
        if (candidate.startSecond > chosenStartSecond + 1e-9) continue;
        if (!governing || candidate.startSecond > governing.startSecond) governing = candidate;
      }
      if (!governing || governing.intervalId === departure.intervalId) {
        return {
          intervalId: departure.intervalId,
          headwayTargetSeconds: departure.requiredGapFromPreviousSeconds,
        };
      }
      return {
        intervalId: governing.intervalId,
        headwayTargetSeconds: Math.max(
          departure.requiredGapFromPreviousSeconds,
          governing.headwaySeconds,
        ),
      };
    })();

    let finalTaskIndex = -1;
    let cycleAnchorTaskIndex = tasks.length;
    for (const [legIndex, leg] of cycleLegs.entries()) {
      finalTaskIndex = tasks.length;
      if (legIndex === 0) cycleAnchorTaskIndex = finalTaskIndex;
      tasks.push({
        /**
         * <strong>識別碼裡不放路線。</strong>站位求解會把個別班次改派到備用線
         * （STATION_BERTH_BACKUP_USED），但識別碼在整個產生流程中必須固定不變
         * ——先前發出的 warning 都以它指名這張卡，改了就對不回去。結果就是識別碼
         * 永遠停在<strong>改派前</strong>的路線，任何人拿它判讀實際跑哪一條都會判錯
         * （2026-08-18：一張實跑 TSB 的卡識別碼寫著 route_2，被讀成 TS，
         * 進而誤判成「TSB 接 ST」違反路線關聯圖）。
         *
         * 實際路線一律看卡片上的 <code>routeId</code>／<code>routeCode</code>，
         * 原訂路線看 <code>plannedRouteInstanceId</code>。識別碼只負責識別。
         * 班次編號＋分段編號在同一個時段內本來就唯一，不靠路線去湊。
         */
        id:
          `template-pax-${departure.intervalId}`
          + `-${index + 1}-${legIndex + 1}-${leg.startSecond}`,
        rowIndex: chosenRow,
        taskType: 'passenger',
        startMinute: secondToMinute(leg.startSecond),
        durationMinutes: Math.max(1, leg.occupancySeconds / 60),
        label: '正線',
        // 這一趟的錨點是依「這一條路線的佔用秒數」算出來的；記下來讓指派階段
        // 照著走，不要各自重新推導出另一條（見 ScheduleTask 的欄位說明）。
        plannedRouteInstanceId: resolveSelectedRouteInstanceId(leg.route),
        // 交路識別／起班時刻／來源時段／班距目標：同一輪展開的每一腿都記同一個
        // 起班脈衝（departure），不是各腿自己再重查一次時段——見 ScheduleTask
        // 的欄位說明；班距檢查／修復拿這個當基準，不解析 id 猜。
        cycleChainId: `cycle-${chosenRow}-${chosenStartSecond}`,
        cycleOriginSecond: chosenStartSecond,
        cycleOriginIntervalId: cycleOrigin.intervalId,
        // 用「這一脈跟上一脈真正要守住的間隔」，不是單純新時段的 headwaySeconds——
        // 跨時段的第一脈已經用 max(舊班距,新班距) 頂起來，記下來那個較嚴值，
        // 後面班距檢查／修復才不會誤以為只要守住新時段自己的班距就好。
        cycleHeadwayTargetSeconds: cycleOrigin.headwayTargetSeconds,
        servicePulseId: pulseId,
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
    // 一個班距脈衝已展開本輪腿數；下一次仍從同一相位開輪。
    rotationIndex[chosenRow] += Math.max(cycleLegs.length, 1);
    pulseLedger?.push({
      pulseId,
      departureSecond: departure.startSecond,
      headwaySeconds: departure.headwaySeconds,
      intervalId: departure.intervalId,
      intervalName: departure.intervalName,
      routeId: departure.routeId,
      status: 'assigned',
      assignedRow: chosenRow,
      actualStartSecond: chosenStartSecond,
      legCount: cycleLegs.length,
      ...(startsInsideReleasableStandby(chosenRow, chosenStartSecond) ? { standbyRelease: true } : {}),
    });
  }

  return tasks;
}

/** 脈衝穩定識別：時段＋目標發車秒（同一份輸入每次產生都一樣） */
export function servicePulseIdOf(departure: Pick<DirectionalHeadwayDeparture, 'intervalId' | 'startSecond'>): string {
  return `pulse-${departure.intervalId}-${departure.startSecond}`;
}

function formatClockSecond(second: number): string {
  const s = ((Math.round(second) % 86400) + 86400) % 86400;
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
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
  maintenanceBody: Record<string, unknown> | null,
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
    // 讓渡後整備仍要留下最低工作時間；留不下就不縮（重疊交給後處理把正線推過整備），絕不壓成零
    if (originalEndSecond - deferredStartSecond < minimumYardWorkSeconds(task.taskType, maintenanceBody) - 1e-9) continue;
    // 記住模板原起點，避免後續幽靈正線被 push 走後充電開頭無法縮回。
    if (task.templateStartMinute == null) {
      task.templateStartMinute = task.startMinute;
    }
    task.startMinute = secondToMinute(deferredStartSecond);
    task.durationMinutes = Math.max(
      0,
      secondToMinute(originalEndSecond - deferredStartSecond),
    );
  }
}

/** 模板上「待命一結束就接正線」：容許模板手拉時差一兩分鐘 */
const STANDBY_TO_PASSENGER_JOIN_TOLERANCE_MINUTES = 2;

function standbyLeadsIntoPassenger(
  templateTasks: ReadonlyArray<ScheduleTask>,
  standby: ScheduleTask,
): boolean {
  const endMinute = standby.startMinute + standby.durationMinutes;
  return templateTasks.some(
    (task) =>
      task.rowIndex === standby.rowIndex
      && task.taskType === 'passenger'
      && Math.abs(task.startMinute - endMinute) <= STANDBY_TO_PASSENGER_JOIN_TOLERANCE_MINUTES,
  );
}

/**
 * 待命提早結束接班之後，把待命卡的尾巴收到第一班發車為止。
 * 只處理「待命後緊接正線」的待命；開頭不動，所以待命之前那一段整備（例如充電）不受影響。
 * 必須在 deferNonPassengerTasksAfterCycleSpill 之前做，否則那一步會把待命的「開頭」
 * 推到班次之後，變成車先載客再回去待命。
 */
function releaseStandbyTailForEarlyDispatch(
  nonPassengerTasks: ScheduleTask[],
  passengerTasks: ReadonlyArray<ScheduleTask>,
  templateTasks: ReadonlyArray<ScheduleTask>,
): void {
  for (const task of nonPassengerTasks) {
    if (!isStandbyLikeTaskType(task.taskType) || !standbyLeadsIntoPassenger(templateTasks, task)) continue;
    const startMinute = task.startMinute;
    const endMinute = startMinute + task.durationMinutes;
    let firstDeparture = endMinute;
    for (const passenger of passengerTasks) {
      if (passenger.rowIndex !== task.rowIndex) continue;
      if (passenger.startMinute <= startMinute + 1e-9 || passenger.startMinute >= endMinute - 1e-9) continue;
      firstDeparture = Math.min(firstDeparture, passenger.startMinute);
    }
    if (firstDeparture < endMinute - 1e-9) task.durationMinutes = firstDeparture - startMinute;
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

/**
 * 整備結束到「輪的第一段可以發車」之間要留多久。
 *
 * 保養／行檢的設施離首發站有一段距離，車做完之後要先跑一趟<strong>外掛的調度營運班次</strong>
 * 才會到首發站。這段時間必須先預留，否則輪的第一段緊貼整備結束就發車，
 * 外掛根本塞不進去——結果是車還在出場站、班次卻從首發站發車（YARD_EXIT_STATION_MISMATCH）。
 *
 * 回傳「最短的一條外掛路線占用 + 恢復時間」。充電／待命沒有外掛（車就在出場站附近），回 0。
 */
function resolveYardDispatchLeadSeconds(args: {
  taskType: string;
  origins: MaintenanceFirstTripOrigin[];
  maintenanceBody: Record<string, unknown> | null;
  passengerRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
}): number {
  const policy = resolveYardPostTaskPolicy({
    taskType: args.taskType,
    origins: args.origins,
    maintenanceBody: args.maintenanceBody,
  });
  if (!policy.allowEntryService) return 0;
  const exits = new Set(policy.entryServiceExitStationIds);
  if (exits.size === 0) return 0;
  const cycleStartStationId = args.passengerRoutes[0]?.stationIds[0]?.trim();
  if (!cycleStartStationId) return 0;

  let shortest: number | null = null;
  for (const route of args.passengerRoutes) {
    const origin = route.stationIds[0]?.trim();
    const terminal = route.stationIds[route.stationIds.length - 1]?.trim();
    if (!origin || !terminal) continue;
    if (!exits.has(origin) || terminal !== cycleStartStationId) continue;
    const occupancy = resolvePassengerRouteOccupancy(route)?.occupancySeconds;
    if (occupancy == null) continue;
    if (shortest == null || occupancy < shortest) shortest = occupancy;
  }
  if (shortest == null) return 0;
  return shortest + Math.max(0, args.minimumRecoveryTimeSeconds);
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
  const collisionProtection = normalizeCollisionProtectionSeconds(
    args.draft.routeGroups.collisionProtectionSeconds,
  );
  let successorPolicy = buildRouteSuccessorPolicy({
    routes: orderedSelected,
    graph:
      args.draft.routeGroups.routeRelationGraph ?? emptyShiftRouteRelationGraph(),
    throughAnchors:
      args.draft.routeGroups.throughAnchors ?? emptyShiftRouteThroughAnchorsDraft(),
    minimumRecoveryTimeSeconds: minimumRecovery,
  });
  // 同起點備選路線（舊草稿 backupFor*）併入拓撲表，供開站／站位候選；不改動導通環
  if (successorPolicy.valid && backupRoutes.length > 0) {
    const routesByInstanceId = new Map(successorPolicy.routesByInstanceId);
    for (const route of backupRoutes) {
      routesByInstanceId.set(resolveSelectedRouteInstanceId(route), route);
    }
    successorPolicy = { ...successorPolicy, routesByInstanceId };
  }
  if (!successorPolicy.valid) {
    pushIssue(errors, {
      code: 'ROUTE_SUCCESSOR_POLICY_INVALID',
      severity: 'error',
      message: successorPolicy.issue === 'RELATION_GRAPH_MISSING'
        ? '路線群組沒有關聯圖（或沒有檢查過路線組合）：正線接續只依關聯圖，系統不會依路線排列順序自動輪替。'
          + '請到路線群組畫關聯圖、指定起算／結算並按「檢查路線組合」後重新生成。'
        : `路線關聯圖尚未形成可用的已驗證交路（${successorPolicy.issue ?? 'UNKNOWN'}），`
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
  // 相位對齊只認「車真的停在那裡、沒有外掛班次可送」的類型（充電／待命）
  const yardRotationExitByTaskType = buildYardRotationExitByTaskType({
    origins: firstTripOrigins,
    maintenanceBody,
    purpose: 'align',
  });
  // 驗證則要看「車可能停在哪幾站」——保養涵蓋 M 設施與洗車，出場站不只一個
  const yardExitStationOptionsByTaskType = buildYardExitStationOptionsByTaskType({
    origins: firstTripOrigins,
    maintenanceBody,
  });

  const templateTasks = template.tasks.filter(
    (task) => task.rowIndex >= 1 && task.rowIndex <= template.scheduleRowCount,
  );
  const nonPassengerTasks = templateTasks.filter((task) => task.taskType !== 'passenger');
  // 模板原本的整備（讓渡縮短之前的副本）：最終驗證拿它對照，確認沒有整備被刪或壓過頭
  const templateYardTasks = nonPassengerTasks.map((task) => ({ ...task }));

  let confirmedTasks: ScheduleTask[] = templateTasks;
  let timetableGenerationAlgorithm: string | undefined;
  let servicePulseDemand = 0;
  const servicePulses: ServicePulseRecord[] = [];

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
        message: '班距時刻生成未產出任何正線發車（運用可能不足或時段過短）',
      });
      return null;
    }
    deferNonPassengerTasksAfterCycleSpill(nonPassengerTasks, generatedPassenger, maintenanceBody);
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
      if (!isStandbyLikeTaskType(task.taskType)) return false;
      // 純待命列不派正線；僅「待命之後仍有正線」才把待命當可派視窗
      return isStandbyDispatchableForMainline(templateTasks, task);
    });
    // 一個完整輪迴要多久——長整備的讓渡額度就是這個數字（見 resolveYardEntrySlackSeconds）
    const lockedRotationSeconds = resolveLockedRotationMinSeconds(successorPolicy);
    // 每個整備最多可以被正線佔掉開頭幾秒（含進場）。寫在任務上，展開、排移動卡、最終驗證都用同一個數字
    nonPassengerTasks.forEach((task, index) => {
      const yardDurationSeconds = Math.round(task.durationMinutes * 60);
      const allowance = Math.max(0, Math.min(
        resolveYardEntrySlackSeconds({ taskType: task.taskType, yardDurationSeconds, lockedRotationSeconds, slackBySection }),
        yardDurationSeconds - minimumYardWorkSeconds(task.taskType, maintenanceBody),
      ));
      task.yieldAllowanceSeconds = allowance;
      const copy = templateYardTasks[index];
      if (copy && copy.id === task.id) copy.yieldAllowanceSeconds = allowance;
    });
    /**
     * 作業類整備做滿才出廠（不截尾巴，白皮書 YARD-07），所以整備結束後至少要先開完出廠移動，
     * 第一班才可能在站上發車。取「這一類任一設施 → 任一條正線路線起點站」在路網上的最短時間當下界；
     * 實際挑到的設施與站可能更遠，排卡時照實際路徑算。拓樸沒有資料時為 0（照舊）。
     */
    const exitSecondsByTaskType = new Map<string, number>();
    const minimumYardExitSeconds = (taskType: string): number => {
      const cached = exitSecondsByTaskType.get(taskType);
      if (cached != null) return cached;
      const section = FACILITY_SECTION_BY_TASK_TYPE[taskType as keyof typeof FACILITY_SECTION_BY_TASK_TYPE];
      const topology = args.pointTopology;
      let best: number | null = null;
      if (section && topology) {
        const codes = extractFacilityMapCodes(maintenanceBody, section);
        const originStations = new Set(passengerRoutes.map((route) => route.stationIds[0]?.trim()).filter(Boolean));
        const facilities = topology.nodes.filter((node) => node.kind === 'facility' && nodeMatchesMoveCardCodes(node, codes));
        const stations = topology.nodes.filter((node) => node.kind === 'docking' && originStations.has(node.stationId?.trim() ?? ''));
        for (const facility of facilities) {
          for (const station of stations) {
            const path = findTopologyPath(topology, facility.id, station.id);
            if (path && (best == null || path.avgSeconds < best)) best = path.avgSeconds;
          }
        }
      }
      exitSecondsByTaskType.set(taskType, best ?? 0);
      return best ?? 0;
    };
    /**
     * 最後一輪跑完之後，從終點站進到下一個整備的設施最少要多久（含恢復時間），依整備種類。
     * 讓渡額度是全部——跑完加進場都要落在額度內（使用者 2026-11-15，每一種整備都一樣）。
     * 取「任一終點站 → 這一類任一設施」在路網上的最短時間當下界；拓樸沒有資料時不檢查（照舊）。
     */
    const entrySecondsByTaskType = new Map<string, Map<string, number>>();
    const yardEntrySecondsFor = (taskType: string): Map<string, number> => {
      const cached = entrySecondsByTaskType.get(taskType);
      if (cached) return cached;
      const result = new Map<string, number>();
      const section = FACILITY_SECTION_BY_TASK_TYPE[taskType as keyof typeof FACILITY_SECTION_BY_TASK_TYPE];
      const topology = args.pointTopology;
      if (section && topology) {
        const codes = extractFacilityMapCodes(maintenanceBody, section);
        const facilities = topology.nodes.filter((node) => node.kind === 'facility' && nodeMatchesMoveCardCodes(node, codes));
        const terminals = new Set(passengerRoutes.map((route) => route.stationIds.at(-1)?.trim()));
        for (const station of topology.nodes) {
          const id = station.stationId?.trim();
          if (!id || station.kind !== 'docking' || !terminals.has(id)) continue;
          for (const facility of facilities) {
            const path = findTopologyPath(topology, station.id, facility.id);
            if (!path) continue;
            const seconds = path.avgSeconds + minimumRecovery;
            if (seconds < (result.get(id) ?? Infinity)) result.set(id, seconds);
          }
        }
      }
      entrySecondsByTaskType.set(taskType, result);
      return result;
    };
    const chargingEntrySeconds = yardEntrySecondsFor('charging');
    const maxChargingEntrySeconds = Math.max(0, ...chargingEntrySeconds.values());
    for (const pTask of dispatchWindowTasks) {
      const startSec = pTask.startMinute * 60;
      const endSec = (pTask.startMinute + pTask.durationMinutes) * 60;
      const nextMaint = resolveNextMaintenanceAfterWindow(
        pTask.rowIndex,
        endSec,
        nonPassengerTasks,
        slackBySection,
        lockedRotationSeconds,
        maintenanceBody,
        templateTasks,
      );
      const spill = resolveNextSpillBoundary({
        windowEndSecond: endSec,
        nextMaint,
        emptyRanges,
        emptyIntervalMainlineSlackSeconds,
      });
      // 保養／行檢之後要先跑外掛班次把車送到首發站，這段時間必須預留給它
      const precedingYard = findPrecedingNonPassengerTask(
        nonPassengerTasks,
        pTask.rowIndex,
        startSec,
      );
      const dispatchLeadSeconds = precedingYard
        ? Math.max(
            resolveYardDispatchLeadSeconds({
              taskType: precedingYard.taskType,
              origins: firstTripOrigins,
              maintenanceBody,
              passengerRoutes,
              minimumRecoveryTimeSeconds: minimumRecovery,
            }),
            // 作業類整備做滿才出廠（不截尾巴，白皮書 YARD-07）：至少要留出場移動的時間，
            // 否則第一班只有靠吃整備尾巴才趕得上
            isWorkYardTaskType(precedingYard.taskType)
              ? Math.max(
                  0,
                  minuteToSecondApprox(precedingYard.startMinute + precedingYard.durationMinutes)
                    + minimumYardExitSeconds(precedingYard.taskType)
                    - startSec,
                )
              : 0,
          )
        : 0;
      const list = rowActiveWindows.get(pTask.rowIndex) ?? [];
      list.push({
        startSecond: startSec,
        // 讓渡餘裕只可占用接下整備開頭，不可提前裁前一整備尾端出車。
        // 另外預留外掛班次把車從出場站送到首發站的時間（沒有外掛時為 0）。
        dispatchStartSecond: startSec + dispatchLeadSeconds,
        endSecond: endSec,
        nextMaintenanceStartSecond: spill.nextMaintenanceStartSecond,
        entrySlackSeconds: spill.entrySlackSeconds,
        nextMaintenanceEntrySeconds: nextMaint ? yardEntrySecondsFor(nextMaint.taskType) : undefined,
        ...(args.allowStandbyEarlyRelease && isStandbyLikeTaskType(pTask.taskType) && standbyLeadsIntoPassenger(templateTasks, pTask)
          ? { standbyEndSecond: endSec, standbyReleaseExtraSeconds: maxChargingEntrySeconds }
          : {}),
      });
      rowActiveWindows.set(pTask.rowIndex, list);
    }

    servicePulseDemand = departures.length;
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
      allowBumpPastEarlierSameRoute: args.allowBumpPastEarlierSameRoute,
      assignmentCuts: args.assignmentCuts,
      pulseLedger: servicePulses,
      allowStandbyEarlyRelease: args.allowStandbyEarlyRelease,
      preferCirculatingVehicles: args.preferCirculatingVehicles,
    });

    if (args.allowStandbyEarlyRelease) {
      releaseStandbyTailForEarlyDispatch(nonPassengerTasks, passengerTasks, templateTasks);
    }
    deferNonPassengerTasksAfterCycleSpill(nonPassengerTasks, passengerTasks, maintenanceBody);
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
    templateYardTasks,
    servicePulseDemand,
    servicePulses,
    intervals: template.intervals,
    attributes: template.attributes,
    passengerRoutes,
    selectedRoutes,
    backupRoutes,
    maintenanceBody,
    maintenanceEntrySlackBySection: slackBySection,
    emptyIntervalMainlineSlackSeconds,
    minimumRecoveryTimeSeconds: minimumRecovery,
    collisionProtectionSeconds: collisionProtection,
    yardRotationExitByTaskType,
    yardExitStationOptionsByTaskType,
    turnaroundLimitSeconds:
      args.turnaroundLimitSeconds == null || !Number.isFinite(args.turnaroundLimitSeconds)
        ? null
        : args.turnaroundLimitSeconds,
    passengerTimetableMode: mode,
    timetableGenerationAlgorithm,
    firstTripOrigins,
    successorPolicy,
    pointTopology: args.pointTopology ?? null,
    areas: args.areas ?? null,
  };
}
