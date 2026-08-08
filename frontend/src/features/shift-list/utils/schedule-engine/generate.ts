import type { ShiftScheduleCreateDraft } from '../../types/create';
import type { MaintenanceFirstTripOrigin } from '../maintenanceFirstTripOrigins';
import { insertMaintenanceEntryServiceTrips } from '../insertMaintenanceEntryServiceTrips';
import { insertYardExitMoveCards } from '../insertYardExitMoveCards';
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
      parts.push(
        `${timeline.row}|${block.id}|${block.plannedStartMinute}|${block.plannedEndMinute}`,
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
  // 規則：整備（保養／行前／充電／機動）後第一個正線一律掛「整備代號+路線代號」。
  timelines = tagYardDispatchTrips({
    timelines,
    origins: engineInput.firstTripOrigins,
    maintenanceBody: engineInput.maintenanceBody,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    selectedRoutes: engineInput.selectedRoutes,
  });
  timelines = scrubMidMainlineDispatchArtifacts(timelines);

  // 出場移動卡（整備代號+EX）：把車從整備設施開到轉乘站的那一段。
  // 放在所有幾何後處理「之後」是刻意的——它往前貼齊後面那一段的發車時刻，
  // 後面那一段的時間必須已經定案，先插會被之後的班距修復推走而失去貼齊。
  const yardExitMove = insertYardExitMoveCards({
    timelines,
    origins: engineInput.firstTripOrigins,
    maintenanceBody: engineInput.maintenanceBody,
    selectedRoutes: engineInput.selectedRoutes,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
  });
  timelines = yardExitMove.timelines;
  for (const skip of yardExitMove.skipped) {
    pushIssue(warnings, {
      code: 'YARD_EXIT_MOVE_UNRESOLVED',
      severity: 'warning',
      kind: 'policy',
      message: `時間線 ${skip.timelineRow}：「${skip.taskType}」排不出出場移動卡——${skip.reason}`,
      detail: { timelineRow: skip.timelineRow, taskType: skip.taskType, reason: skip.reason },
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
    // 驗證問的是「車實際停在哪」，跟輪的相位無關，所以用 validate 版（含保養／行前）
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
