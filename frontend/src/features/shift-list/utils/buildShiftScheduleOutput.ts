import { fetchMaintenanceTaskDetail } from '../../maintenance-tasks/api/maintenanceTasksApi';
import type { ShiftScheduleCreateDraft } from '../types/create';
import { buildRouteGroupsParamsFingerprint } from './schedule-engine/physics';
import { runShiftScheduleEngineForDraft } from './runShiftScheduleEngineForDraft';
import type {
  ShiftScheduleMaintenanceTaskBinding,
  ShiftScheduleStoredOutput,
  PlanAdjustHistoryEntry,
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
      outputVersion: 1,
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
    outputVersion: 1,
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
  if (o.outputVersion !== 1) return null;

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
    outputVersion: 1,
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
  return { planAdjustHistory: entries, planAdjustHistoryIndex };
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
