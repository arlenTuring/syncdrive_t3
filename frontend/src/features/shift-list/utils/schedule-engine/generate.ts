import type { PointTopology } from '../../../map-editor/types/pointTopology';
import type { MapAreaObject } from '../../../map-editor/types/area';
import type { ShiftScheduleCreateDraft } from '../../types/create';
import type { MaintenanceFirstTripOrigin } from '../maintenanceFirstTripOrigins';
import { insertMaintenanceEntryServiceTrips } from '../insertMaintenanceEntryServiceTrips';
import { insertMaintenanceTransferCards } from '../insertMaintenanceTransferCards';
import { computeScheduleGateOk } from '../scheduleAcceptance';
import type {
  FeasibilityIssue,
  GeneratedSchedulePlan,
  GenerateShiftScheduleResult,
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
} from './validate';
import {
  enforceStationBerthConstraints,
  STATION_BERTH_WAIT_MAX_DELAY_SECONDS,
} from '../stationBerthConstraint';
import { densifyRouteHeadwaysAfterBerth } from '../densifyRouteHeadwaysAfterBerth';
import { repairRouteHeadwaysBelowTarget } from '../repairRouteHeadwaysBelowTarget';
import { alignRouteWithVehicleLocation } from '../alignRouteWithVehicleLocation';
import { relievePlatformIdleWithSecondaryEdge } from '../relievePlatformIdleWithSecondaryEdge';
import { trimIncompleteRotationCyclesOnTimelines } from '../trimIncompleteRotationCycles';

import {
  applyMainlineMaintenanceEntryYield,
  pushPassengerPastPrecedingYard,
} from '../mainlineMaintenanceEntryYield';
import { tagYardDispatchTrips, scrubMidMainlineDispatchArtifacts } from './tagYardDispatchTrips';
import { pushIssue } from './feasibilityIssueMeta';

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
};

/**
 * 幾何後處理收斂迴圈的輪數上限。
 * 正常 2–3 輪就不動了；上限只是防呆，避免互相破壞的處理無限來回。
 */
const GEOMETRY_CONVERGENCE_MAX_ROUNDS = 8;

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
      parts.push(
        `${timeline.row}|${block.id}|${block.plannedStartMinute}|${block.plannedEndMinute}`
        + `|${block.routeInstanceId ?? block.routeId ?? ''}`,
      );
    }
  }
  parts.sort();
  return parts.join('\n');
}

/**
 * 排班引擎主入口：依策略文件 1.1–1.8、S1–S4 與優化算法展開班表。
 */
export function generateShiftSchedule(
  input: GenerateShiftScheduleInput,
): GenerateShiftScheduleResult {
  const errors: FeasibilityIssue[] = [];
  const warnings: FeasibilityIssue[] = [];

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
  for (let round = 0; round < GEOMETRY_CONVERGENCE_MAX_ROUNDS; round += 1) {
    const before = fingerprintTimelines(timelines);

    // 站位占用：拓撲候選中選局部無衝突解（可延後／可改線／可等）
    // 第一輪保守並收集警告；之後放寬延後上限，處理連鎖擠回來的殘餘衝突。
    timelines = enforceStationBerthConstraints({
      timelines,
      selectedRoutes: routesForBerth,
      minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
      collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      successorPolicy: engineInput.successorPolicy,
      warnings: round === 0 ? warnings : undefined,
      ...(round === 0
        ? {}
        : { maxDelaySeconds: STATION_BERTH_WAIT_MAX_DELAY_SECONDS }),
    }).timelines;

    // 跑完一輪在共用站位空等下一個脈衝時撞到別列車 → 有次要邊就先繞去別站等
    timelines = relievePlatformIdleWithSecondaryEdge({
      timelines,
      selectedRoutes: routesForBerth,
      successorPolicy: engineInput.successorPolicy,
      minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
      collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      warnings: round === 0 ? warnings : [],
    });

    // 車停在哪，下一班就從那裡發——待命的地點是被站位限制夾出來的、常常沒得選，
    // 而路線在主線與備用之間本來就可選，該讓的是有選擇的那一方。
    // 放在迴圈裡：換路線＝換停靠站，可能製造新的碰撞，要讓站位求解有機會反應。
    alignRouteWithVehicleLocation({
      timelines,
      selectedRoutes: routesForBerth,
      successorPolicy: engineInput.successorPolicy,
      topology: engineInput.pointTopology,
      warnings: round === 0 ? warnings : undefined,
    });

    // 班距太疏 → 把後車往前拉回目標
    timelines = densifyRouteHeadwaysAfterBerth({
      timelines,
      selectedRoutes: routesForBerth,
      intervals: engineInput.intervals,
      attributes: engineInput.attributes,
      minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
      collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
    });

    // 班距太擠 → 把後車往後推；推不夠再借前車的既有餘裕
    timelines = repairRouteHeadwaysBelowTarget({
      timelines,
      selectedRoutes: routesForBerth,
      intervals: engineInput.intervals,
      attributes: engineInput.attributes,
      minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
      collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
    });

    // 正線可吃接下來那段整備的開頭（有重疊才讓）
    timelines = applyMainlineMaintenanceEntryYield(timelines);

    // 不准佔用整備尾巴：壓到前一段整備的正線，整趟推到整備結束之後
    timelines = pushPassengerPastPrecedingYard(timelines);

    // 撤掉不成輪的尾巴。放在迴圈內是有意的——它釋放出來的站位與空檔，
    // 下一輪的班距修復才用得到（這正是舊版固定序列漏接的地方）。
    timelines = trimIncompleteRotationCyclesOnTimelines({
      timelines,
      routeCount: engineInput.passengerRoutes.length,
    }).timelines;

    if (fingerprintTimelines(timelines) === before) break;
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
  const maintenanceTransfer = insertMaintenanceTransferCards({
    timelines,
    topology: engineInput.pointTopology,
    areas: engineInput.areas,
    maintenanceBody: engineInput.maintenanceBody,
    selectedRoutes: engineInput.selectedRoutes,
    minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
    collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
  });
  timelines = maintenanceTransfer.timelines;
  for (const skip of maintenanceTransfer.skipped) {
    const label = skip.fromTaskType && skip.toTaskType
      ? `「${skip.fromTaskType}」轉「${skip.toTaskType}」`
      : `「${skip.taskType}」`;
    pushIssue(warnings, {
      code: 'MAINTENANCE_TRANSFER_UNRESOLVED',
      severity: 'warning',
      kind: 'policy',
      message: `時間線 ${skip.timelineRow}：${label}排不出整備轉場卡——${skip.reason}`,
      detail: {
        timelineRow: skip.timelineRow,
        blockId: skip.blockId,
        taskType: skip.taskType,
        fromTaskType: skip.fromTaskType,
        toTaskType: skip.toTaskType,
        reason: skip.reason,
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
      message: `時間線 ${item.timelineRow}：「${item.taskType}」沒有可用設施——${item.reason}`,
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
  const routeById = new Map(
    routesForBerth.map((route) => [route.routeId, route] as const),
  );

  validateTimelineOverlaps(timelines, errors);
  validateStationTimingsWithinBlocks(
    timelines,
    routesForBerth,
    errors,
  );
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
  // 整備做完車就停在出場站，接著那一段一定要從那一站發車——不是的話車不在，開不了
  validateYardExitContinuity({
    timelines,
    selectedRoutes: routesForBerth,
    // 驗證問的是「車實際停在哪」，跟輪的相位無關，所以用 validate 版（含保養／行檢）
    yardExitStationOptionsByTaskType: engineInput.yardExitStationOptionsByTaskType,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    errors,
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
    computeScheduleGateOk(errors)
    && resolvedByTaskId.size === engineInput.confirmedTasks.length;
  return {
    plan: plan,
    report: { ok, errors, warnings },
  };
}
