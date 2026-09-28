import { engineTrace, engineTraceEnabled } from './engineTrace';
import { planStateKey, SearchBudget, type SearchBudgetLimits } from './searchBudget';
import { listTopologyTravelTimeGaps, type TopologyEdgeRef } from '../findTopologyPath';
import { YARD_TASK_TYPES } from '../moveCardShared';
import { TASK_TYPE_OPTIONS } from '../../../time-templates/types/editor';

import type { PointTopology } from '../../../map-editor/types/pointTopology';
import type { MapAreaObject } from '../../../map-editor/types/area';
import type { ShiftScheduleCreateDraft } from '../../types/create';
import type { MaintenanceFirstTripOrigin } from '../maintenanceFirstTripOrigins';
import { extractFacilityMapCodes } from '../maintenanceFirstTripOrigins';
import { insertMaintenanceEntryServiceTrips } from '../insertMaintenanceEntryServiceTrips';
import { insertMaintenanceTransferCards } from '../insertMaintenanceTransferCards';
import { computeScheduleGateOk, PUBLISH_BLOCKING_CODES } from '../scheduleAcceptance';
import type {
  FeasibilityIssue,
  FeasibilityViolationCode,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
  GeneratedScheduleTimeline,
  GenerateShiftScheduleResult,
  ScheduleServiceMetrics,
  SchedulingContext,
} from './types';
import {
  normalizeEngineInput,
  type PassengerTimetableMode,
} from './normalizeInput';
import {
  expandRowBlocks,
  groupTasksByRow,
  resolveTemplateTasks,
} from './expand';
import {
  routeAssignmentAlgorithmId,
  resolveLockedRotationMinSeconds,
} from './routeSuccessorPolicy';
import {
  validatePassengerHeadway,
  validateRouteSwitchBuffers,
  validateTimelineCapacity,
  validateTimelineOverlaps,
  validateTurnaroundLimits,
  validateRotationCyclesComplete,
  validateStationTimingsWithinBlocks,
  validateStationBerthCollisions,
  validateYardExitContinuity,
  validateVehicleLocationContinuity,
  validateMoveJunctionConflicts,
  validateFacilityOccupancy,
} from './validate';
import {
  enforceStationBerthConstraints,
  STATION_BERTH_WAIT_MAX_DELAY_SECONDS,
  type BerthDelayRecord,
} from '../stationBerthConstraint';
import { densifyRouteHeadwaysAfterBerth } from '../densifyRouteHeadwaysAfterBerth';
import { repairRouteHeadwaysBelowTarget } from '../repairRouteHeadwaysBelowTarget';
import { alignRouteWithVehicleLocation } from '../alignRouteWithVehicleLocation';
import { alignRouteWithMaintenanceEntry } from '../alignRouteWithMaintenanceEntry';
import { yieldIdleBlockArrival } from '../yieldIdleBlockArrival';
import { evenOutRouteHeadwayPhase } from '../evenOutRouteHeadwayPhase';
import { relievePlatformIdleWithSecondaryEdge } from '../relievePlatformIdleWithSecondaryEdge';
import { relievePlatformIdleWithFacilityPark } from '../relievePlatformIdleWithFacilityPark';
import { closeYardHeadGaps } from '../closeYardHeadGaps';
import {
  collectStationBerthOccupancies,
  findStationBerthCollisions,
} from '../stationBerthOccupancy';
import { fillYardHoldGaps } from '../fillYardHoldGaps';
import { trimIncompleteRotationCyclesOnTimelines } from '../trimIncompleteRotationCycles';

import {
  applyMainlineMaintenanceEntryYield,
  pushPassengerPastPrecedingYard,
} from '../mainlineMaintenanceEntryYield';
import { tagYardDispatchTrips, scrubMidMainlineDispatchArtifacts } from './tagYardDispatchTrips';
import { pushIssue } from './feasibilityIssueMeta';
import type { PlanEvaluationContext } from './evaluatePlan';
import {
  DEFAULT_RESIDUAL_REPAIR_BUDGET,
  type ResidualRepairBudget,
  rerouteBerthPairInCopy,
  rerouteTripInCopy,
  resolveResidualConflicts,
  shiftTripInCopy,
} from './resolveResidualConflicts';
import { collectPlanViolations, compareViolations, violationFromIssue, type PlanViolation } from './evaluatePlan';
import { snapUpToClockAlignSeconds } from './physics';
import {
  comparePlanScores,
  formatPlanScore,
  scoreSchedulePlan,
  type PlanScore,
} from './scorePlan';

/** 任務類型的中文名稱（訊息用，不直接顯示 charging／standby 這類代號） */
function taskTypeName(key: string | undefined): string {
  return TASK_TYPE_OPTIONS.find((option) => option.key === key)?.label ?? key ?? '';
}

function formatEdgeList(edges: TopologyEdgeRef[]): string {
  return edges.map((edge) => `「${edge.fromLabel}」→「${edge.toLabel}」`).join('、');
}

export type GenerateShiftScheduleInput = {
  shiftId?: string;
  draft: ShiftScheduleCreateDraft;
  templateBody: Record<string, unknown>;
  maintenanceTaskBody?: Record<string, unknown> | null;
  /** 1.6 車輛折返時限（秒）；與 Step 4 同源，由 adapter 自模板推導 */
  turnaroundLimitSeconds?: number | null;
  /**
   * template：沿用模板正線錨點（預設，相容既有模板任務）
   * headway：依班距自動生成正線時刻並掛時間線（§4.2；建立班表 adapter 使用）
   */
  passengerTimetableMode?: PassengerTimetableMode;
  /** 目前啟用地圖拓樸抽出的首班起點站；未傳則不插調度 */
  firstTripOrigins?: MaintenanceFirstTripOrigin[];
  /** 完整路網拓樸；整備／調度入廠卡尋路用 */
  pointTopology?: PointTopology | null;
  /** 地圖場域管理模組的 Area 容器清單；整備間轉場判斷「兩座設施是不是同一區域」用 */
  areas?: MapAreaObject[] | null;
  /**
   * 殘留衝突搜尋的候選數／聯動深度上限（不設時間上限）。未傳用預設值；
   * 測試用它驗證「預算用盡時如實揭露、不假裝可行」。
   */
  residualRepairBudget?: Partial<ResidualRepairBudget>;
  /**
   * 整次生成共用的搜尋預算上限（候選數、完整評估數、時間）。未傳用預設值；
   * 測試用它驗證停止機制。
   */
  searchBudget?: Partial<SearchBudgetLimits>;
};

/**
 * 幾何後處理收斂迴圈的輪數上限。
 * 正常 2–3 輪就不動了；上限只是防呆，避免互相破壞的處理無限來回。
 */
const GEOMETRY_CONVERGENCE_MAX_ROUNDS = 14;

/** 站位延後成因最多逐則列出幾個擋路點，其餘收成一則匯總 */
const BERTH_DELAY_SOURCE_REPORT_LIMIT = 10;

/**
 * 版面指紋：把每個區塊的「身分＋起迄」壓成字串，用來判斷這一輪有沒有任何變化。
 * 只看時間與存在與否——這正是幾何後處理會改動的東西。
 */
function fingerprintTimelines(
  timelines: GeneratedSchedulePlan['timelines'],
): string {
  const parts: string[] = [];
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      // 指紋要含<strong>路線</strong>，不能只有時刻。
      //
      // 迴圈裡有兩道會「只換路線、不動時刻」的處理（改停別的站位、
      // 配合車輛停放位置改派）。換路線＝換停靠站＝站位佔用整個變了，
      // 但時刻沒動——指紋只看時刻的話，迴圈會判定「這輪沒變化」直接收工，
      // 那些新產生的站位衝突<strong>永遠不會被求解</strong>。
      //
      // 同理也要含<strong>格位／站位</strong>：closeYardHeadGaps 改整備開始時刻
      // 會被時刻抓到，但改派到另一格設施、或改成另一個進出廠停靠站，若時刻與路線
      // 剛好都沒動，只看前面那幾項一樣看不出這輪有變化——換過去的那一格會不會撞人
      // 因此永遠不會被下一輪重新驗證。
      parts.push(
        `${timeline.row}|${block.id}|${block.plannedStartMinute}|${block.plannedEndMinute}`
        + `|${block.routeInstanceId ?? block.routeId ?? ''}`
        + `|${block.yardFacilityNodeId ?? ''}|${block.yardFacilityStationId ?? ''}`
        + `|${block.yardExitFacilityNodeId ?? ''}|${block.yardExitStationId ?? ''}`,
      );
    }
  }
  parts.sort();
  return parts.join('\n');
}

/**
 * 追蹤用的版面摘要：每列每張卡的種類、起迄、路線與格位（不含名稱）。只在追蹤開啟時產生，
 * 用來比對兩份輸入從哪一道處理開始排出不同的版面。
 */
function traceLayout(
  stage: string,
  timelines: GeneratedSchedulePlan['timelines'],
  extra: Record<string, unknown> = {},
): void {
  if (!engineTraceEnabled()) return;
  const rows = timelines.map((timeline) => ({
    row: timeline.row,
    blocks: timeline.blocks.map((block) =>
      `${block.taskType}/${block.source ?? ''}@${Math.round(block.plannedStartMinute * 60)}-${Math.round(block.plannedEndMinute * 60)}`
      + `|${block.routeInstanceId ?? block.routeId ?? ''}|${block.yardFacilityNodeId ?? ''}|${block.yardExitFacilityNodeId ?? ''}`),
  }));
  engineTrace('layout', { at: stage, ...extra, rows });
}

/**
 * 排班引擎主入口：依策略文件 1.1–1.8、S1–S4 與優化算法展開班表。
 *
 * 有未承接脈衝時，會用「掛脈衝時可再往後推過貼太近的同向班次」再完整重跑一次
 * （見 NormalizeInputArgs.allowBumpPastEarlierSameRoute），兩份整張比較：
 * 硬錯誤與擋發布的安全問題都不能變多，之後依 班距 > 承接 > 班次 取較好的一份。
 * 不是直接拿掉拒絕條件——實測直接拿掉承接 2 → 1、班次 1184 → 1188，卻多出站位
 * 保護不足與班距不足，所以只在整張變好時才用。
 */
/** 殘留修復之後重算轉場的最多輪數（每輪都要比上一輪好才採用） */
const POST_RESIDUAL_RECOMPUTE_ROUNDS = 3;

/**
 * 把後處理結果裡「班次」的時刻與路線寫回轉場前的版面（以卡片 id 對應）。
 * 系統產生的移動卡、讓站卡、暫停卡不在轉場前的版面裡，重跑時會重建；整備任務本身的時刻
 * 也交給重跑決定（轉場規則會重新推算）。
 */
function carryTripEditsIntoPre(
  pre: GeneratedSchedulePlan['timelines'],
  after: GeneratedSchedulePlan['timelines'],
): { timelines: GeneratedSchedulePlan['timelines']; changed: number } {
  const afterById = new Map<string, GeneratedScheduleBlock>();
  for (const timeline of after) {
    for (const block of timeline.blocks) {
      if (block.taskType === 'passenger') afterById.set(block.id, block);
    }
  }
  let changed = 0;
  const timelines = pre.map((timeline) => ({
    ...timeline,
    blocks: timeline.blocks.map((block) => {
      if (block.taskType !== 'passenger') return { ...block };
      const edited = afterById.get(block.id);
      if (!edited) return { ...block };
      const same = Math.abs(edited.plannedStartMinute - block.plannedStartMinute) < 1e-9
        && Math.abs(edited.plannedEndMinute - block.plannedEndMinute) < 1e-9
        && edited.routeInstanceId === block.routeInstanceId
        && edited.routeId === block.routeId
        && (edited.dwellSlackAdjustment?.addedSeconds ?? 0) === (block.dwellSlackAdjustment?.addedSeconds ?? 0);
      if (same) return { ...block };
      changed += 1;
      return { ...edited };
    }),
  }));
  return { timelines, changed };
}

export function generateShiftSchedule(
  input: GenerateShiftScheduleInput,
): GenerateShiftScheduleResult {
  // 一次生成只有一份搜尋預算：兩次完整生成（見下）與其中所有後處理搜尋共用，不會各自重拿
  const searchBudget = new SearchBudget({
    ...(input.residualRepairBudget?.maxEvaluations != null
      ? { maxEvaluations: input.residualRepairBudget.maxEvaluations }
      : {}),
    ...input.searchBudget,
  });
  const base = generateShiftScheduleOnce(input, false, searchBudget);
  const unserved = base.report.warnings.filter((issue) => issue.code === 'UNSERVED_SERVICE_PULSE');
  if (unserved.length === 0 || !base.plan) return base;
  const alt = generateShiftScheduleOnce(input, true, searchBudget);
  if (!alt.plan) return base;
  const keyOf = (result: GenerateShiftScheduleResult): number[] => {
    const count = (code: string) =>
      result.report.warnings.filter((issue) => issue.code === code).length;
    const safety = result.report.warnings.filter((issue) => PUBLISH_BLOCKING_CODES.has(issue.code)).length;
    const trips = result.plan?.timelines.reduce(
      (sum, timeline) => sum + timeline.blocks.filter((block) => block.taskType === 'passenger').length,
      0,
    ) ?? 0;
    return [
      result.report.errors.length,
      safety,
      count('HEADWAY_BELOW_TARGET'),
      count('UNSERVED_SERVICE_PULSE'),
      -trips,
    ];
  };
  const baseKey = keyOf(base);
  const altKey = keyOf(alt);
  const safetyIssues = (result: GenerateShiftScheduleResult) => [
    ...result.report.errors,
    ...result.report.warnings.filter((issue) => PUBLISH_BLOCKING_CODES.has(issue.code)),
  ].map((issue) => violationFromIssue(issue, issue.severity === 'error' ? 'hard' : 'safety'));
  const safetyNotWorse = compareViolations(safetyIssues(base), safetyIssues(alt)).safeToAdopt;
  let better = false;
  for (let index = 0; index < baseKey.length; index += 1) {
    if (altKey[index] !== baseKey[index]) {
      better = altKey[index]! < baseKey[index]!;
      break;
    }
  }
  return safetyNotWorse && better ? alt : base;
}

function generateShiftScheduleOnce(
  input: GenerateShiftScheduleInput,
  allowBumpPastEarlierSameRoute: boolean,
  searchBudget: SearchBudget,
): GenerateShiftScheduleResult {
  const errors: FeasibilityIssue[] = [];
  const warnings: FeasibilityIssue[] = [];
  const standbyFacilityCodes = extractFacilityMapCodes(input.maintenanceTaskBody, 'mobile');
  const residualBudget: ResidualRepairBudget = {
    ...DEFAULT_RESIDUAL_REPAIR_BUDGET,
    ...input.residualRepairBudget,
  };

  const engineInput = normalizeEngineInput(
    {
      shiftId: input.shiftId,
      draft: input.draft,
      templateBody: input.templateBody,
      maintenanceTaskBody: input.maintenanceTaskBody,
      turnaroundLimitSeconds: input.turnaroundLimitSeconds,
      passengerTimetableMode: input.passengerTimetableMode ?? 'template',
      firstTripOrigins: input.firstTripOrigins,
      pointTopology: input.pointTopology,
      areas: input.areas,
      allowBumpPastEarlierSameRoute,
    },
    errors,
    warnings,
  );

  if (!engineInput) {
    return { plan: null, report: { ok: false, errors, warnings } };
  }

  const ctx: SchedulingContext = {
    shiftId: engineInput.shiftId,
    scheduleRowCount: engineInput.scheduleRowCount,
    passengerRoutes: engineInput.passengerRoutes,
    minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
    successorPolicy: engineInput.successorPolicy,
  };

  validateTurnaroundLimits(
    engineInput.selectedRoutes,
    engineInput.minimumRecoveryTimeSeconds,
    engineInput.turnaroundLimitSeconds,
    errors,
    warnings,
    resolveLockedRotationMinSeconds(engineInput.successorPolicy),
  );

  const resolvedByTaskId = resolveTemplateTasks(
    engineInput.confirmedTasks,
    ctx,
    engineInput.maintenanceBody,
    errors,
    warnings,
    engineInput.firstTripOrigins,
  );

  const tasksByRow = groupTasksByRow(engineInput.confirmedTasks);
  let timelines: GeneratedSchedulePlan['timelines'] = [];

  for (let row = 1; row <= engineInput.scheduleRowCount; row += 1) {
    const rowTasks = tasksByRow.get(row) ?? [];
    const blocks = expandRowBlocks(
      rowTasks,
      resolvedByTaskId,
      errors,
      engineInput.minimumRecoveryTimeSeconds,
      engineInput.passengerRoutes,
    );
    if (blocks.length > 0) {
      timelines.push({ row, blocks });
    }
  }

  traceLayout('expand', timelines);
  timelines = insertMaintenanceEntryServiceTrips({
    timelines,
    selectedRoutes: [
      ...engineInput.selectedRoutes,
      ...engineInput.backupRoutes,
    ],
    firstTripOrigins: engineInput.firstTripOrigins,
    maintenanceBody: engineInput.maintenanceBody,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
    collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
    warnings,
  });

  // 站位約束需要全選路線（含草稿相容 backupFor*）；輪替仍只用主路線
  const routesForBerth = [
    ...engineInput.selectedRoutes,
    ...engineInput.backupRoutes,
  ];

  // 待命要停在哪，必須在站位求解<strong>之前</strong>就決定。
  //
  // 待命停在正線停靠站等於把那一格佔住整段時間，站位求解器要有機會閃避
  // （延後發車、改派備用路線、讓渡）。但插卡必須等時刻定案後才能做——卡要貼齊
  // 下一段發車。所以拆成兩趟：這裡只決定地點寫進區塊，迴圈跑完再插卡。
  //
  // 只決定一次、不在迴圈裡每輪重算：地點若跟著求解結果一直變，會跟求解器互相
  // 追著跑，而收斂判定看的是時刻指紋、抓不到這種來回。時刻在迴圈裡的漂移
  // 由最後的站位驗證負責回報。
  insertMaintenanceTransferCards({
    timelines,
    topology: engineInput.pointTopology,
    areas: engineInput.areas,
    maintenanceBody: engineInput.maintenanceBody,
    selectedRoutes: engineInput.selectedRoutes,
    minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
    collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    decideOnly: true,
  });

  traceLayout('decide-only', timelines);

  // ── 幾何後處理：收斂迴圈 ────────────────────────────────────────────────
  //
  // 這幾道處理彼此會互相破壞：站位延後把班距擠亂、補班距又把班次推進整備、
  // 讓渡與推移再把站位擠回衝突、撤掉不成輪尾巴又釋放出新的空檔。
  //
  // 舊版是一段手工排定的固定序列（讓渡×3、站位×2、推移×3、班距修復×1），
  // 順序全靠試出來，且必然漏接——最典型的是：trim 撤掉不成輪尾巴所釋放的站位，
  // 班距修復早就跑完了看不到，那些落差就一路留到 validate 變成 HEADWAY_BELOW_TARGET。
  //
  // 改為跑到不動點：每輪跑完整組處理，版面沒有任何變化就結束。
  // 這樣「某一步釋放的空間，下一輪其他步驟就能用到」，不必人工推演順序。
  /**
   * 站位延後的成因紀錄簿，<strong>跨輪</strong>累積。
   *
   * warnings 只在第 0 輪傳給各道處理（後面幾輪傳 undefined，否則同一件事會被
   * 重複報十幾次）。副作用是<strong>第 1 輪以後的延後完全不會出現在報告上</strong>：
   * 實測有一筆班次在第 1 輪被站位求解往後推了 520 秒，報告裡卻只查得到第 0 輪
   * 那幾筆「延後 10 秒」，使用者只看得到班次莫名其妙晚發，無從判斷成因。
   *
   * 這本紀錄簿每一輪都收，迴圈跑完再依「擋路的那一張卡」歸戶匯總成
   * STATION_BERTH_DELAY_SOURCE，指名是誰把誰推晚的。
   */
  const berthDelayLog: BerthDelayRecord[] = [];

  /**
   * <strong>迴圈回傳「最好的那一輪」，不是「最後一輪」。</strong>
   *
   * 這十二道處理彼此會互相推翻，實測（2026-08-20，把每一輪的變動卡數印出來）
   * 這個迴圈<strong>從來沒有收斂過</strong>：
   *
   *   好的輸入   round 0 變動 1013 張 → round 13 仍在動 82 張
   *   壞的輸入   round 0 變動 1070 張 → round 5 降到 435 → round 9 反彈 765（發散）
   *
   * 所以先前回傳的不是一個解，是震盪過程中第 14 輪剛好停下來的那一格快照。輸入
   * 動一點點就落到軌跡上另一個點——使用者在地圖上多開 7 條「站→設施」的邊，班表
   * 就從硬錯誤 0／班次 1096 變成硬錯誤 4／班次 972，而那 7 條邊本身完全合理。
   *
   * 真正的修法是讓這十二道不再互相推翻（見 scorePlan 的說明，那是後面幾步）。
   * 這一步先止血：每一輪按{@link scoreSchedulePlan 全域評分}打分，留下最好的一版，
   * 迴圈結束用它。輸出因此<strong>永遠不會比這十四輪裡最好的那一輪差</strong>——
   * 震盪還在，但不再由「剛好停在哪」決定結果。
   */
  // 評分用的路線索引與最終驗證同一份，避免兩邊定義漂移
  const routeById = new Map(
    routesForBerth.map((route) => [route.routeId, route] as const),
  );
  const scoreOf = (candidate: GeneratedSchedulePlan['timelines']): PlanScore =>
    scoreSchedulePlan({
      timelines: candidate,
      selectedRoutes: routesForBerth,
      intervals: engineInput.intervals,
      attributes: engineInput.attributes,
      routeById,
      collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      scheduleRowCount: engineInput.scheduleRowCount,
    });
  const evaluationContext: PlanEvaluationContext = {
    selectedRoutes: routesForBerth,
    routeById,
    passengerRoutes: engineInput.passengerRoutes,
    successorPolicy: engineInput.successorPolicy,
    minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
    collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
    intervals: engineInput.intervals,
    attributes: engineInput.attributes,
    scheduleRowCount: engineInput.scheduleRowCount,
    topology: engineInput.pointTopology,
    yardExitStationOptionsByTaskType: engineInput.yardExitStationOptionsByTaskType,
  };
  const snapshotOf = (
    candidate: GeneratedSchedulePlan['timelines'],
  ): GeneratedSchedulePlan['timelines'] =>
    candidate.map((timeline) => ({
      ...timeline,
      blocks: timeline.blocks.map((block) => ({ ...block })),
    }));
  /**
   * <strong>每一道處理跑完立刻用同一把尺打分，變差就整道撤回。</strong>
   *
   * 先前十二道各有各的自我驗證，但量的是不同東西——站位讓渡只看碰撞對數、班距
   * 修復只看班距。於是會出現「讓渡把碰撞少掉一對、卻順手砍掉 124 個班次還自認
   * 成功」這種事。改成統一閘門之後，任何一道只要讓<strong>整張班表</strong>依
   * 使用者優先序（不碰撞 > 班距 > 班次穩定）變差，就當作沒發生過。
   *
   * 撤回時連同它寫進報告的訊息一起收回——一道被撤銷的處理不該留下「我做了什麼」
   * 的警告，否則使用者會看到根本不存在於班表上的動作。
   *
   * <strong>試過更細的粒度，實測更差，所以維持整道撤回。</strong>
   *
   * 直覺上「一道處理做了三十個修改，五個好、二十五個壞，全撤等於連那五個一起丟」，
   * 所以 2026-08-20 實作過逐列挑選：整道被判定變差時退回原版，再依序試著換上
   * 各列的新版本，只保留讓分數不變差的列。以「列」為單位是因為同一列的修改彼此
   * 相依（同一台車的連續行程，拆開會產生重疊），列與列之間只透過站位互相影響。
   *
   * 它確實有效——{@link yieldIdleBlockArrival} 每一輪都被挑出一列、保護不足各減
   * 一對。但<strong>下游反而變差</strong>：
   *
   *   整道撤回   yieldIdleBlockArrival 全退 → 讓渡把保護不足 34 → 11 → 6
   *   逐列保留   保留一列（34 → 33）      → 讓渡只能 33 → 15 → 8
   *
   * 那一列被挪走的空等餘裕，正是後面兩道讓渡要用的資源。局部 +1、全域 −2，最終
   * 站位碰撞從 1 對變成 3 對、班距不足 1.18% → 1.27%。也就是說「那五個好的修改」
   * 並不獨立——它們花掉的是別人更會用的東西。貪婪地保留局部改善，在這條管線上
   * 會毒害後面的處理。
   *
   * 真正要解的是「哪一道該做這件事」，不是「怎麼把壞處理的好部分撿回來」。
   *
   * <code>trimIncompleteRotationCycles</code> 不納入閘門：它刪的是不成輪的尾巴，
   * 屬於正確性收尾而不是最佳化，本來就會讓班次數下降（評分第四位），套上閘門會
   * 被系統性地擋掉，留下輪替不完整的班表。
   */
  const rejectedPasses = new Map<string, number>();
  let currentRound = -1;
  const traceEnabled =
    typeof globalThis !== 'undefined'
    && (globalThis as { __TRACE_PASS__?: boolean }).__TRACE_PASS__ === true;
  const runGuarded = (
    name: string,
    apply: () => GeneratedSchedulePlan['timelines'] | void,
  ): void => {
    const beforeTimelines = snapshotOf(timelines);
    const beforeScore = scoreOf(timelines);
    const warningMark = warnings.length;
    const delayLogMark = berthDelayLog.length;
    const produced = apply();
    if (produced) timelines = produced;
    const afterScore = scoreOf(timelines);
    if (traceEnabled) {
      const cmp = comparePlanScores(afterScore, beforeScore);
      const same = JSON.stringify(afterScore.vector) === JSON.stringify(beforeScore.vector);
       
      console.error(
        `r${currentRound} ${name.padEnd(38)} ${cmp > 0 ? '撤回' : same ? '無變化' : '採用'}`
        + `  ${JSON.stringify(beforeScore.vector)} → ${JSON.stringify(afterScore.vector)}`,
      );
    }
    if (comparePlanScores(afterScore, beforeScore) > 0) {
      timelines = beforeTimelines;
      warnings.length = warningMark;
      berthDelayLog.length = delayLogMark;
      rejectedPasses.set(name, (rejectedPasses.get(name) ?? 0) + 1);
    }
    traceLayout(`r${currentRound} ${name}`, timelines, {
      reverted: comparePlanScores(afterScore, beforeScore) > 0,
    });
  };

  let bestScore: PlanScore | null = null;
  let bestTimelines: GeneratedSchedulePlan['timelines'] | null = null;
  let bestRound = -1;

  let converged = false;
  for (let round = 0; round < GEOMETRY_CONVERGENCE_MAX_ROUNDS; round += 1) {
    currentRound = round;
    const before = fingerprintTimelines(timelines);

    // 車停在哪，下一班就從那裡發——待命的地點是被站位限制夾出來的、常常沒得選，
    // 而路線在主線與備用之間本來就可選，該讓的是有選擇的那一方。
    //
    // 擺在站位求解<strong>之前</strong>：換路線＝換停靠站＝站位佔用整個變了，
    // 擺在後面的話那一輪的求解已經跑完，新衝突要等下一輪才處理；
    // 最後一輪換的更是完全沒人收拾。擺在前面，同一輪就能反應。
    runGuarded('alignRouteWithVehicleLocation', () => {
      alignRouteWithVehicleLocation({
        timelines,
        selectedRoutes: routesForBerth,
        successorPolicy: engineInput.successorPolicy,
        topology: engineInput.pointTopology,
        firstTripOrigins: engineInput.firstTripOrigins,
        warnings: round === 0 ? warnings : undefined,
      });
    });

    // 要進廠卻停在到不了設施的站：把進廠前那一趟改開到進得了廠的那一站。
    // 放在站位求解之前——換終點＝換停靠站，要讓求解器有機會反應。
    runGuarded('alignRouteWithMaintenanceEntry', () => {
      alignRouteWithMaintenanceEntry({
        timelines,
        selectedRoutes: routesForBerth,
        topology: engineInput.pointTopology,
        successorPolicy: engineInput.successorPolicy,
        warnings: round === 0 ? warnings : undefined,
      });
    });

    // 站位延後把發車相位推歪了，這裡推回等間隔。
    //
    // 移動之前<strong>自己逐站驗證</strong>，撞得到就整筆放棄——不能移完丟給站位求解
    // 收拾：兩者調整方向相反（這裡往前移、求解器只往後延），收拾不掉的就變成硬碰撞
    // （2026-08-13 第一版實測 STATION_BERTH_COLLISION 0 → 4，因此撤掉重做）。
    // 仍排在站位求解之前，讓求解器永遠是最後拍板的那一個。
    runGuarded('evenOutRouteHeadwayPhase', () => {
      evenOutRouteHeadwayPhase({
        timelines,
        selectedRoutes: routesForBerth,
        minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
        collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
        warnings: round === 0 ? warnings : undefined,
      });
    });

    // 站位占用：拓撲候選中選局部無衝突解（可延後／可改線／可等）
    // 第一輪保守並收集警告；之後放寬延後上限，處理連鎖擠回來的殘餘衝突。
    runGuarded('enforceStationBerthConstraints', () =>
  enforceStationBerthConstraints({
        timelines,
        selectedRoutes: routesForBerth,
        minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
        collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
        successorPolicy: engineInput.successorPolicy,
        warnings: round === 0 ? warnings : undefined,
        delayLog: berthDelayLog,
        ...(round === 0
          ? {}
          : { maxDelaySeconds: STATION_BERTH_WAIT_MAX_DELAY_SECONDS }),
      }).timelines);

    // 「滯留的那台晚一點進站」已經移出迴圈，改在所有處理跑完之後才做——
    // 它動用的空等餘裕正是下面兩道讓渡解衝突的資源，在這裡先用掉會害它們沒東西
    // 可用（見迴圈後的說明）。

    // 跑完一輪在共用站位空等下一個脈衝時撞到別列車 → 有次要邊就先繞去別站等
    runGuarded('relievePlatformIdleWithSecondaryEdge', () =>
  relievePlatformIdleWithSecondaryEdge({
        timelines,
        selectedRoutes: routesForBerth,
        successorPolicy: engineInput.successorPolicy,
        minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
        collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
        warnings: round === 0 ? warnings : [],
      }));

    /**
     * 繞不去別站 → 開進附近設施格暫停放。這一支<strong>呼叫兩次</strong>：
     * 這裡（迴圈內）讓站位求解器在同一輪看得到讓出來的站格；整備轉場卡插完之後
     * 再呼叫一次，把跟轉場卡撞到的那幾筆丟掉。它會先清掉自己上一次插的卡再重算，
     * 重複呼叫不會疊加。
     *
     * 只放後面不行——求解器的延後與改派備用線在迴圈裡就定案了，站格再讓也沒人
     * 受益（2026-08-17 實測：只放後面，指標與不做完全相同）。
     */
    runGuarded('relievePlatformIdleWithFacilityPark', () =>
  relievePlatformIdleWithFacilityPark({
        timelines,
        standbyFacilityCodes,
        selectedRoutes: routesForBerth,
        topology: engineInput.pointTopology,
        collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
        minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
      }).timelines);

    // 班距太疏 → 把後車往前拉回目標
    runGuarded('densifyRouteHeadwaysAfterBerth', () =>
  densifyRouteHeadwaysAfterBerth({
        timelines,
        selectedRoutes: routesForBerth,
        intervals: engineInput.intervals,
        attributes: engineInput.attributes,
        minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
        collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      }));

    // 班距太擠 → 把後車往後推；推不夠再借前車的既有餘裕
    runGuarded('repairRouteHeadwaysBelowTarget', () =>
  repairRouteHeadwaysBelowTarget({
        timelines,
        selectedRoutes: routesForBerth,
        intervals: engineInput.intervals,
        attributes: engineInput.attributes,
        minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
        collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      }));

    // 正線可吃接下來那段整備的開頭（有重疊才讓）
    runGuarded('applyMainlineMaintenanceEntryYield', () =>
      applyMainlineMaintenanceEntryYield(timelines));

    // 不准佔用整備尾巴：壓到前一段整備的正線，整趟推到整備結束之後
    runGuarded('pushPassengerPastPrecedingYard', () =>
      pushPassengerPastPrecedingYard(timelines));

    /**
     * 撤掉不成輪的尾巴。<strong>留在迴圈內</strong>——它是破壞性算子（刪班次），
     * 照理不該待在不動點迴圈裡，2026-08-20 也實測搬到迴圈外過：班次 +1，但多出
     * 一筆 ROTATION_CYCLE_INCOMPLETE（某段 21 趟、須為 4 的整數倍），連跑到不動點
     * 也清不掉——它清的是列尾，而驗證器是逐段檢查「每一段整備之前」。搬出去等於
     * 讓後續處理再也沒有機會把那一段補齊。
     *
     * 它原本會讓班次一路流失（1096 → 972）的問題，已經由每一道的全域評分閘門
     * 解決（其他處理不會再為了自己的指標把版面弄亂、逼出新的不成輪）。
     */
    timelines = trimIncompleteRotationCyclesOnTimelines({
      timelines,
      routeCount: engineInput.passengerRoutes.length,
    }).timelines;

    const roundScore = scoreOf(timelines);
    if (bestScore === null || comparePlanScores(roundScore, bestScore) < 0) {
      bestScore = roundScore;
      bestTimelines = snapshotOf(timelines);
      bestRound = round;
    }

    if (fingerprintTimelines(timelines) === before) {
      converged = true;
      break;
    }
  }

  if (rejectedPasses.size > 0) {
    const ranked = [...rejectedPasses.entries()].sort((a, b) => b[1] - a[1]);
    // 這是過程紀錄（某道處理的嘗試被安全閘拒絕），不是場域容量極限，歸策略說明
    pushIssue(warnings, {
      code: 'GEOMETRY_PASS_REVERTED',
      severity: 'warning',
      kind: 'policy',
      message:
        '過程紀錄：幾何後處理有處理被全域評分閘門整道撤回——它讓整張班表依優先序'
        + `（不碰撞 > 班距 > 班次穩定）變差了：${ranked.map(([name, count]) => `${name} ${count} 次`).join('、')}。`
        + '班表本身不受影響（那些動作等於沒發生），這不代表場域容量到了極限；撤回次數高的'
        + '處理代表它的策略與其他處理衝突，值得回頭檢討。',
      detail: { rejectedPasses: Object.fromEntries(ranked) },
    });
  }

  if (bestTimelines && bestScore) {
    const finalScore = scoreOf(timelines);
    if (comparePlanScores(bestScore, finalScore) < 0) {
      timelines = bestTimelines;
      pushIssue(warnings, {
        code: 'GEOMETRY_BEST_ROUND_USED',
        severity: 'warning',
        kind: 'limit',
        message:
          `幾何後處理沒有收斂到不動點，改用過程中最好的第 ${bestRound + 1} 輪：`
          + `${formatPlanScore(bestScore)}`
          + `（最後一輪是 ${formatPlanScore(finalScore)}）。`
          + `這代表迴圈裡的處理仍在互相推翻，班表雖然可用，但還沒有穩定解。`,
        detail: {
          bestRound: bestRound + 1,
          bestScore: bestScore.detail,
          lastScore: finalScore.detail,
        },
      });
    }
  }
  /**
   * 誰把別人推晚的：把整個迴圈累積的站位延後依「擋路的那一張卡」歸戶。
   *
   * 逐筆列出沒有用——同一張卡會在十幾輪裡反覆把同一批班次往後推，逐筆是雜訊。
   * 依擋路者歸戶才看得出結構：某一台車佔著某一站不走，一整天累計害了多少班次、
   * 總共推遲多少秒。要消掉延後就是去處理那張卡，不是去調延後上限。
   */
  if (berthDelayLog.length > 0) {
    type Source = {
      stationId: string;
      stationName: string;
      blockerRow?: number;
      /** 擋路的是同一列自己的前一趟（折返銜接），不是別台車 */
      selfBlocked: boolean;
      victims: Set<string>;
      totalSeconds: number;
      worstSeconds: number;
      worstVictimRow: number;
    };
    const sources = new Map<string, Source>();
    let unattributedSeconds = 0;
    for (const record of berthDelayLog) {
      if (!record.binding?.stationId) {
        unattributedSeconds += record.delaySeconds;
        continue;
      }
      const key = `${record.binding.blockerBlockId ?? '?'}@${record.binding.stationId}`;
      const selfBlocked = record.binding.blockerRow === record.timelineRow;
      const entry = sources.get(key) ?? {
        stationId: record.binding.stationId,
        stationName: record.binding.stationName,
        blockerRow: record.binding.blockerRow,
        selfBlocked,
        victims: new Set<string>(),
        totalSeconds: 0,
        worstSeconds: 0,
        worstVictimRow: record.timelineRow,
      };
      entry.victims.add(record.blockId);
      entry.totalSeconds += record.delaySeconds;
      if (record.delaySeconds > entry.worstSeconds) {
        entry.worstSeconds = record.delaySeconds;
        entry.worstVictimRow = record.timelineRow;
      }
      sources.set(key, entry);
    }
    const ranked = [...sources.values()].sort((a, b) => b.totalSeconds - a.totalSeconds);
    const shown = ranked.slice(0, BERTH_DELAY_SOURCE_REPORT_LIMIT);
    for (const source of shown) {
      pushIssue(warnings, {
        code: 'STATION_BERTH_DELAY_SOURCE',
        severity: 'warning',
        kind: 'actionable',
        message:
          (source.selfBlocked
            ? `時間線 ${source.blockerRow ?? '?'} 自己的前一趟還沒離開「${source.stationName}」，`
              + `後面那幾趟只能等——`
            : `「${source.stationName}」被時間線 ${source.blockerRow ?? '?'} 的車佔著，`
              + `站位求解為了讓路，`)
          + `整個收斂過程共把 ${source.victims.size} 個班次往後推、`
          + `累計 ${Math.round(source.totalSeconds)} 秒；`
          + `單筆最久的一次是時間線 ${source.worstVictimRow} 被推 `
          + `${Math.round(source.worstSeconds)} 秒。`
          + `\n延後會沿著同一列往後傳：一趟被推遲，該列後面每一趟都跟著整體平移`
          + `（pushSameRowNextAfterPrevious），所以這裡的累計秒數是連鎖後的總量。`,
        detail: {
          stationId: source.stationId,
          stationName: source.stationName,
          blockerTimelineRow: source.blockerRow,
          delayedTripCount: source.victims.size,
          totalDelaySeconds: Math.round(source.totalSeconds),
          worstDelaySeconds: Math.round(source.worstSeconds),
          worstTimelineRow: source.worstVictimRow,
          selfBlocked: source.selfBlocked,
        },
      });
    }
    if (ranked.length > shown.length || unattributedSeconds > 0) {
      const rest = ranked.slice(shown.length);
      pushIssue(warnings, {
        code: 'STATION_BERTH_DELAY_SOURCE',
        severity: 'warning',
        kind: 'actionable',
        message:
          `另有 ${rest.length} 個擋路點沒有逐則列出（累計 `
          + `${Math.round(rest.reduce((sum, item) => sum + item.totalSeconds, 0))} 秒）`
          + (unattributedSeconds > 0
            ? `；還有 ${Math.round(unattributedSeconds)} 秒的延後找不到明確擋路者`
            : ''),
        detail: {
          omittedSourceCount: rest.length,
          omittedDelaySeconds: Math.round(
            rest.reduce((sum, item) => sum + item.totalSeconds, 0),
          ),
          unattributedDelaySeconds: Math.round(unattributedSeconds),
        },
      });
    }
  }

  if (!converged) {
    /**
     * 跑完上限輪數版面還在變＝這一輪的結果<strong>不是不動點</strong>。
     *
     * 先前這裡是直接離開，沒有任何回報——「收斂完成」跟「跑完 8 輪還在動」
     * 在輸出上完全一樣。差別很大：後者的站位錯誤可能只是輪數不夠，不是設定
     * 有問題，但使用者分辨不出來，只會去改設定（2026-08-11 複查時發現）。
     */
    pushIssue(warnings, {
      code: 'GEOMETRY_NOT_CONVERGED',
      severity: 'warning',
      kind: 'limit',
      message:
        `幾何後處理跑滿 ${GEOMETRY_CONVERGENCE_MAX_ROUNDS} 輪仍未收斂——`
        + `下面的站位與班距問題有一部分可能只是還沒處理完，不一定是設定有問題。`,
      detail: { rounds: GEOMETRY_CONVERGENCE_MAX_ROUNDS },
    });
  }

  // 整備後首班代號：所有幾何後處理完成後再標記，避免站位／讓渡弄丟前綴。
  // 規則：整備（保養／行檢／充電／待命）後第一個正線一律掛「整備代號+路線代號」。
  timelines = tagYardDispatchTrips({
    timelines,
    origins: engineInput.firstTripOrigins,
    maintenanceBody: engineInput.maintenanceBody,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    selectedRoutes: engineInput.selectedRoutes,
  });
  timelines = scrubMidMainlineDispatchArtifacts(timelines);

  // 整備轉場卡（入廠 MI／出廠 MO／整備間轉場）：每一種整備任務共用同一套
  // 機制，依「這一段整備的左右鄰居是什麼」自己判斷該補入廠、出廠，還是
  // 兩者成對的轉場——不是三張各自寫死的卡。入廠：串首補，開始提前、結束
  // 不動；出廠：串尾補，往前貼齊下一段發車、空間不夠可吃整備尾巴；轉場：
  // 串內部兩段不同類型整備直接銜接，前一段跑滿全長，後一段開始被推遲、
  // 結束不動。三段共用同一份設施佔用表，見 insertMaintenanceTransferCards.ts。
  type JunctionReservation = { nodeId: string; instant: number; timelineRow: number };
  type YardSpotAvoid = { blockId: string; nodeId: string };
  const runTransfer = (
    candidate: GeneratedSchedulePlan['timelines'],
    reservedJunctionPasses?: JunctionReservation[],
    avoidYardSpots?: YardSpotAvoid[],
  ) =>
    insertMaintenanceTransferCards({
      reservedJunctionPasses,
      avoidYardSpots,
      searchBudget,
      maintenanceEntrySlackBySection: engineInput.maintenanceEntrySlackBySection,
      timelines: candidate,
      topology: engineInput.pointTopology,
      areas: engineInput.areas,
      maintenanceBody: engineInput.maintenanceBody,
      selectedRoutes: engineInput.selectedRoutes,
      minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
      collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    });

  /**
   * 繞不去別站（關聯圖上沒有回得來的路線）→ 開進附近設施格暫停放，時間到再回來。
   *
   * 放在<strong>整備轉場卡之後</strong>，不在幾何收斂迴圈裡。原因是轉場卡是迴圈
   * 跑完才真正插進去的（迴圈裡只先決定地點），在迴圈裡看到的空檔其實已被預定；
   * 2026-08-17 第一版擺在迴圈內，硬塞的結果是 391 則 TIMELINE_OVERLAP。
   */
  const runFinalRelieveFull = (
    candidate: GeneratedSchedulePlan['timelines'],
    sink: FeasibilityIssue[],
    onlyRows?: ReadonlySet<number>,
  ) =>
    relievePlatformIdleWithFacilityPark({
      timelines: candidate,
      standbyFacilityCodes,
      selectedRoutes: routesForBerth,
      topology: engineInput.pointTopology,
      collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
      onlyRows,
      warnings: sink,
    });
  const runFinalRelieve = (
    candidate: GeneratedSchedulePlan['timelines'],
    sink: FeasibilityIssue[],
    onlyRows?: ReadonlySet<number>,
  ) => runFinalRelieveFull(candidate, sink, onlyRows).timelines;
  /**
   * 讓站之後的兩道收尾。
   *
   * 整備前面不留空白：車已經在格子裡了，整備就從那一刻開始（結束不動）。放在讓渡
   * 之後——讓渡會把入廠卡往前挪，挪完才知道車實際幾點到格子。
   *
   * 收尾微調：早到幾秒卡進別人碰撞保護窗的，往後挪剛好差的那幾秒。<strong>必須放在
   * 最後面。</strong>它挪的是「到站後反正要空等」的車，對那台車本身零代價；但那段空等
   * 同時也是站位讓渡拿來解衝突的資源，放在收斂迴圈裡先用掉，讓渡就沒東西可用
   * （2026-08-20 兩種寫法都實測過：迴圈內動手，最終站位碰撞從 1 對變成 3 對）。
   * 每挪一趟都用同一把全域尺驗證一次，沒變好就還原那一次。
   */
  const finishAfterRelieve = (
    candidate: GeneratedSchedulePlan['timelines'],
    sink: FeasibilityIssue[],
  ): GeneratedSchedulePlan['timelines'] => {
    const closed = closeYardHeadGaps({ timelines: candidate }).timelines;
    let reference = scoreOf(closed);
    let referenceViolations = collectPlanViolations(evaluationContext, closed);
    yieldIdleBlockArrival({
      timelines: closed,
      selectedRoutes: routesForBerth,
      collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      warnings: sink,
      accept: () => {
        const next = scoreOf(closed);
        if (comparePlanScores(next, reference) >= 0) return false;
        const violations = collectPlanViolations(evaluationContext, closed);
        if (!compareViolations(referenceViolations, violations).safeToAdopt) return false;
        reference = next;
        referenceViolations = violations;
        return true;
      },
    });
    return closed;
  };

  /**
   * 迴圈之後的整段後處理：轉場卡 → 讓站 → 收尾 → 暫停卡 → 殘留衝突修復。
   *
   * 包成一段是為了<strong>候選要跑完整段才比較</strong>：在轉場卡之前改了班次時刻，
   * 後面的讓站、暫停卡、殘留修復都會跟著變，只比中途的版面會誤判。每次呼叫都從同一份
   * 迴圈結果的副本開始，重跑不會累加或重複插卡。
   */
  const runPostLoop = (
    pre: GeneratedSchedulePlan['timelines'],
    reservedJunctionPasses?: JunctionReservation[],
    avoidYardSpots?: YardSpotAvoid[],
    /** 篩選用：不跑殘留衝突修復（只看轉場排不排得出，快很多） */
    screenOnly = false,
  ) => {
    const transfer = runTransfer(snapshotOf(pre), reservedJunctionPasses, avoidYardSpots);
    const sink: FeasibilityIssue[] = [];
    const relieved = runFinalRelieveFull(transfer.timelines, sink);
    let result = finishAfterRelieve(relieved.timelines, sink);
    /**
     * 補上「暫停」卡：整備做完、車還在格子裡的那段。放在所有會動時刻的處理跑完之後、
     * 驗證之前：這幾張卡是事實的載體，不是新規則。
     */
    result = fillYardHoldGaps({ timelines: result, selectedRoutes: routesForBerth }).timelines;
    /**
     * 殘留站位衝突：依衝突邊界產生候選、雙方都試，副本上整組驗證後才採用
     * （見 resolveResidualConflicts）。候選改了哪一列，就重建那一列的暫停卡與讓站。
     */
    const residual: ReturnType<typeof resolveResidualConflicts> = screenOnly
      ? { timelines: result, applied: [], warnings: [], attempts: [], evaluations: 0, budgetExhausted: false }
      : resolveResidualConflicts({
        timelines: result,
        ctx: evaluationContext,
        budget: residualBudget,
        searchBudget,
        replanRows: (candidate, rows) => {
          const replanSink: FeasibilityIssue[] = [];
          return { timelines: runFinalRelieve(candidate, replanSink, rows), warnings: replanSink };
        },
      });
    result = residual.timelines;
    // 候選重排過讓站的那幾列：對不到實際卡片的「已改開進某格暫停放」收回，換上採用的訊息
    const changedRows = new Set(residual.applied.map((edit) => edit.timelineRow));
    if (changedRows.size > 0) {
      const parkCards = result.flatMap((timeline) => timeline.blocks)
        .filter((block) => block.id.startsWith('berthpark-'))
        .map((block) => block.id);
      for (let index = sink.length - 1; index >= 0; index -= 1) {
        const issue = sink[index]!;
        if (issue.code !== 'STATION_BERTH_ARRIVAL_YIELDED') continue;
        const detail = issue.detail as { timelineRow?: number; blockId?: string } | undefined;
        if (detail?.timelineRow == null || !changedRows.has(detail.timelineRow)) continue;
        if (!parkCards.some((id) => detail.blockId && id.includes(detail.blockId))) sink.splice(index, 1);
      }
      sink.push(...residual.warnings);
    }
    const required = transfer.skipped.filter((skip) => skip.necessity !== 'not_needed').length;
    if (engineTraceEnabled()) {
      engineTrace('post-loop', {
        required,
        skipped: transfer.skipped.map((skip) => ({
          row: skip.timelineRow, blockId: skip.blockId, from: skip.fromTaskType, to: skip.toTaskType,
          necessity: skip.necessity ?? 'required', reason: skip.reason, blockers: skip.blockers,
        })),
        residualApplied: residual.applied,
        violations: collectPlanViolations(evaluationContext, result).map((item) => ({ code: item.code, blockIds: item.blockIds })),
      });
    }
    return {
      timelines: result,
      transfer,
      /** 跑完一趟要在站上等進廠、卻沒有地方先進去等的：候選位置各被誰佔著（局部連動搜尋用） */
      entryWaitUnresolved: relieved.entryWaitUnresolved,
      warnings: sink,
      residual,
      violations: collectPlanViolations(evaluationContext, result),
      required,
    };
  };

  /**
   * 搜尋用的整段後處理：同一個（轉場前版面, 轉折點保留, 待命排除）只算一次；
   * 新狀態要先扣共用預算，用盡回 null——呼叫端停止這一段搜尋，保留目前最好的結果。
   */
  const postLoopCache = new Map<string, ReturnType<typeof runPostLoop>>();
  const postLoopKey = (
    pre: GeneratedSchedulePlan['timelines'],
    reservations?: JunctionReservation[],
    avoid?: YardSpotAvoid[],
  ) => `${planStateKey(pre)}|${JSON.stringify(reservations ?? [])}|${JSON.stringify(avoid ?? [])}`;
  const searchPostLoop = (
    pre: GeneratedSchedulePlan['timelines'],
    reservations?: JunctionReservation[],
    avoid?: YardSpotAvoid[],
  ): ReturnType<typeof runPostLoop> | null => {
    const key = postLoopKey(pre, reservations, avoid);
    const cached = postLoopCache.get(key);
    if (cached) return cached;
    if (!searchBudget.tryCandidate()) return null;
    const result = runPostLoop(pre, reservations, avoid);
    postLoopCache.set(key, result);
    return result;
  };

  /**
   * 篩選：候選只為了讓「必要轉場排不出」變少時，先不跑殘留衝突修復（佔整段後處理大部分時間），
   * 轉場排得出來才做完整評估。轉場在殘留修復之前就定案，篩選結果跟完整評估的轉場結果相同。
   * 回傳 null＝預算用盡。
   */
  const screenCache = new Map<string, number>();
  const screenRequired = (
    pre: GeneratedSchedulePlan['timelines'],
    reservations?: JunctionReservation[],
    avoid?: YardSpotAvoid[],
  ): number | null => {
    const key = postLoopKey(pre, reservations, avoid);
    const full = postLoopCache.get(key);
    if (full) return full.required;
    const cached = screenCache.get(key);
    if (cached != null) return cached;
    if (!searchBudget.tryCandidate()) return null;
    const required = runPostLoop(pre, reservations, avoid, true).required;
    screenCache.set(key, required);
    return required;
  };

  const preTransfer = snapshotOf(timelines);
  traceLayout('pre-transfer', timelines);

  /**
   * 必要轉場排不出來時的聯動搜尋
   * ============================
   *
   * 狀態＝（轉場前的版面, 轉折點保留, 跑完整段後處理的結果）。每一筆必要轉場失敗，
   * 由它自己的失敗原因推出候選：
   *
   * - 轉折點保留：只輸在「別列車的移動先訂走轉折點」時，把它原訂要經過的節點先保留給它，
   *   整段重排，讓彈性大的移動（可以晚一點出發的整備間轉場）去閃——先處理到的先贏，
   *   不代表先處理到的比較沒得挪。
   * - 出廠往後錯開才過得去（skip.exitDelay，量由轉折點預約邊界算出）：下一班晚發壓縮
   *   行駛、或整串推移（只吃空檔扣掉必要間隔的餘裕）。
   * - 換起點：下一班改跑同終點、下游相同的已允許路線。
   *
   * 每個候選都在副本上跑完整段後處理。必要轉場失敗真的變少、且沒有新增任何硬錯誤或安全
   * 問題才採用；採用後的狀態疊加（保留與改動都留著），再找下一筆。候選減少了失敗、只多出
   * 站位問題時，往下一層：對新站位問題牽涉的班次試換起點，整組完成後仍要比採用前好。
   * 輪數以一開始的失敗數為上限（每採用一次至少少一筆）。
   */
  type PostState = {
    pre: GeneratedSchedulePlan['timelines'];
    reservations: JunctionReservation[];
    /** 整備不要再選的位置（見「待命替換換下一個位置」與「局部連動搜尋」）；之前各步都是空的 */
    avoidYardSpots?: YardSpotAvoid[];
    post: ReturnType<typeof runPostLoop>;
    notes: FeasibilityIssue[];
  };
  const noNewProblems = (before: PlanViolation[], after: PlanViolation[]) => {
    const comparison = compareViolations(before, after);
    return {
      ok: comparison.safeToAdopt,
      introduced: comparison.introduced,
    };
  };
  const rerouteNote = (row: number, blockId: string, from: string, to: string, why: string): FeasibilityIssue => ({
    code: 'ROUTE_ALIGNED_TO_VEHICLE_LOCATION',
    severity: 'warning',
    kind: 'policy',
    message:
      `時間線 ${row}：${why}，已把「${from}」改派為同終點、下游相同的「${to}」，`
      + '從它的起點站發車；班次時刻不變。',
    detail: { timelineRow: row, blockId, fromRouteId: from, toRouteId: to },
  });

  let state: PostState = {
    pre: preTransfer,
    reservations: [],
    post: runPostLoop(preTransfer),
    notes: [],
  };
  postLoopCache.set(postLoopKey(preTransfer), state.post);
  const triedNotes = new Map<string, string[]>();
  const note = (blockId: string | undefined, text: string) => {
    const list = triedNotes.get(blockId ?? '') ?? [];
    if (list.length < 6) list.push(text);
    triedNotes.set(blockId ?? '', list);
  };
  const maxRounds = state.post.required;
  for (let round = 0; round < maxRounds; round += 1) {
    let adopted: PostState | null = null;
    const base = state;
    for (const skip of base.post.transfer.skipped) {
      if (adopted) break;
      if (skip.necessity === 'not_needed') continue;
      // 只輸在缺行駛時間：是缺資料，不是時序衝突，換時刻、換路線都解不了，不在這裡反覆搜
      if (skip.onlyMissingData) {
        note(skip.blockId, '缺少路段行駛時間，沒有其他資料完整的路徑；未搜尋移動時刻');
        continue;
      }
      type Candidate = {
        label: string;
        pre: GeneratedSchedulePlan['timelines'] | null;
        reservations: JunctionReservation[];
        notes: FeasibilityIssue[];
      };
      const candidates: Candidate[] = [];
      if (skip.junctionReservation?.length) {
        candidates.push({
          label: '把原訂經過的轉折點先保留給它、其他移動去閃',
          pre: base.pre,
          reservations: [
            ...base.reservations,
            ...skip.junctionReservation.map((pass) => ({ ...pass, timelineRow: skip.timelineRow })),
          ],
          notes: [],
        });
      }
      if (skip.exitDelay) {
        const delayMinutes = snapUpToClockAlignSeconds(skip.exitDelay.seconds) / 60;
        const delaySeconds = Math.round(delayMinutes * 60);
        const nextBlockId = skip.exitDelay.nextBlockId;
        for (const [startShift, endShift, label] of [
          [delayMinutes, 0, `下一班晚 ${delaySeconds} 秒發車、壓縮行駛（到站不變）`],
          [delayMinutes, delayMinutes, `下一班起整串推移 ${delaySeconds} 秒`],
        ] as const) {
          const edited = shiftTripInCopy(base.pre, nextBlockId, startShift, endShift, evaluationContext, label);
          candidates.push({
            label: edited?.description ?? label,
            pre: edited?.timelines ?? null,
            reservations: base.reservations,
            notes: [],
          });
        }
        for (const item of rerouteTripInCopy(base.pre, nextBlockId, evaluationContext)) {
          const from = item.fromRoute.routeName ?? item.fromRoute.routeId;
          const to = item.toRoute.routeName ?? item.toRoute.routeId;
          candidates.push({
            label: item.description,
            pre: item.timelines,
            reservations: base.reservations,
            notes: [rerouteNote(skip.timelineRow, nextBlockId, from, to, '整備後的出廠卡原本排不出（原起點的路徑或站位被擋）')],
          });
        }
      }
      for (const candidate of candidates) {
        if (!candidate.pre) {
          note(skip.blockId, `${candidate.label}：超出合法行駛範圍或前後任務間隔`);
          continue;
        }
        const screened = screenRequired(candidate.pre, candidate.reservations);
        if (screened === null) {
          note(skip.blockId, `${candidate.label}：搜尋預算用盡，未試`);
          break;
        }
        if (screened >= base.post.required) {
          note(skip.blockId, `${candidate.label}：移動仍排不出`);
          continue;
        }
        const result = searchPostLoop(candidate.pre, candidate.reservations);
        if (!result) {
          note(skip.blockId, `${candidate.label}：搜尋預算用盡，未試`);
          break;
        }
        const check = noNewProblems(base.post.violations, result.violations);
        if (result.required < base.post.required && check.ok) {
          adopted = { pre: candidate.pre, reservations: candidate.reservations, post: result, notes: [...base.notes, ...candidate.notes] };
          break;
        }
        // 下一層：失敗變少、只多出站位問題 → 對牽涉的班次試換起點
        const stationOnly = check.introduced.length > 0
          && check.introduced.every((item) => item.code.startsWith('STATION_BERTH_'));
        if (result.required < base.post.required && stationOnly) {
          const involved = [...new Set(check.introduced.flatMap((item) => item.blockIds))];
          for (const blockId of involved) {
            if (adopted) break;
            for (const item of rerouteTripInCopy(candidate.pre, blockId, evaluationContext)) {
              const deeper = searchPostLoop(item.timelines, candidate.reservations);
              if (!deeper) break;
              if (deeper.required < base.post.required && noNewProblems(base.post.violations, deeper.violations).ok) {
                const from = item.fromRoute.routeName ?? item.fromRoute.routeId;
                const to = item.toRoute.routeName ?? item.toRoute.routeId;
                const row = item.timelines.find((timeline) => timeline.blocks.some((block) => block.id === blockId))?.row ?? skip.timelineRow;
                adopted = {
                  pre: item.timelines,
                  reservations: candidate.reservations,
                  post: deeper,
                  notes: [
                    ...base.notes,
                    ...candidate.notes,
                    rerouteNote(row, blockId, from, to, `配合時間線 ${skip.timelineRow} 的整備移動讓出站位`),
                  ],
                };
                break;
              }
            }
          }
          if (adopted) break;
        }
        note(
          skip.blockId,
          `${candidate.label}：`
          + (result.required >= base.post.required
            ? '移動仍排不出'
            : `引出 ${check.introduced.map((item) => item.code).join('、') || '更多安全問題'}`),
        );
      }
    }
    if (!adopted) break;
    state = adopted;
  }
  // 時刻調整仍解不了的站位衝突，也要試已允許的同終點路線。
  // 路線與出入廠移動一起重算；不能只改正線卡而留下舊移動路徑。
  const stationRepairRounds = state.post.violations.filter((issue) => issue.code.startsWith('STATION_BERTH_')).length;
  for (let round = 0; round < stationRepairRounds; round += 1) {
    const base = state;
    let adopted: PostState | null = null;
    const involved = [...new Set(base.post.violations
      .filter((issue) => issue.code.startsWith('STATION_BERTH_')).flatMap((issue) => issue.blockIds))];
    for (const blockId of involved) {
      for (const candidate of rerouteTripInCopy(base.pre, blockId, evaluationContext)) {
        const result = searchPostLoop(candidate.timelines, base.reservations);
        if (!result) break;
        if (result.required > base.post.required
          || !compareViolations(base.post.violations, result.violations).better) continue;
        const row = candidate.timelines.find((timeline) => timeline.blocks.some((block) => block.id === blockId))!.row;
        adopted = { pre: candidate.timelines, reservations: base.reservations, post: result,
          notes: [...base.notes, rerouteNote(row, blockId,
            candidate.fromRoute.routeName ?? candidate.fromRoute.routeId,
            candidate.toRoute.routeName ?? candidate.toRoute.routeId, '避開尚未排開的站位衝突')] };
        break;
      }
      if (adopted) break;
      // 停在站上等下一班的那台：進站那一趟與下一班一起換到同一區另一個停靠位
      for (const candidate of rerouteBerthPairInCopy(base.pre, blockId, evaluationContext)) {
        const result = searchPostLoop(candidate.timelines, base.reservations);
        if (!result) break;
        if (result.required > base.post.required
          || !compareViolations(base.post.violations, result.violations).better) continue;
        const row = candidate.timelines.find((timeline) => timeline.blocks.some((block) => block.id === blockId))!.row;
        adopted = { pre: candidate.timelines, reservations: base.reservations, post: result,
          notes: [...base.notes, {
            code: 'ROUTE_ALIGNED_TO_VEHICLE_LOCATION',
            severity: 'warning',
            kind: 'policy',
            message:
              `時間線 ${row}：為避開尚未排開的站位衝突，${candidate.description}；`
              + '兩趟的時刻不變，起訖站與下游銜接都在已驗證的路線關聯內。',
            detail: {
              timelineRow: row,
              blockId,
              fromRouteIds: candidate.fromRoutes.map((route) => route.routeId),
              toRouteIds: candidate.toRoutes.map((route) => route.routeId),
            },
          }] };
        break;
      }
      if (adopted) break;
    }
    if (!adopted) break;
    state = adopted;
  }
  /**
   * 殘留修復之後，重算轉場與佔用
   * ============================
   *
   * 後處理的順序是「轉場卡 → 讓站 → 暫停卡 → 殘留修復」：轉場卡（與它的失敗清單）是照
   * 修復<strong>之前</strong>的班次時刻排的。修復改了班次時刻之後，原本排不出的轉場可能
   * 已經排得出來、原本的失敗原因可能已經不存在——只算一次的話，最終報告會帶著過期的
   * 「必要轉場缺失」。
   *
   * 做法：把修復改過的班次時刻寫回「轉場前的版面」，整段後處理重跑一次。重跑是從轉場前的
   * 副本開始，系統產生的移動卡、讓站卡、暫停卡全部重建，使用者任務不動，不會重複插卡；
   * 失敗清單、佔用與安全報告都是新版面自己的。
   *
   * 停止條件：必要轉場失敗變少且沒有新增安全問題、或整體變好才採用；否則停，保留原結果。
   * 只在還有未解問題（必要轉場失敗或安全問題）時才重算，最多幾輪。
   */
  for (let round = 0; round < POST_RESIDUAL_RECOMPUTE_ROUNDS; round += 1) {
    const base = state;
    const unresolvedSafety = base.post.violations.some((item) => item.severity !== 'quality');
    if (base.post.residual.applied.length === 0) break;
    if (base.post.required === 0 && !unresolvedSafety) break;
    const carried = carryTripEditsIntoPre(base.pre, base.post.timelines);
    if (carried.changed === 0) break;
    const result = searchPostLoop(carried.timelines, base.reservations, base.avoidYardSpots);
    if (!result) break;
    const comparison = compareViolations(base.post.violations, result.violations);
    const adopt = (result.required < base.post.required && comparison.safeToAdopt)
      || (result.required <= base.post.required && comparison.better);
    engineTrace('post-residual-recompute', {
      round,
      carriedTrips: carried.changed,
      requiredBefore: base.post.required,
      requiredAfter: result.required,
      violationsBefore: base.post.violations.length,
      violationsAfter: result.violations.length,
      adopted: adopt,
    });
    if (!adopt) break;
    state = {
      pre: carried.timelines, reservations: base.reservations, avoidYardSpots: base.avoidYardSpots,
      post: result, notes: base.notes,
    };
  }
  /**
   * 待命替換換下一個位置
   * ==================
   *
   * 待命在原定位置排不出入廠時，轉場模組會改停待命清單上成本最低、排得出的位置。那個選擇
   * 只看待命自己：換過去的位置可能正是別列車讓站、等候要用的格子（實錄：待命換到某設施格，
   * 另一列車跑完最後一趟要在那格等進廠，被擠回正線站上等，撞到後車）。
   *
   * 還有安全問題時，對每一筆替換試「排除它現在的位置、整段重算」——替換改用清單上的下一個
   * 位置，進場、停留、出場、讓站、殘留修復全部照新位置重排。整體安全問題變少、且必要轉場
   * 失敗沒有變多才採用；沒採用就再排除一個、換下一個位置，直到替換本身排不出為止。
   * 每筆替換最多換幾次，總試算次數有上限。
   */
  const STANDBY_ALTERNATIVE_TRIES_PER_RELOCATION = 4;
  const STANDBY_ALTERNATIVE_MAX_EVALUATIONS = 12;
  const safetyCount = (items: PlanViolation[]) => items.filter((item) => item.severity !== 'quality').length;
  let standbyEvaluations = 0;
  standbySearch: while (standbyEvaluations < STANDBY_ALTERNATIVE_MAX_EVALUATIONS) {
    const base = state;
    if (!base.post.violations.some((item) => item.severity !== 'quality')) break;
    const relocations = base.post.transfer.standbyRelocations;
    if (relocations.length === 0) break;
    for (const relocation of relocations) {
      let avoid = [...(base.avoidYardSpots ?? [])];
      let current: { toNodeId: string; toLabel: string } | undefined = relocation;
      const tried: string[] = [];
      for (let attempt = 0; attempt < STANDBY_ALTERNATIVE_TRIES_PER_RELOCATION && current; attempt += 1) {
        if (standbyEvaluations >= STANDBY_ALTERNATIVE_MAX_EVALUATIONS) break standbySearch;
        avoid = [...avoid, { blockId: relocation.blockId, nodeId: current.toNodeId }];
        tried.push(current.toLabel);
        standbyEvaluations += 1;
        const result = searchPostLoop(base.pre, base.reservations, avoid);
        if (!result) break standbySearch;
        const comparison = compareViolations(base.post.violations, result.violations);
        const next = result.transfer.standbyRelocations.find((item) => item.blockId === relocation.blockId);
        const adopt = result.required <= base.post.required && comparison.better;
        engineTrace('standby-alternative', {
          row: relocation.timelineRow,
          blockId: relocation.blockId,
          avoided: tried,
          nowAt: next?.toLabel ?? null,
          requiredBefore: base.post.required,
          requiredAfter: result.required,
          violationsBefore: base.post.violations.length,
          violationsAfter: result.violations.length,
          adopted: adopt,
        });
        if (adopt) {
          state = {
            pre: base.pre,
            reservations: base.reservations,
            avoidYardSpots: avoid,
            post: result,
            notes: [...base.notes, {
              code: 'MAINTENANCE_FACILITY_YIELDED',
              severity: 'warning',
              kind: 'policy',
              message:
                `時間線 ${relocation.timelineRow}：待命替換沒有停「${tried.join('」「')}」——`
                + `停在那裡會擋住別列車讓站或進廠，整張班表的安全問題由 ${safetyCount(base.post.violations)} 筆`
                + `降為 ${safetyCount(result.violations)} 筆；改停「${next?.toLabel ?? '原定位置'}」。`,
              detail: {
                timelineRow: relocation.timelineRow,
                blockId: relocation.blockId,
                taskType: 'standby',
                avoidedFacilityLabels: tried,
                facilityLabel: next?.toLabel ?? null,
              },
            }],
          };
          continue standbySearch;
        }
        // 新位置害別列車排不出轉場也不採用，但清單上還有下一個位置就繼續換；
        // 替換本身排不出（沒有下一個位置）才停
        current = next;
      }
    }
    break;
  }
  /**
   * 局部連動搜尋：擋路的是別張卡的停放位置
   * ==================================
   *
   * 站位衝突常常是「跑完一趟要等進廠的車，找不到地方先進去等」——候選的等待位置都被別的
   * 整備佔著；必要轉場排不出、設施格兩台車重疊，也常常是被一段可以換位置的待命佔了別人
   * 必須用的設施（實錄：待命停進行檢唯二可用的那一格）。那些佔位的卡（待命、或設施可以換的
   * 整備）如果換到允許清單上的其他位置，位置就空出來了。所以把「擋住的那張卡」拉進同一組
   * 候選：排除它現在的位置、整段重排（它的進場、停留、出場跟著重算）。
   *
   * 中間一步可以暫時引出新問題（例如換過去的位置又擋到第三張卡），這時往下一層：
   * 對新結果裡同樣的擋路者再換一次。只有整組做完、整份班表的安全檢查比採用前好，
   * 且必要轉場失敗沒有變多，才採用。使用者的作業時刻與安全間隔都不動；位置只在允許清單內換。
   * 用共用預算，用盡就停，保留目前最好的結果。
   */
  const LOCAL_SEARCH_MAX_DEPTH = 2;
  const LOCAL_SEARCH_MAX_ROUNDS = 6;
  const yardBlockIds = (timelinesForIds: GeneratedSchedulePlan['timelines']) => new Set(timelinesForIds
    .flatMap((timeline) => timeline.blocks)
    .filter((block) => YARD_TASK_TYPES.has(block.taskType))
    .map((block) => block.id));
  /** 這個結果裡，站位衝突牽涉的等待車：它的候選位置被哪些「可以換位置」的卡擋著 */
  const blockerMoves = (
    candidate: { pre: GeneratedSchedulePlan['timelines']; post: ReturnType<typeof runPostLoop> },
    avoid: YardSpotAvoid[],
  ): YardSpotAvoid[] => {
    const involved = new Set(candidate.post.violations
      .filter((item) => item.severity !== 'quality' && item.code.startsWith('STATION_BERTH_'))
      .flatMap((item) => item.blockIds));
    const movable = yardBlockIds(candidate.pre);
    const out: YardSpotAvoid[] = [];
    const seen = new Set(avoid.map((item) => `${item.blockId}@${item.nodeId}`));
    const add = (blockId: string | undefined, nodeId: string) => {
      if (!blockId || !movable.has(blockId)) return;
      const key = `${blockId}@${nodeId}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ blockId, nodeId });
    };
    for (const item of candidate.post.entryWaitUnresolved) {
      if (!involved.has(item.occupancyBlockId)) continue;
      for (const spot of item.busySpots) for (const blocker of spot.blockers) add(blocker.blockId, spot.nodeId);
    }
    // 必要轉場排不出、擋它的是別張可以換位置的卡：那張卡也一起換
    for (const skip of candidate.post.transfer.skipped) {
      if (skip.necessity === 'not_needed') continue;
      for (const blocker of skip.blockers ?? []) add(blocker.blockingBlockId, blocker.nodeId);
    }
    // 設施格被兩台車同時佔用：兩邊可以換位置的都試著請它換
    const facilityOf = new Map(candidate.post.timelines.flatMap((timeline) => timeline.blocks)
      .map((block) => [block.id, block.yardFacilityNodeId] as const));
    for (const item of candidate.post.violations) {
      if (item.severity === 'quality' || !item.code.startsWith('FACILITY_')) continue;
      for (const blockId of item.blockIds) {
        const nodeId = facilityOf.get(blockId);
        if (nodeId) add(blockId, nodeId);
      }
    }
    return out;
  };
  const localSearch = (
    base: PostState,
    /** 這一層要分析的結果（第一層是採用前的狀態，往下是上一層試出來的結果） */
    current: ReturnType<typeof runPostLoop>,
    avoid: YardSpotAvoid[],
    depth: number,
  ): { avoid: YardSpotAvoid[]; post: ReturnType<typeof runPostLoop> } | 'budget' | null => {
    for (const move of blockerMoves({ pre: base.pre, post: current }, avoid)) {
      const nextAvoid = [...avoid, move];
      const result = searchPostLoop(base.pre, base.reservations, nextAvoid);
      if (!result) return 'budget';
      const comparison = compareViolations(base.post.violations, result.violations);
      engineTrace('local-search', {
        depth, move, requiredBefore: base.post.required, requiredAfter: result.required,
        violationsBefore: base.post.violations.length, violationsAfter: result.violations.length,
        better: comparison.better,
      });
      // 必要轉場失敗變少且沒有新增安全問題、或轉場不變多且整體安全變好，才算這一組成立
      if ((result.required < base.post.required && comparison.safeToAdopt)
        || (result.required <= base.post.required && comparison.better)) return { avoid: nextAvoid, post: result };
      if (depth < LOCAL_SEARCH_MAX_DEPTH) {
        const deeper = localSearch(base, result, nextAvoid, depth + 1);
        if (deeper) return deeper;
      }
    }
    return null;
  };
  for (let round = 0; round < LOCAL_SEARCH_MAX_ROUNDS; round += 1) {
    const base = state;
    if (!base.post.violations.some((item) => item.severity !== 'quality') && base.post.required === 0) break;
    const found = localSearch(base, base.post, base.avoidYardSpots ?? [], 1);
    if (!found || found === 'budget') break;
    const moved = found.avoid.slice((base.avoidYardSpots ?? []).length);
    const labelOf = (nodeId: string) =>
      engineInput.pointTopology?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
    const rowOf = (blockId: string) =>
      base.pre.find((timeline) => timeline.blocks.some((block) => block.id === blockId))?.row;
    state = {
      pre: base.pre,
      reservations: base.reservations,
      avoidYardSpots: found.avoid,
      post: found.post,
      notes: [...base.notes, {
        code: 'MAINTENANCE_FACILITY_YIELDED',
        severity: 'warning',
        kind: 'policy',
        message:
          `為了排開尚未解決的衝突，請 ${moved.map((item) => `時間線 ${rowOf(item.blockId) ?? '?'} 的整備不要停「${labelOf(item.nodeId)}」`).join('、')}，`
          + `改停允許清單上的其他位置（進場、停留、出場一起重算）；安全問題由 `
          + `${safetyCount(base.post.violations)} 筆降為 ${safetyCount(found.post.violations)} 筆、`
          + `必要轉場失敗由 ${base.post.required} 筆降為 ${found.post.required} 筆。作業時刻不變。`,
        detail: {
          blockId: moved[0]?.blockId,
          timelineRow: moved[0] ? rowOf(moved[0].blockId) : undefined,
          movedAwayFrom: moved.map((item) => ({ blockId: item.blockId, facilityLabel: labelOf(item.nodeId) })),
        },
      }],
    };
  }

  const post = state.post;
  post.warnings.push(...state.notes);
  // 試過的聯動候選不寫進主訊息（太長），放進 detail.searchLog，畫面上收在展開區
  const transferSearchLog = new Map<string, string[]>();
  for (const skip of post.transfer.skipped) {
    const list = skip.blockId ? triedNotes.get(skip.blockId) : undefined;
    if (skip.necessity !== 'not_needed' && list && list.length > 0 && skip.blockId) {
      transferSearchLog.set(skip.blockId, [`已在副本上試過（皆未採用）：`, ...list]);
    }
  }
  timelines = post.timelines;
  const maintenanceTransfer = post.transfer;
  const residual = post.residual;
  warnings.push(...post.warnings);

  /**
   * 「不需要轉場」跟「必要轉場失敗」分開分類，不是全部套同一句策略說明。
   *
   * 這一列整天沒有前／後載客任務（`necessity==='not_needed'`）：車沒有要去的
   * 地方，出廠／入廠卡本來就不需要，多半是刻意保留的備援車，歸 policy——
   * 正常情況、收合顯示，需要時使用者自己展開檢查。
   *
   * 後續<strong>有</strong>載客任務、卻排不出合法移動（沒填欄位、拓樸沒接、候選
   * 都被擋⋯）：車實際上到不了它該去的地方，是必要銜接失敗，歸 actionable——
   * 使用者該實際去看，不能跟前者一起被摺疊。訊息維持 `skip.reason`（已經是
   * insertMaintenanceTransferCards 算出來的實際原因，不是套用通用說明）。
   *
   * 必要轉場失敗記<strong>硬錯誤</strong>（MAINTENANCE_TRANSFER_REQUIRED_MISSING）：
   * 車到不了下一段該去的地方，跟站位重疊一樣是物理上做不到的事。班表與班次照樣
   * 保留給使用者檢查、手改；擋的是發布，不是生成。
   */
  const requiredTransferBlockIds = new Set<string>();
  for (const skip of maintenanceTransfer.skipped) {
    const label = skip.fromTaskType && skip.toTaskType
      ? `「${taskTypeName(skip.fromTaskType)}」轉「${taskTypeName(skip.toTaskType)}」`
      : `「${taskTypeName(skip.taskType)}」`;
    const notNeeded = skip.necessity === 'not_needed';
    if (!notNeeded && skip.blockId) requiredTransferBlockIds.add(skip.blockId);
    pushIssue(notNeeded ? warnings : errors, {
      code: notNeeded ? 'MAINTENANCE_TRANSFER_UNRESOLVED' : 'MAINTENANCE_TRANSFER_REQUIRED_MISSING',
      severity: notNeeded ? 'warning' : 'error',
      kind: notNeeded ? 'policy' : 'limit',
      message: notNeeded
        ? `時間線 ${skip.timelineRow}：${label}不需要整備轉場卡——${skip.reason}`
        : skip.onlyMissingData
          ? `時間線 ${skip.timelineRow}：${label}排不出必要的整備轉場卡——缺少路段行駛時間`
            + `（${formatEdgeList(skip.missingTravelTimeEdges ?? [])}）；補齊後才能排移動，未搜尋移動時刻。`
          : `時間線 ${skip.timelineRow}：${label}排不出必要的整備轉場卡——${skip.reason}`,
      detail: {
        timelineRow: skip.timelineRow,
        blockId: skip.blockId,
        taskType: skip.taskType,
        fromTaskType: skip.fromTaskType,
        toTaskType: skip.toTaskType,
        reason: skip.reason,
        necessity: skip.necessity ?? 'required',
        ...(skip.blockers ? { blockers: skip.blockers } : {}),
        ...(skip.missingTravelTimeEdges ? { missingTravelTimeEdges: skip.missingTravelTimeEdges } : {}),
        ...(skip.onlyMissingData ? { onlyMissingData: true } : {}),
        ...(skip.blockId && transferSearchLog.has(skip.blockId)
          ? { searchLog: transferSearchLog.get(skip.blockId) }
          : {}),
      },
    });
  }
  /**
   * 生成前的資料檢查結果：路網上沒填行駛時間的路段，以及因此排不出移動的任務。
   * 缺資料跟排程衝突分開講——這不是容量不足，也不是演算法沒搜完，是要先補資料。
   * 缺值不當 0 秒；正式時間必須來自地圖資料或使用者設定，這裡不自行補值。
   */
  {
    const gaps = listTopologyTravelTimeGaps(engineInput.pointTopology);
    if (gaps.missing.length > 0) {
      const affected = maintenanceTransfer.skipped.filter(
        (skip) => skip.necessity !== 'not_needed' && (skip.missingTravelTimeEdges?.length ?? 0) > 0,
      );
      const used = new Set(affected.flatMap((skip) => skip.missingTravelTimeEdges ?? [])
        .map((edge) => `${edge.fromNodeId}>${edge.toNodeId}`));
      pushIssue(affected.length > 0 ? errors : warnings, {
        code: 'MISSING_TRAVEL_TIME',
        severity: affected.length > 0 ? 'error' : 'warning',
        kind: 'actionable',
        message:
          `路網上有 ${gaps.missing.length} 段沒有行駛時間：${formatEdgeList(gaps.missing)}。`
          + (affected.length > 0
            ? `其中 ${used.size} 段害 ${affected.length} 個必要轉場排不出（時間線 `
              + `${[...new Set(affected.map((skip) => skip.timelineRow))].sort((a, b) => a - b).join('、')}）。`
              + '請到地圖路網補上這些路段的行駛時間；缺值不當 0 秒，補齊前禁止發布。'
            : '目前沒有移動需要經過這些路段，但請到地圖路網確認並補上。'),
        detail: {
          // 點選時跳到第一張受影響的卡（路段本身在地圖路網編輯，班表畫面沒有路段可定位）
          ...(affected[0]?.blockId ? { blockId: affected[0].blockId, timelineRow: affected[0].timelineRow } : {}),
          missingTravelTimeEdges: gaps.missing,
          affectedTasks: affected.map((skip) => ({
            timelineRow: skip.timelineRow,
            blockId: skip.blockId,
            missingTravelTimeEdges: skip.missingTravelTimeEdges,
            onlyMissingData: skip.onlyMissingData === true,
          })),
        },
      });
    }
  }
  // 系統縮短的整備工作時間：哪一張卡、少了多少、剩多少、依據哪個設定，逐筆講出來
  for (const item of maintenanceTransfer.yardWorkShortened) {
    const minutes = (seconds: number) => `${Math.round(seconds / 6) / 10} 分`;
    pushIssue(warnings, {
      code: 'MAINTENANCE_WORK_SHORTENED',
      severity: 'warning',
      kind: 'policy',
      message:
        `時間線 ${item.timelineRow}：「${taskTypeName(item.taskType)}」`
        + (item.kind === 'late-start' ? `晚 ${item.seconds} 秒開始` : `提早 ${item.seconds} 秒結束`)
        + `，實際工作 ${minutes(item.remainingWorkSeconds)}`
        + `（設定最少 ${minutes(item.minimumWorkSeconds)}`
        + (item.limitSeconds != null ? `、讓渡餘裕 ${item.limitSeconds} 秒` : '')
        + `）。原因：${item.reason}。`,
      detail: { ...item },
    });
  }
  // 決策樹第三層：請別列車換一台設施，把位子讓出來。只換格子不動時間，
  // 沒有代價，但要講出來——使用者會發現某列的整備跑到別台設施上了。
  for (const item of maintenanceTransfer.facilityYields) {
    pushIssue(warnings, {
      code: 'MAINTENANCE_FACILITY_YIELDED',
      severity: 'warning',
      kind: 'policy',
      message:
        `時間線 ${item.timelineRow}：「${taskTypeName(item.taskType)}」原本沒地方停——`
        + `已請時間線 ${item.movedRows.join('、')} 的整備改停別台設施，`
        + `讓出 ${item.facilityLabel}。雙方時間都沒有動。`,
      detail: {
        timelineRow: item.timelineRow,
        blockId: item.blockId,
        taskType: item.taskType,
        facilityLabel: item.facilityLabel,
        movedRows: item.movedRows,
      },
    });
  }
  // 待命在原定位置排不出入廠，改到待命清單上另一個位置：換了哪裡、為什麼，都要講出來
  for (const item of maintenanceTransfer.standbyRelocations) {
    pushIssue(warnings, {
      code: 'MAINTENANCE_FACILITY_YIELDED',
      severity: 'warning',
      kind: 'policy',
      message:
        `時間線 ${item.timelineRow}：待命原定停「${item.fromLabel}」，入廠排不出（${item.reason}），`
        + `已改停待命清單上的「${item.toLabel}」；進場、停留、出場都照新位置重算。`,
      detail: {
        timelineRow: item.timelineRow,
        blockId: item.blockId,
        taskType: 'standby',
        facilityLabel: item.toLabel,
        fromFacilityLabel: item.fromLabel,
        reason: item.reason,
      },
    });
  }
  // 提早進廠被別列車擋下：代價會落到站位上，必須講出來，否則就是把
  // 「設施不足」無聲換成「站位碰撞」——使用者最頭痛的兩件事互相搬家。
  for (const item of maintenanceTransfer.entryEarlyBlocked) {
    pushIssue(warnings, {
      code: 'MAINTENANCE_ENTRY_EARLY_BLOCKED',
      severity: 'warning',
      kind: 'limit',
      message:
        `時間線 ${item.timelineRow}：「${taskTypeName(item.taskType)}」本來可以提早`
        + ` ${item.blockedMinutes.toFixed(1)} 分鐘進廠，但 ${item.facilityLabel}`
        + ` 那段時間被別列車佔著——車只好在「${item.waitStationName}」多等這段時間，`
        + `期間佔著那個站位。`,
      detail: {
        timelineRow: item.timelineRow,
        blockId: item.blockId,
        taskType: item.taskType,
        facilityLabel: item.facilityLabel,
        blockedMinutes: item.blockedMinutes,
        waitStationName: item.waitStationName,
      },
    });
  }
  // 整備設施不足：車根本沒地方停。跟上面「移動卡排不出來」分開回報——
  // 那是路徑問題（補拓樸的邊），這是產能問題（加設施／錯開整備時段）。
  for (const item of maintenanceTransfer.facilityUnavailable) {
    pushIssue(warnings, {
      code: 'MAINTENANCE_FACILITY_UNAVAILABLE',
      severity: 'warning',
      kind: 'limit',
      message: `時間線 ${item.timelineRow}：「${taskTypeName(item.taskType)}」沒有可用設施——${item.reason}`,
      detail: {
        timelineRow: item.timelineRow,
        blockId: item.blockId,
        taskType: item.taskType,
        facilityCount: item.facilityCount,
        reason: item.reason,
      },
    });
  }


  const allBlocks = timelines.flatMap((timeline) => timeline.blocks);
  validateTimelineOverlaps(timelines, errors);
  validateStationTimingsWithinBlocks(
    timelines,
    routesForBerth,
    errors,
  );
  /**
   * 設施格佔用：同一格同一時刻只能有一台車。
   *
   * 以「車實際還在裡面」為準——整備做完到出場移動開始之間車仍佔著那一格。這一支
   * 內部呼叫 stationBerthOccupancy.ts 的 collectFacilityOccupancies／
   * findFacilityOccupancyCollisions：沒補過「暫停」卡（見 fillYardHoldGaps）時用
   * 跟站位同一套空檔推論分析出實際離開時刻，補過卡就直接採用卡上的時刻——答案
   * 一致，所以<strong>不再依賴排在補卡之後才對</strong>；closeYardHeadGaps 的候選
   * 空位檢查（求解階段，跑在補卡之前）用的是同一份定義，求解跟這裡的最終驗證不會
   * 看到不同的佔用。重疊記硬錯誤（物理上做不到），交接不足 2 × 碰撞保護記警告
   * （營運規則）。
   */
  validateFacilityOccupancy(timelines, errors, {
    collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
    warnings,
  });

  validateStationBerthCollisions(
    timelines,
    routesForBerth,
    errors,
    {
      collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      // 碰撞保護不足是「該拉開但沒拉開」，不是物理上兩台車疊在一起：走警告不擋生成
      warnings,
      sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    },
  );
  // 殘留衝突的搜尋結果寫進訊息：試過幾個候選、代表性的拒絕原因、是否因運算預算停止。
  // 這是「目前未找到方案」，不是「已證明不可行」。
  for (const issue of [...errors, ...warnings]) {
    if (issue.code !== 'STATION_BERTH_COLLISION' && issue.code !== 'STATION_BERTH_PROTECTION_GAP') continue;
    const detail = issue.detail as { earlierBlockId?: string; laterBlockId?: string; stationId?: string } | undefined;
    const attempt = residual.attempts.find(
      (item) =>
        item.resource === detail?.stationId
        && item.blockIds.includes(detail?.earlierBlockId ?? '')
        && item.blockIds.includes(detail?.laterBlockId ?? ''),
    );
    // 主訊息只講結論與處理方向；試過哪些候選放進 detail.searchLog（畫面上收在展開區）
    const searchLog: string[] = [];
    if (attempt && attempt.searchIncomplete && attempt.candidatesTried === 0) {
      issue.message += '\n尚未找到安全排法（搜尋未完成）：共用搜尋預算在輪到這一筆之前就用完了。';
      searchLog.push('搜尋因共用預算用盡，這筆尚未搜尋。');
    } else if (attempt) {
      issue.message += '\n尚未找到安全排法（不代表場域容量不足）：請調整相關班次時刻、待命位置或路線後重新生成。';
      searchLog.push(
        `本次試了 ${attempt.candidatesTried} 個候選（雙方的整趟平移、壓縮／拉長行駛、增加停靠緩衝，`
        + `聯動最多 ${residualBudget.maxDepth} 層），試過的都會引出新的衝突或解不掉`,
        ...attempt.rejectedSamples,
      );
      if (attempt.searchIncomplete) searchLog.push('這一筆的搜尋因共用預算用盡而中途停止，未探索完。');
    } else if (residual.budgetExhausted) {
      // 預算在輪到這筆之前就用完：沒搜過，更不能說成可行或不可行
      issue.message += '\n尚未找到安全排法（搜尋未完成）：請調整相關班次後重新生成。';
      searchLog.push('搜尋因共用預算用盡，這筆尚未搜尋。');
    } else {
      continue;
    }
    (issue.detail as Record<string, unknown>).searchLog = searchLog;
    (issue.detail as Record<string, unknown>).resolutionStatus = 'not_found';
    (issue.detail as Record<string, unknown>).searchBudgetExhausted = attempt ? attempt.searchIncomplete === true : true;
  }
  // 整備做完車就停在出場站，接著那一段一定要從那一站發車——不是的話車不在，開不了
  validateYardExitContinuity({
    timelines,
    selectedRoutes: routesForBerth,
    // 驗證問的是「車實際停在哪」，跟輪的相位無關，所以用 validate 版（含保養／行檢）
    yardExitStationOptionsByTaskType: engineInput.yardExitStationOptionsByTaskType,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    errors,
  });
  /**
   * 最終問題清單要照<strong>完成後的班表</strong>重新核對。
   *
   * 「沒有路線可讓站、只能原地等」是次要邊讓渡當下的結論；後面的處理（開進設施格
   * 暫停放、提早進廠等）可能已經把那段空等解掉了。那則還掛著「仍無解」就是過期
   * 警告。重新核對：那張卡在最終班表上已經不擋任何人，就把它降為過程紀錄，並講
   * 出後來是怎麼解的。
   */
  {
    const finalBlockers = new Set(
      findStationBerthCollisions(
        collectStationBerthOccupancies(timelines, routesForBerth, {
          collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
        }),
        routesForBerth,
      ).map((hit) => `${hit.earlier.blockId}@${hit.stationId}`),
    );
    for (const issue of warnings) {
      if (issue.code !== 'STATION_BERTH_RELIEF_UNAVAILABLE') continue;
      const detail = issue.detail as {
        timelineRow?: number;
        stationId?: string;
        earlierBlockId?: string;
      } | undefined;
      if (!detail?.earlierBlockId || !detail.stationId) continue;
      if (finalBlockers.has(`${detail.earlierBlockId}@${detail.stationId}`)) continue;
      const row = timelines.find((timeline) => timeline.row === detail.timelineRow);
      const park = row?.blocks.find(
        (block) =>
          block.id.startsWith('berthpark-')
          && block.id.includes(detail.earlierBlockId!)
          && block.yardFacilityNodeId,
      );
      issue.kind = 'policy';
      issue.message =
        '過程紀錄（已解決）：' + issue.message
        + (park
          ? `\n後續已改成開進「${park.yardFacilityLabel ?? park.yardFacilityNodeId}」`
            + `${formatMinuteClock(park.plannedStartMinute)}–${formatMinuteClock(park.plannedEndMinute)} 等待，`
            + '最終班表上這段空等已不擋任何班次。'
          : '\n最終班表上這段空等已不擋任何班次（由後續處理解掉）。');
      (issue.detail as Record<string, unknown>).resolvedInFinalPlan = true;
    }
  }

  // 車的位置要接得起來：沒被上面「必要轉場失敗」講過的缺口（例如別的處理插卡後
  // 留下的），在這裡從班表本身抓出來
  validateVehicleLocationContinuity({
    timelines,
    selectedRoutes: routesForBerth,
    errors,
    explainedBlockIds: requiredTransferBlockIds,
  });
  validateMoveJunctionConflicts({
    timelines,
    topology: engineInput.pointTopology,
    collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
    warnings,
  });
  validateRotationCyclesComplete(timelines, engineInput.passengerRoutes.length, errors);
  validateRouteSwitchBuffers(
    timelines,
    routeById,
    errors,
    engineInput.minimumRecoveryTimeSeconds,
    engineInput.passengerRoutes,
    engineInput.successorPolicy,
  );
  validatePassengerHeadway(
    allBlocks,
    engineInput.intervals,
    engineInput.attributes,
    routeById,
    errors,
    warnings,
    engineInput.scheduleRowCount,
  );
  validateTimelineCapacity(
    allBlocks.filter((block) => block.taskType === 'passenger' && block.source === 'template_bar'),
    engineInput.scheduleRowCount,
    engineInput.intervals,
    engineInput.attributes,
    routeById,
    warnings,
  );

  /**
   * 搜尋沒做完、又還有安全問題：明講「本次計算未找到安全排法（搜尋未完成）」並禁止發布。
   * 不能讓人以為已經搜完、場域容量不夠——預算用盡只代表這次沒有搜完。
   */
  const budgetReport = searchBudget.report();
  const unresolvedSafety = [...errors, ...warnings].some(
    (issue) => issue.code !== 'SCHEDULE_SEARCH_INCOMPLETE'
      && (issue.severity === 'error' || PUBLISH_BLOCKING_CODES.has(issue.code)),
  );
  if (budgetReport.exhaustedBy && unresolvedSafety) {
    const by = budgetReport.exhaustedBy === 'time'
      ? `時間上限 ${Math.round(budgetReport.limits.timeLimitMs / 1000)} 秒`
      : budgetReport.exhaustedBy === 'candidates'
        ? `候選嘗試上限 ${budgetReport.limits.maxCandidates} 次`
        : `完整評估上限 ${budgetReport.limits.maxEvaluations} 次`;
    pushIssue(errors, {
      code: 'SCHEDULE_SEARCH_INCOMPLETE',
      severity: 'error',
      kind: 'limit',
      message:
        `本次計算未找到安全排法（搜尋未完成）：已用完這次生成的${by}，下面的安全問題還沒有排開。`
        + '這不代表已證明沒有安全排法，也不代表場域容量不足；班表禁止發布。',
      detail: {
        searchBudgetExhausted: true,
        exhaustedBy: budgetReport.exhaustedBy,
        candidates: budgetReport.candidates,
        evaluations: budgetReport.evaluations,
        duplicatesSkipped: budgetReport.duplicatesSkipped,
        elapsedMs: budgetReport.elapsedMs,
        limits: budgetReport.limits,
      },
    });
  }

  const plan: GeneratedSchedulePlan = {
    shiftId: engineInput.shiftId,
    generatedAt: new Date().toISOString(),
    scheduleRowCount: engineInput.scheduleRowCount,
    timelines,
    routeAssignmentAlgorithm: routeAssignmentAlgorithmId(engineInput.successorPolicy),
    ...(engineInput.timetableGenerationAlgorithm
      ? { timetableGenerationAlgorithm: engineInput.timetableGenerationAlgorithm }
      : {}),
  };

  const ok =
    computeScheduleGateOk(errors, warnings)
    && resolvedByTaskId.size === engineInput.confirmedTasks.length;
  return {
    plan: plan,
    report: { ok, errors, warnings, metrics: buildServiceMetrics(timelines, warnings, engineInput.servicePulseDemand) },
  };
}

/**
 * 算出可跨班表比較的服務量指標。
 *
 * 兩份班表要比好壞，不能比問題代號的原始則數——則數會隨班次數縮放，
 * 少跑車就自動變好看。詳見 {@link ScheduleServiceMetrics} 的說明。
 */
function buildServiceMetrics(
  timelines: GeneratedScheduleTimeline[],
  warnings: FeasibilityIssue[],
  servicePulseDemand: number,
): ScheduleServiceMetrics {
  let passengerTripCount = 0;
  let passengerOccupancySeconds = 0;
  const tripsByRow: Record<number, number> = {};
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger') continue;
      passengerTripCount += 1;
      tripsByRow[timeline.row] = (tripsByRow[timeline.row] ?? 0) + 1;
      passengerOccupancySeconds += Math.max(
        0,
        Math.round((block.plannedEndMinute - block.plannedStartMinute) * 60),
      );
    }
  }

  const countCode = (code: FeasibilityViolationCode): number =>
    warnings.reduce((sum, issue) => (issue.code === code ? sum + 1 : sum), 0);
  const servicePulseUnserved = countCode('UNSERVED_SERVICE_PULSE');

  const rowCounts = Object.values(tripsByRow);
  const rowAverage = rowCounts.length > 0
    ? rowCounts.reduce((sum, value) => sum + value, 0) / rowCounts.length
    : 0;

  return {
    passengerTripCount,
    passengerOccupancySeconds,
    servicePulseDemand,
    servicePulseUnserved,
    servicePulseServedRatio:
      servicePulseDemand > 0
        ? (servicePulseDemand - servicePulseUnserved) / servicePulseDemand
        : null,
    backupBerthPerTrip:
      passengerTripCount > 0
        ? countCode('STATION_BERTH_BACKUP_USED') / passengerTripCount
        : null,
    headwayBelowTargetPerTrip:
      passengerTripCount > 0
        ? countCode('HEADWAY_BELOW_TARGET') / passengerTripCount
        : null,
    tripsByRow,
    tripsByRowSpread:
      rowAverage > 0
        ? (Math.max(...rowCounts) - Math.min(...rowCounts)) / rowAverage
        : null,
  };
}

function formatMinuteClock(minute: number): string {
  const total = Math.round(minute * 60);
  const day = ((total % 86400) + 86400) % 86400;
  return [Math.floor(day / 3600), Math.floor(day / 60) % 60, day % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}
