import type { ShiftScheduleStoredOutput } from '../utils/schedule-engine/types';
import {
  SHIFT_SCHEDULE_DEFAULT_SWITCH_BUFFER_SECONDS,
  SHIFT_SCHEDULE_DEFAULT_DWELL_SLACK_PERCENT,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  SHIFT_SCHEDULE_DEFAULT_RECOVERY_TIME_SECONDS,
  normalizeSwitchBufferAfterSeconds,
  normalizeDwellSlackPercent,
  normalizeMinimumRecoveryTimeSeconds,
  applyDwellSlackSeconds,
  snapUpToClockAlignSeconds,
  isClockAlignedSeconds,
  sortSelectedRoutesByExecutionOrder,
  sumStationDwellSeconds,
  sumStationDwellSecondsWithSlack,
  areStationDwellsComplete,
  resolveRouteCycleSeconds,
  resolveRouteMinTurnaroundBudgetSeconds,
  isMainlineRouteWithinTurnaroundLimit,
  resolveNextRouteInExecutionOrder,
  resolveRouteRotationMinSeconds,
  buildRouteGroupsParamsFingerprint,
} from '../utils/schedule-engine/physics';

export {
  SHIFT_SCHEDULE_DEFAULT_SWITCH_BUFFER_SECONDS,
  SHIFT_SCHEDULE_DEFAULT_DWELL_SLACK_PERCENT,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  SHIFT_SCHEDULE_DEFAULT_RECOVERY_TIME_SECONDS,
  normalizeSwitchBufferAfterSeconds,
  normalizeDwellSlackPercent,
  normalizeMinimumRecoveryTimeSeconds,
  applyDwellSlackSeconds,
  snapUpToClockAlignSeconds,
  isClockAlignedSeconds,
  sortSelectedRoutesByExecutionOrder,
  sumStationDwellSeconds,
  sumStationDwellSecondsWithSlack,
  areStationDwellsComplete,
  resolveRouteCycleSeconds,
  resolveRouteMinTurnaroundBudgetSeconds,
  isMainlineRouteWithinTurnaroundLimit,
  resolveNextRouteInExecutionOrder,
  resolveRouteRotationMinSeconds,
  buildRouteGroupsParamsFingerprint,
};

export type CreateShiftScheduleStep = 1 | 2 | 3 | 4 | 5 | 6;

export const CREATE_SHIFT_SCHEDULE_STEPS: Array<{
  step: CreateShiftScheduleStep;
  label: string;
}> = [
  { step: 1, label: '基本資料' },
  { step: 2, label: '整備任務' },
  { step: 3, label: '時間模板' },
  { step: 4, label: '路線群組' },
  { step: 5, label: '調整班表' },
  { step: 6, label: '整體預覽' },
];

export const CREATE_SHIFT_SCHEDULE_STEP_HEADERS: Record<CreateShiftScheduleStep, string> = {
  1: '設定班表基本資料',
  2: '選擇整備任務規則包',
  3: '選擇時間模板',
  4: '設定路線群組與停靠時間',
  5: '調整自動生成的班表細節',
  6: '確認班表細節並完成建立',
};

export const SHIFT_SCHEDULE_BODY_EDITOR_VERSION = 2;

export type ShiftScheduleBasicDraft = {
  name: string;
  version: string;
  remarks: string;
};

export type ShiftScheduleMaintenanceTaskDraft = {
  taskId: string;
  taskName: string;
  /** 略過整備任務設定時為 true */
  skipped: boolean;
};

export type ShiftScheduleTimeTemplateDraft = {
  templateId: string;
  templateName: string;
};

import type { TaskTypeKey } from '../../time-templates/types/editor';
import {
  resolveRouteTravelTimesFromBody,
} from '../../map-editor/utils/routePlanning';

/** 單一站點停靠時間（班表 Step 4） */
export type ShiftScheduleStationDwell = {
  stationId: string;
  stationName: string;
  /** 停靠秒數；未填為 null */
  dwellSeconds: number | null;
};

export type ShiftScheduleSelectedRoute = {
  routeId: string;
  routeName: string;
  routeCode?: string | null;
  groupId: string;
  groupName: string;
  stationIds: string[];
  stationDwells: ShiftScheduleStationDwell[];
  /** 各站停靠時間已確認鎖定 */
  stationDwellsConfirmed: boolean;
  avgTravelTimeSeconds: number | null;
  minTravelTimeSeconds: number | null;
  /** 執行順序（1 起算，跨所有已選路線）；排班時同任務類型依此順序輪替 */
  executionOrder: number;
  /**
   * 完成此路線後、切換至下一條路線前的緩衝秒數（循環：最後一條接回第一條）。
   * 泛用平台：不限定折返語意，僅表示路線切換所需時間。
   */
  switchBufferAfterSeconds: number;
  /**
   * 靠站緩衝百分比（路線局域）。有效停靠 = 停靠 × (1 + 緩衝%)。
   * 用於吸收開關門硬體延遲與靠站作業緩衝。
   */
  dwellSlackPercent: number;
};

export type ShiftScheduleRouteGroupsDraft = {
  mapId: string;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  /**
   * 恢復時間（秒）：同 timeline 兩趟正線之間至少保留的可吸收延誤空檔。
   */
  minimumRecoveryTimeSeconds: number | null;
};

export type ShiftScheduleCreateDraft = {
  basic: ShiftScheduleBasicDraft;
  maintenanceTask: ShiftScheduleMaintenanceTaskDraft;
  timeTemplate: ShiftScheduleTimeTemplateDraft;
  routeGroups: ShiftScheduleRouteGroupsDraft;
  /** Step 5 引擎產物 + 整備任務綁定；Step 6 唯讀預覽用 */
  scheduleOutput: ShiftScheduleStoredOutput | null;
  currentStep: CreateShiftScheduleStep;
  maxReachedStep: CreateShiftScheduleStep;
};

export const SHIFT_SCHEDULE_UNTITLED_NAME = '未完成的正線班表';

export function resolveShiftScheduleDraftName(name: string): string {
  const trimmed = name.trim();
  return trimmed || SHIFT_SCHEDULE_UNTITLED_NAME;
}

export function displayShiftScheduleDraftName(storedName: string): string {
  const trimmed = storedName.trim();
  if (!trimmed || trimmed === SHIFT_SCHEDULE_UNTITLED_NAME) return '';
  return trimmed;
}

export function emptyShiftScheduleCreateDraft(): ShiftScheduleCreateDraft {
  return {
    basic: {
      name: '',
      version: '',
      remarks: '',
    },
    maintenanceTask: { taskId: '', taskName: '', skipped: false },
    timeTemplate: { templateId: '', templateName: '' },
    routeGroups: {
      mapId: '',
      selectedRoutes: [],
      minimumRecoveryTimeSeconds: null,
    },
    scheduleOutput: null,
    currentStep: 1,
    maxReachedStep: 1,
  };
}

export function emptyStationDwellsFromIds(
  stationIds: string[],
  stationNameById?: ReadonlyMap<string, string>,
): ShiftScheduleStationDwell[] {
  return stationIds.map((stationId) => ({
    stationId,
    stationName: stationNameById?.get(stationId) ?? stationId,
    dwellSeconds: null,
  }));
}

export function isSelectedRouteDwellReady(
  route: ShiftScheduleSelectedRoute,
  turnaroundLimitSeconds: number | null,
  minimumRecoveryTimeSeconds = 0,
): boolean {
  if (!areStationDwellsComplete(route.stationDwells)) {
    return false;
  }
  return isMainlineRouteWithinTurnaroundLimit(
    route,
    turnaroundLimitSeconds,
    minimumRecoveryTimeSeconds,
  );
}

export function normalizeSelectedRouteExecutionOrders(
  routes: ShiftScheduleSelectedRoute[],
): ShiftScheduleSelectedRoute[] {
  return sortSelectedRoutesByExecutionOrder(routes).map((route, index) => ({
    ...route,
    executionOrder: index + 1,
  }));
}

export function nextExecutionOrder(routes: ShiftScheduleSelectedRoute[]): number {
  if (routes.length === 0) return 1;
  return routes.reduce((max, route) => Math.max(max, route.executionOrder), 0) + 1;
}

/** @deprecated 請改用 nextExecutionOrder */
export function nextExecutionOrderForTaskType(
  routes: ShiftScheduleSelectedRoute[],
  _taskType: TaskTypeKey | null,
): number {
  return nextExecutionOrder(routes);
}

export function moveSelectedRouteExecutionOrder(
  routes: ShiftScheduleSelectedRoute[],
  routeId: string,
  direction: 'up' | 'down',
): ShiftScheduleSelectedRoute[] {
  const sorted = sortSelectedRoutesByExecutionOrder(routes);
  const index = sorted.findIndex((route) => route.routeId === routeId);
  if (index < 0) return routes;

  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= sorted.length) return routes;

  const reordered = [...sorted];
  const tmp = reordered[index]!;
  reordered[index] = reordered[swapIndex]!;
  reordered[swapIndex] = tmp;

  const orderByRouteId = new Map(
    reordered.map((route, idx) => [route.routeId, idx + 1] as const),
  );

  return normalizeSelectedRouteExecutionOrders(
    routes.map((route) => ({
      ...route,
      executionOrder: orderByRouteId.get(route.routeId) ?? route.executionOrder,
    })),
  );
}

export function resolveRouteOrderPosition(
  routes: ShiftScheduleSelectedRoute[],
  routeId: string,
): {
  executionOrder: number;
  showControls: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
} {
  const route = routes.find((item) => item.routeId === routeId);
  if (!route) {
    return {
      executionOrder: 0,
      showControls: false,
      canMoveUp: false,
      canMoveDown: false,
    };
  }

  const sorted = sortSelectedRoutesByExecutionOrder(routes);
  const index = sorted.findIndex((item) => item.routeId === routeId);

  return {
    executionOrder: route.executionOrder,
    showControls: sorted.length > 1,
    canMoveUp: index > 0,
    canMoveDown: index >= 0 && index < sorted.length - 1,
  };
}

import { parseShiftScheduleStoredOutput } from '../utils/buildShiftScheduleOutput';

export function shouldInvalidateShiftScheduleOutput(
  prev: ShiftScheduleCreateDraft,
  next: ShiftScheduleCreateDraft,
): boolean {
  if (JSON.stringify(prev.maintenanceTask) !== JSON.stringify(next.maintenanceTask)) {
    return true;
  }
  if (JSON.stringify(prev.timeTemplate) !== JSON.stringify(next.timeTemplate)) {
    return true;
  }
  if (JSON.stringify(prev.routeGroups) !== JSON.stringify(next.routeGroups)) {
    return true;
  }
  return false;
}

export function isShiftScheduleOutputFresh(draft: ShiftScheduleCreateDraft): boolean {
  const output = draft.scheduleOutput;
  if (!output || !output.plan) return false;

  if (output.timeTemplateRef.templateId !== draft.timeTemplate.templateId.trim()) {
    return false;
  }

  if (output.maintenanceTaskBinding.skipped !== draft.maintenanceTask.skipped) {
    return false;
  }
  if (
    !draft.maintenanceTask.skipped
    && output.maintenanceTaskBinding.taskId !== draft.maintenanceTask.taskId.trim()
  ) {
    return false;
  }

  if (output.routeGroupsRef.mapId !== draft.routeGroups.mapId) {
    return false;
  }

  const currentRouteIds = draft.routeGroups.selectedRoutes
    .map((route) => route.routeId)
    .sort()
    .join('\0');
  const storedRouteIds = [...output.routeGroupsRef.selectedRouteIds].sort().join('\0');
  if (currentRouteIds !== storedRouteIds) {
    return false;
  }

  const currentFingerprint = buildRouteGroupsParamsFingerprint(draft.routeGroups);
  const storedFingerprint = output.routeGroupsRef.paramsFingerprint;
  if (!storedFingerprint || storedFingerprint !== currentFingerprint) {
    return false;
  }

  return true;
}

export function serializeShiftScheduleBody(
  draft: ShiftScheduleCreateDraft,
): Record<string, unknown> {
  return {
    editorVersion: SHIFT_SCHEDULE_BODY_EDITOR_VERSION,
    version: draft.basic.version,
    remarks: draft.basic.remarks,
    maintenanceTaskId: draft.maintenanceTask.taskId,
    maintenanceTaskName: draft.maintenanceTask.taskName,
    maintenanceTaskSkipped: draft.maintenanceTask.skipped,
    timeTemplateId: draft.timeTemplate.templateId,
    timeTemplateName: draft.timeTemplate.templateName,
    routeGroupsMapId: draft.routeGroups.mapId,
    selectedRoutes: draft.routeGroups.selectedRoutes,
    minimumRecoveryTimeSeconds: draft.routeGroups.minimumRecoveryTimeSeconds,
    scheduleOutput: draft.scheduleOutput,
    currentStep: draft.currentStep,
    maxReachedStep: draft.maxReachedStep,
  };
}

function parseStationDwells(
  raw: unknown,
  stationIds: string[],
): ShiftScheduleStationDwell[] {
  const byId = new Map<string, ShiftScheduleStationDwell>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const stationId = typeof o.stationId === 'string' ? o.stationId.trim() : '';
      if (!stationId) continue;
      const dwellRaw = o.dwellSeconds;
      const dwellSeconds =
        typeof dwellRaw === 'number'
        && Number.isFinite(dwellRaw)
        && dwellRaw > 0
          ? Math.round(dwellRaw)
          : null;
      byId.set(stationId, {
        stationId,
        stationName:
          typeof o.stationName === 'string' && o.stationName.trim()
            ? o.stationName
            : stationId,
        dwellSeconds,
      });
    }
  }

  if (stationIds.length === 0) {
    return [...byId.values()];
  }

  return stationIds.map((stationId) => {
    const existing = byId.get(stationId);
    if (existing) return existing;
    return { stationId, stationName: stationId, dwellSeconds: null };
  });
}

export function parseShiftScheduleSelectedRoutes(raw: unknown): ShiftScheduleSelectedRoute[] {
  if (!Array.isArray(raw)) return [];
  const out: ShiftScheduleSelectedRoute[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const routeId = typeof o.routeId === 'string' ? o.routeId.trim() : '';
    if (!routeId) continue;
    const stationIds = Array.isArray(o.stationIds)
      ? o.stationIds.filter((id): id is string => typeof id === 'string')
      : [];
    const stationDwells = parseStationDwells(o.stationDwells, stationIds);
    out.push({
      routeId,
      routeName: typeof o.routeName === 'string' ? o.routeName : '',
      routeCode: typeof o.routeCode === 'string' ? o.routeCode : undefined,
      groupId: typeof o.groupId === 'string' ? o.groupId : '',
      groupName: typeof o.groupName === 'string' ? o.groupName : '',
      stationIds,
      stationDwells,
      stationDwellsConfirmed: o.stationDwellsConfirmed === true,
      ...resolveRouteTravelTimesFromBody(o),
      executionOrder:
        typeof o.executionOrder === 'number' && o.executionOrder > 0
          ? Math.round(o.executionOrder)
          : 0,
      switchBufferAfterSeconds: normalizeSwitchBufferAfterSeconds(o.switchBufferAfterSeconds),
      dwellSlackPercent: normalizeDwellSlackPercent(o.dwellSlackPercent),
    });
  }
  return normalizeSelectedRouteExecutionOrders(out);
}

function migrateStepFromEditorV1(step: number): CreateShiftScheduleStep {
  if (step === 2) return 3;
  if (step === 3) return 2;
  if (step >= 1 && step <= 6) return step as CreateShiftScheduleStep;
  return 1;
}

function clampStep(step: number): CreateShiftScheduleStep {
  return Math.min(6, Math.max(1, step)) as CreateShiftScheduleStep;
}

export function buildShiftScheduleDraftFromStored(
  name: string,
  body: Record<string, unknown>,
): ShiftScheduleCreateDraft {
  const editorVersion =
    typeof body.editorVersion === 'number' ? body.editorVersion : 1;

  const rawCurrentStep =
    typeof body.currentStep === 'number' ? body.currentStep : 1;
  const rawMaxReachedStep =
    typeof body.maxReachedStep === 'number' ? body.maxReachedStep : rawCurrentStep;

  const currentStep = clampStep(
    editorVersion >= 2 ? rawCurrentStep : migrateStepFromEditorV1(rawCurrentStep),
  );
  const maxReachedStep = clampStep(
    Math.max(
      currentStep,
      editorVersion >= 2 ? rawMaxReachedStep : migrateStepFromEditorV1(rawMaxReachedStep),
    ),
  );

  return {
    basic: {
      name: displayShiftScheduleDraftName(name),
      version: typeof body.version === 'string' ? body.version : '',
      remarks: typeof body.remarks === 'string' ? body.remarks : '',
    },
    maintenanceTask: {
      taskId: typeof body.maintenanceTaskId === 'string' ? body.maintenanceTaskId : '',
      taskName:
        typeof body.maintenanceTaskName === 'string'
          ? body.maintenanceTaskName
          : '',
      skipped: body.maintenanceTaskSkipped === true,
    },
    timeTemplate: {
      templateId: typeof body.timeTemplateId === 'string' ? body.timeTemplateId : '',
      templateName:
        typeof body.timeTemplateName === 'string' ? body.timeTemplateName : '',
    },
    routeGroups: {
      mapId: typeof body.routeGroupsMapId === 'string' ? body.routeGroupsMapId : '',
      selectedRoutes: parseShiftScheduleSelectedRoutes(body.selectedRoutes),
      minimumRecoveryTimeSeconds: normalizeMinimumRecoveryTimeSeconds(
        body.minimumRecoveryTimeSeconds,
      ),
    },
    scheduleOutput: parseShiftScheduleStoredOutput(body.scheduleOutput),
    currentStep,
    maxReachedStep,
  };
}

export function isShiftScheduleBasicStepComplete(basic: ShiftScheduleBasicDraft): boolean {
  return basic.name.trim().length > 0 && basic.version.trim().length > 0;
}

export function isCreateShiftScheduleStepComplete(
  step: CreateShiftScheduleStep,
  draft: ShiftScheduleCreateDraft,
  nameUniqueOk: boolean,
  turnaroundLimitSeconds: number | null = null,
): boolean {
  if (step === 1) {
    return isShiftScheduleBasicStepComplete(draft.basic) && nameUniqueOk;
  }
  if (step === 2) {
    return draft.maintenanceTask.skipped || draft.maintenanceTask.taskId.trim().length > 0;
  }
  if (step === 3) {
    return draft.timeTemplate.templateId.trim().length > 0;
  }
  if (step === 4) {
    const routes = draft.routeGroups.selectedRoutes;
    const recoverySeconds = draft.routeGroups.minimumRecoveryTimeSeconds;
    return (
      recoverySeconds !== null
      && routes.length > 0
      && routes.every(
        (route) =>
          route.executionOrder > 0
          && isSelectedRouteDwellReady(route, turnaroundLimitSeconds, recoverySeconds ?? undefined),
      )
    );
  }
  if (step === 5) {
    return (
      draft.scheduleOutput?.plan != null
      && draft.scheduleOutput.feasibilityReport.ok === true
    );
  }
  if (step === 6) {
    return draft.scheduleOutput?.plan != null;
  }
  return true;
}

export function isShiftScheduleStepComplete(
  draft: ShiftScheduleCreateDraft,
  nameUnique: boolean,
  turnaroundLimitSeconds: number | null = null,
): boolean {
  return isCreateShiftScheduleStepComplete(
    draft.currentStep,
    draft,
    nameUnique,
    turnaroundLimitSeconds,
  );
}
