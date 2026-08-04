import type { ShiftScheduleCreateDraft } from '../../types/create';
import type { MaintenanceFirstTripOrigin } from '../maintenanceFirstTripOrigins';
import { insertMaintenanceEntryServiceTrips } from '../insertMaintenanceEntryServiceTrips';
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
} from './validate';

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
    selectedRoutes: engineInput.selectedRoutes,
    firstTripOrigins: engineInput.firstTripOrigins,
    maintenanceBody: engineInput.maintenanceBody,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
    warnings,
  });

  const allBlocks = timelines.flatMap((timeline) => timeline.blocks);
  const routeById = new Map(
    engineInput.selectedRoutes.map((route) => [route.routeId, route] as const),
  );

  validateTimelineOverlaps(timelines, errors);
  validateStationTimingsWithinBlocks(
    timelines,
    engineInput.selectedRoutes,
    errors,
  );
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
    errors.length === 0
    && resolvedByTaskId.size === engineInput.confirmedTasks.length;
  return {
    plan: plan,
    report: { ok, errors, warnings },
  };
}
