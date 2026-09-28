import { fetchMaintenanceTaskDetail } from '../../maintenance-tasks/api/maintenanceTasksApi';
import type { ShiftScheduleCreateDraft } from '../types/create';
import { buildRouteGroupsParamsFingerprint } from './schedule-engine/physics';
import { runShiftScheduleEngineForDraft } from './runShiftScheduleEngineForDraft';
import {
  CURRENT_SHIFT_SCHEDULE_OUTPUT_VERSION,
  type ShiftScheduleMaintenanceTaskBinding,
  type ShiftScheduleStoredOutput,
  type PlanAdjustHistoryEntry,
} from './schedule-engine/types';
import {
  buildMaintenanceEntrySlackFingerprint,
  normalizeMaintenanceEntrySlackBySectionInput,
  parseEmptyIntervalMainlineSlackSeconds,
} from './resolveMaintenanceEntrySlackSeconds';
import {
  buildMaintenanceSectionCodeFingerprint,
  normalizeMaintenanceSectionCodeBySection,
} from './maintenanceSectionCode';
import {
  createEmptyManualSchedulePlan,
  emptyManualFeasibilityReport,
  resolveManualScheduleRowCount,
} from './buildManualShiftScheduleOutput';

export async function buildMaintenanceTaskBinding(
  draft: ShiftScheduleCreateDraft,
  backendUrl?: string,
): Promise<ShiftScheduleMaintenanceTaskBinding> {
  const boundAt = new Date().toISOString();
  const entrySlackFingerprint = buildMaintenanceEntrySlackFingerprint(
    normalizeMaintenanceEntrySlackBySectionInput(
      draft.maintenanceTask.entrySlackBySection,
    ),
  );
  const sectionCodeFingerprint = buildMaintenanceSectionCodeFingerprint(
    normalizeMaintenanceSectionCodeBySection(
      draft.maintenanceTask.sectionCodeBySection,
    ),
  );

  if (draft.maintenanceTask.skipped || !draft.maintenanceTask.taskId.trim()) {
    return {
      taskId: '',
      taskName: draft.maintenanceTask.taskName.trim(),
      skipped: true,
      body: null,
      entrySlackFingerprint,
      sectionCodeFingerprint,
      boundAt,
    };
  }

  const detail = await fetchMaintenanceTaskDetail(
    draft.maintenanceTask.taskId,
    backendUrl,
  );

  return {
    taskId: detail.task_id,
    taskName: detail.name,
    skipped: false,
    body: detail.body ?? {},
    entrySlackFingerprint,
    sectionCodeFingerprint,
    publishStatus: detail.publish_status,
    usageStatus: detail.usage_status,
    sourceUpdatedAt: detail.updated_at,
    boundAt,
  };
}

export async function buildShiftScheduleStoredOutput(
  draft: ShiftScheduleCreateDraft,
  options: { shiftId?: string; backendUrl?: string } = {},
): Promise<ShiftScheduleStoredOutput> {
  if (draft.creationMode === 'manual') {
    const [rowCount, maintenanceTaskBinding] = await Promise.all([
      resolveManualScheduleRowCount(
        draft.timeTemplate.templateId,
        options.backendUrl,
      ),
      buildMaintenanceTaskBinding(draft, options.backendUrl),
    ]);
    const plan = createEmptyManualSchedulePlan({
      scheduleRowCount: rowCount,
      shiftId: options.shiftId,
    });
    const feasibilityReport = emptyManualFeasibilityReport();
    return {
      outputVersion: CURRENT_SHIFT_SCHEDULE_OUTPUT_VERSION,
      generatedAt: plan.generatedAt,
      plan,
      feasibilityReport,
      maintenanceTaskBinding,
      timeTemplateRef: {
        templateId: draft.timeTemplate.templateId,
        templateName: draft.timeTemplate.templateName,
        emptyIntervalMainlineSlackSeconds: parseEmptyIntervalMainlineSlackSeconds(
          draft.timeTemplate.emptyIntervalMainlineSlackSeconds,
        ),
      },
      routeGroupsRef: {
        mapId: draft.routeGroups.mapId,
        selectedRouteIds: draft.routeGroups.selectedRoutes.map((route) => route.routeId),
        paramsFingerprint: buildRouteGroupsParamsFingerprint(draft.routeGroups),
      },
      planAdjustHistory: [{ plan, feasibilityReport }],
      planAdjustHistoryIndex: 0,
    };
  }

  const [engineResult, maintenanceTaskBinding] = await Promise.all([
    runShiftScheduleEngineForDraft(draft, options),
    buildMaintenanceTaskBinding(draft, options.backendUrl),
  ]);

  return {
    outputVersion: CURRENT_SHIFT_SCHEDULE_OUTPUT_VERSION,
    generatedAt: new Date().toISOString(),
    plan: engineResult.plan,
    feasibilityReport: engineResult.report,
    maintenanceTaskBinding,
    timeTemplateRef: {
      templateId: draft.timeTemplate.templateId,
      templateName: draft.timeTemplate.templateName,
      emptyIntervalMainlineSlackSeconds: parseEmptyIntervalMainlineSlackSeconds(
        draft.timeTemplate.emptyIntervalMainlineSlackSeconds,
      ),
    },
    routeGroupsRef: {
      mapId: draft.routeGroups.mapId,
      selectedRouteIds: draft.routeGroups.selectedRoutes.map((route) => route.routeId),
      paramsFingerprint: buildRouteGroupsParamsFingerprint(draft.routeGroups),
    },
    ...(engineResult.plan
      ? {
          planAdjustHistory: [
            { plan: engineResult.plan, feasibilityReport: engineResult.report },
          ],
          planAdjustHistoryIndex: 0,
        }
      : {}),
  };
}

export function parseShiftScheduleStoredOutput(
  raw: unknown,
): ShiftScheduleStoredOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.outputVersion !== 'number' || o.outputVersion < 1) return null;

  const generatedAt = typeof o.generatedAt === 'string' ? o.generatedAt : '';
  const feasibilityReport = o.feasibilityReport;
  if (!feasibilityReport || typeof feasibilityReport !== 'object') return null;

  const report = feasibilityReport as Record<string, unknown>;
  const bindingRaw = o.maintenanceTaskBinding;
  if (!bindingRaw || typeof bindingRaw !== 'object') return null;
  const binding = bindingRaw as Record<string, unknown>;

  const templateRefRaw = o.timeTemplateRef;
  const routeRefRaw = o.routeGroupsRef;
  if (!templateRefRaw || typeof templateRefRaw !== 'object') return null;
  if (!routeRefRaw || typeof routeRefRaw !== 'object') return null;

  const templateRef = templateRefRaw as Record<string, unknown>;
  const routeRef = routeRefRaw as Record<string, unknown>;

  const maintenanceTaskBinding: ShiftScheduleMaintenanceTaskBinding = {
    taskId: typeof binding.taskId === 'string' ? binding.taskId : '',
    taskName: typeof binding.taskName === 'string' ? binding.taskName : '',
    skipped: binding.skipped === true,
    body:
      binding.body && typeof binding.body === 'object' && !Array.isArray(binding.body)
        ? (binding.body as Record<string, unknown>)
        : null,
    ...(typeof binding.entrySlackFingerprint === 'string'
      ? { entrySlackFingerprint: binding.entrySlackFingerprint }
      : {}),
    ...(typeof binding.sectionCodeFingerprint === 'string'
      ? { sectionCodeFingerprint: binding.sectionCodeFingerprint }
      : {}),
    ...(typeof binding.publishStatus === 'string'
      ? { publishStatus: binding.publishStatus }
      : {}),
    ...(typeof binding.usageStatus === 'string'
      ? { usageStatus: binding.usageStatus }
      : {}),
    ...(typeof binding.sourceUpdatedAt === 'string'
      ? { sourceUpdatedAt: binding.sourceUpdatedAt }
      : {}),
    boundAt: typeof binding.boundAt === 'string' ? binding.boundAt : generatedAt,
  };

  return {
    outputVersion: typeof o.outputVersion === 'number' ? o.outputVersion : CURRENT_SHIFT_SCHEDULE_OUTPUT_VERSION,
    generatedAt,
    plan: parseGeneratedSchedulePlan(o.plan),
    feasibilityReport: {
      ok: report.ok === true,
      errors: parseFeasibilityIssues(report.errors),
      warnings: parseFeasibilityIssues(report.warnings),
    },
    maintenanceTaskBinding,
    timeTemplateRef: {
      templateId: typeof templateRef.templateId === 'string' ? templateRef.templateId : '',
      templateName:
        typeof templateRef.templateName === 'string' ? templateRef.templateName : '',
      ...(typeof templateRef.emptyIntervalMainlineSlackSeconds === 'number'
        && Number.isFinite(templateRef.emptyIntervalMainlineSlackSeconds)
        && templateRef.emptyIntervalMainlineSlackSeconds >= 0
        ? {
            emptyIntervalMainlineSlackSeconds: Math.round(
              templateRef.emptyIntervalMainlineSlackSeconds,
            ),
          }
        : {}),
    },
    routeGroupsRef: {
      mapId: typeof routeRef.mapId === 'string' ? routeRef.mapId : '',
      selectedRouteIds: Array.isArray(routeRef.selectedRouteIds)
        ? routeRef.selectedRouteIds.filter((id): id is string => typeof id === 'string')
        : [],
      ...(typeof routeRef.paramsFingerprint === 'string'
        ? { paramsFingerprint: routeRef.paramsFingerprint }
        : {}),
    },
    ...(parsePlanAdjustHistory(o.planAdjustHistory, o.planAdjustHistoryIndex) ?? {}),
    ...(parsePublishCheck(o.publishCheck) ?? {}),
  };
}

/**
 * 發布前檢查紀錄。欄位不完整就整筆丟掉——寧可回到「未檢查」重跑一次，
 * 也不要用半殘的紀錄推出「可發布」。
 */
function parsePublishCheck(
  raw: unknown,
): Pick<ShiftScheduleStoredOutput, 'publishCheck'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.checkedAt !== 'string'
    || typeof o.planFingerprint !== 'string'
    || typeof o.publishSafe !== 'boolean'
  ) {
    return null;
  }
  const byCode: Record<string, number> = {};
  if (o.publishBlockingByCode && typeof o.publishBlockingByCode === 'object') {
    for (const [code, count] of Object.entries(
      o.publishBlockingByCode as Record<string, unknown>,
    )) {
      if (typeof count === 'number' && Number.isFinite(count)) byCode[code] = count;
    }
  }
  return {
    publishCheck: {
      checkedAt: o.checkedAt,
      planFingerprint: o.planFingerprint,
      ...(typeof o.settingsFingerprint === 'string' ? { settingsFingerprint: o.settingsFingerprint } : {}),
      ...(typeof o.topologyFingerprint === 'string' ? { topologyFingerprint: o.topologyFingerprint } : {}),
      publishSafe: o.publishSafe,
      publishBlockingCount:
        typeof o.publishBlockingCount === 'number'
        && Number.isFinite(o.publishBlockingCount)
          ? o.publishBlockingCount
          : 0,
      publishBlockingByCode: byCode,
    },
  };
}

/**
 * 存進草稿的復原歷史筆數上限。
 *
 * 每一筆都是<strong>完整班表副本</strong>（實測約 0.5 MB：plan 0.38 + 可行性報告 0.15）。
 * 舊版無上限累積，手動調整約 19 次後草稿就突破後端 10 MB 上限
 * （REQUEST_BODY_LIMIT，見 backend/src/main.ts），儲存草稿的 PATCH 直接回
 * 413 request entity too large——使用者從此存不了檔。
 *
 * 8 筆 ≈ 4 MB，對 10 MB 上限留有充裕餘裕。
 */
export const PERSISTED_PLAN_ADJUST_HISTORY_LIMIT = 8;

/**
 * 裁切復原歷史成「含目前所在位置」的最後 N 筆，並把索引換算到裁切後的座標。
 * 保留目前位置往前的步數（復原用）；目前位置在中段時也盡量保留後面的重做步數。
 */
export function trimPlanAdjustHistoryForPersist(
  history: PlanAdjustHistoryEntry[],
  historyIndex: number,
): { history: PlanAdjustHistoryEntry[]; historyIndex: number } {
  if (history.length <= PERSISTED_PLAN_ADJUST_HISTORY_LIMIT) {
    return { history, historyIndex };
  }
  const safeIndex = Math.min(Math.max(0, historyIndex), history.length - 1);
  const end = Math.max(safeIndex + 1, PERSISTED_PLAN_ADJUST_HISTORY_LIMIT);
  const start = Math.max(0, end - PERSISTED_PLAN_ADJUST_HISTORY_LIMIT);
  const trimmed = history.slice(start, start + PERSISTED_PLAN_ADJUST_HISTORY_LIMIT);
  return {
    history: trimmed,
    historyIndex: Math.min(Math.max(0, safeIndex - start), trimmed.length - 1),
  };
}

function parsePlanAdjustHistory(
  rawHistory: unknown,
  rawIndex: unknown,
): Pick<ShiftScheduleStoredOutput, 'planAdjustHistory' | 'planAdjustHistoryIndex'> | null {
  if (!Array.isArray(rawHistory) || rawHistory.length === 0) return null;
  const entries: PlanAdjustHistoryEntry[] = [];
  for (const item of rawHistory) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const plan = parseGeneratedSchedulePlan(row.plan);
    const reportRaw = row.feasibilityReport;
    if (!plan || !reportRaw || typeof reportRaw !== 'object') continue;
    const report = reportRaw as Record<string, unknown>;
    entries.push({
      plan,
      feasibilityReport: {
        ok: report.ok === true,
        errors: parseFeasibilityIssues(report.errors),
        warnings: parseFeasibilityIssues(report.warnings),
      },
    });
  }
  if (entries.length === 0) return null;
  const indexRaw = typeof rawIndex === 'number' && Number.isFinite(rawIndex)
    ? Math.floor(rawIndex)
    : entries.length - 1;
  const planAdjustHistoryIndex = Math.min(Math.max(0, indexRaw), entries.length - 1);
  // 舊草稿可能存了無上限的歷史（實測 17 筆＝8.75 MB）；載入時就裁掉，
  // 避免一開啟又原樣存回去再次撞 413。
  const trimmed = trimPlanAdjustHistoryForPersist(entries, planAdjustHistoryIndex);
  return {
    planAdjustHistory: trimmed.history,
    planAdjustHistoryIndex: trimmed.historyIndex,
  };
}

function parseFeasibilityIssues(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object') as ShiftScheduleStoredOutput['feasibilityReport']['errors'];
}

function parseGeneratedSchedulePlan(raw: unknown): ShiftScheduleStoredOutput['plan'] {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.timelines)) return null;
  const scheduleRowCount =
    typeof o.scheduleRowCount === 'number' && o.scheduleRowCount > 0
      ? Math.round(o.scheduleRowCount)
      : 0;
  if (scheduleRowCount <= 0) return null;

  return {
    ...(typeof o.shiftId === 'string' ? { shiftId: o.shiftId } : {}),
    generatedAt: typeof o.generatedAt === 'string' ? o.generatedAt : '',
    scheduleRowCount,
    timelines: o.timelines as ShiftScheduleStoredOutput['plan'] extends infer P
      ? P extends { timelines: infer T }
        ? T
        : never
      : never,
  };
}
