import { fetchMaintenanceTaskDetail } from '../../maintenance-tasks/api/maintenanceTasksApi';
import type { ShiftScheduleCreateDraft } from '../types/create';
import { buildRouteGroupsParamsFingerprint } from './schedule-engine/physics';
import { runShiftScheduleEngineForDraft } from './runShiftScheduleEngineForDraft';
import type {
  ShiftScheduleMaintenanceTaskBinding,
  ShiftScheduleStoredOutput,
} from './schedule-engine/types';

export async function buildMaintenanceTaskBinding(
  draft: ShiftScheduleCreateDraft,
  backendUrl?: string,
): Promise<ShiftScheduleMaintenanceTaskBinding> {
  const boundAt = new Date().toISOString();

  if (draft.maintenanceTask.skipped || !draft.maintenanceTask.taskId.trim()) {
    return {
      taskId: '',
      taskName: draft.maintenanceTask.taskName.trim(),
      skipped: true,
      body: null,
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
    },
    routeGroupsRef: {
      mapId: draft.routeGroups.mapId,
      selectedRouteIds: draft.routeGroups.selectedRoutes.map((route) => route.routeId),
      paramsFingerprint: buildRouteGroupsParamsFingerprint(draft.routeGroups),
    },
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
