import {
  categoriesForZone,
  doesActionNeedResource,
  resolveActionFieldStages,
  resolveShiftActionCategory,
  SHIFT_ACTION_ZONE_LABELS,
  type ShiftActionBehavior,
  type ShiftActionCategoryId,
  type ShiftActionOffsetUnit,
  type ShiftActionTargetKind,
  type ShiftActionZoneKind,
} from './actionSettingsCatalog';

/** 同步用：僅需路線與站點識別 */
export type ActionSettingsRouteStationsRef = {
  routeId: string;
  routeName: string;
  routeCode?: string | null;
  stationIds: string[];
  stationDwells: Array<{ stationId: string; stationName: string }>;
};

export type ShiftRouteSegmentAction = {
  id: string;
  categoryId: ShiftActionCategoryId | null;
  /** 使用者已用 + 解鎖到第幾個串聯欄位（0＝僅類別） */
  revealedStageCount: number;
  offsetValue: number | null;
  offsetUnit: ShiftActionOffsetUnit | null;
  targetKind: ShiftActionTargetKind | null;
  /** 站點類別＝當前站點；設施類別＝指定設施 ID */
  targetId: string | null;
  behavior: ShiftActionBehavior | null;
  resourceId: string | null;
};

export type ShiftStationActionBlock = {
  stationId: string;
  stationName: string;
  beforeArrive: ShiftRouteSegmentAction[];
  afterArrive: ShiftRouteSegmentAction[];
};

export type ShiftMovingActionBlock = {
  fromStationId: string;
  fromStationName: string;
  toStationId: string;
  toStationName: string;
  actions: ShiftRouteSegmentAction[];
};

export type ShiftRouteActionSettings = {
  routeId: string;
  routeName: string;
  routeCode?: string | null;
  stations: ShiftStationActionBlock[];
  movingLegs: ShiftMovingActionBlock[];
};

export type ShiftScheduleActionSettingsDraft = {
  routes: ShiftRouteActionSettings[];
};

export function emptyShiftScheduleActionSettingsDraft(): ShiftScheduleActionSettingsDraft {
  return { routes: [] };
}

export function createEmptySegmentAction(
  defaults?: Partial<ShiftRouteSegmentAction>,
): ShiftRouteSegmentAction {
  return {
    id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    categoryId: null,
    revealedStageCount: 0,
    offsetValue: null,
    offsetUnit: null,
    targetKind: null,
    targetId: null,
    behavior: null,
    resourceId: null,
    ...defaults,
  };
}

function stationLabel(
  route: ActionSettingsRouteStationsRef,
  stationId: string,
): string {
  const dwell = route.stationDwells.find((item) => item.stationId === stationId);
  return dwell?.stationName?.trim() || stationId;
}

function resolveStationIds(route: ActionSettingsRouteStationsRef): string[] {
  if (route.stationDwells.length > 0) {
    return route.stationDwells.map((dwell) => dwell.stationId);
  }
  return route.stationIds;
}

function cloneActions(actions: ShiftRouteSegmentAction[] | undefined): ShiftRouteSegmentAction[] {
  return (actions ?? []).map((action) => ({ ...action }));
}

export type ActionModuleSource = {
  key: string;
  zone: ShiftActionZoneKind;
  routeId: string;
  routeName: string;
  label: string;
  actions: ShiftRouteSegmentAction[];
};

function moduleKey(
  zone: ShiftActionZoneKind,
  routeId: string,
  stationOrLegKey: string,
): string {
  return `${zone}::${routeId}::${stationOrLegKey}`;
}

/** 列出當前草稿中，同模塊類型且已有行動的來源（供套用） */
export function listActionModuleSources(
  draft: ShiftScheduleActionSettingsDraft,
  zone: ShiftActionZoneKind,
  excludeKey?: string | null,
): ActionModuleSource[] {
  const sources: ActionModuleSource[] = [];
  for (const route of draft.routes) {
    if (zone === 'before_arrive' || zone === 'after_arrive') {
      for (const station of route.stations) {
        const actions =
          zone === 'before_arrive' ? station.beforeArrive : station.afterArrive;
        if (actions.length === 0) continue;
        const key = moduleKey(zone, route.routeId, station.stationId);
        if (excludeKey && key === excludeKey) continue;
        const zoneLabel = SHIFT_ACTION_ZONE_LABELS[zone];
        sources.push({
          key,
          zone,
          routeId: route.routeId,
          routeName: route.routeName,
          label: `${route.routeName} · ${zoneLabel} · ${station.stationName}`,
          actions,
        });
      }
    } else {
      for (const leg of route.movingLegs) {
        if (leg.actions.length === 0) continue;
        const legKey = `${leg.fromStationId}->${leg.toStationId}`;
        const key = moduleKey('moving', route.routeId, legKey);
        if (excludeKey && key === excludeKey) continue;
        sources.push({
          key,
          zone: 'moving',
          routeId: route.routeId,
          routeName: route.routeName,
          label: `${route.routeName} · ${SHIFT_ACTION_ZONE_LABELS.moving} · ${leg.fromStationName} → ${leg.toStationName}`,
          actions: leg.actions,
        });
      }
    }
  }
  return sources;
}

export function buildActionModuleKey(
  zone: ShiftActionZoneKind,
  routeId: string,
  stationOrLegKey: string,
): string {
  return moduleKey(zone, routeId, stationOrLegKey);
}

/** 套用模塊：複製行動並產生新 id；站點類目標改綁當前站點 */
export function cloneActionsForModuleApply(
  sourceActions: ShiftRouteSegmentAction[],
  stationIdForStationZone: string | null,
): ShiftRouteSegmentAction[] {
  const stamp = Date.now();
  return sourceActions.map((action, index) => {
    const cloned: ShiftRouteSegmentAction = {
      ...action,
      id: `action-${stamp}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    };
    if (
      stationIdForStationZone
      && resolveShiftActionCategory(cloned.categoryId)?.group === 'station'
    ) {
      cloned.targetKind = 'specific_station';
      cloned.targetId = stationIdForStationZone;
    }
    return cloned;
  });
}

/** 依第四步路線／站序重建區塊骨架，保留仍對得上的行動 */
export function syncActionSettingsWithSelectedRoutes(
  draft: ShiftScheduleActionSettingsDraft,
  selectedRoutes: ActionSettingsRouteStationsRef[],
): ShiftScheduleActionSettingsDraft {
  const prevByRoute = new Map(draft.routes.map((route) => [route.routeId, route]));

  const routes: ShiftRouteActionSettings[] = selectedRoutes.map((route) => {
    const prev = prevByRoute.get(route.routeId);
    const stationIds = resolveStationIds(route);

    const stations: ShiftStationActionBlock[] = stationIds.map((stationId) => {
      const prevStation = prev?.stations?.find((item) => item.stationId === stationId);
      return {
        stationId,
        stationName: stationLabel(route, stationId),
        beforeArrive: cloneActions(prevStation?.beforeArrive),
        afterArrive: cloneActions(prevStation?.afterArrive),
      };
    });

    const movingLegs: ShiftMovingActionBlock[] = [];
    for (let index = 0; index < stationIds.length - 1; index += 1) {
      const fromStationId = stationIds[index]!;
      const toStationId = stationIds[index + 1]!;
      const prevLeg = prev?.movingLegs?.find(
        (leg) =>
          leg.fromStationId === fromStationId && leg.toStationId === toStationId,
      );
      // 相容舊版 segments：遷移到移動中
      const legacySegment = (
        prev as { segments?: ShiftMovingActionBlock[] } | undefined
      )?.segments?.find(
        (leg) =>
          leg.fromStationId === fromStationId && leg.toStationId === toStationId,
      );
      movingLegs.push({
        fromStationId,
        fromStationName: stationLabel(route, fromStationId),
        toStationId,
        toStationName: stationLabel(route, toStationId),
        actions: cloneActions(prevLeg?.actions ?? legacySegment?.actions),
      });
    }

    return {
      routeId: route.routeId,
      routeName: route.routeName,
      routeCode: route.routeCode,
      stations,
      movingLegs,
    };
  });

  return { routes };
}

function parseCategoryId(raw: unknown): ShiftActionCategoryId | null {
  if (typeof raw !== 'string') return null;
  return resolveShiftActionCategory(raw as ShiftActionCategoryId)
    ? (raw as ShiftActionCategoryId)
    : null;
}

function parseOffsetUnit(raw: unknown): ShiftActionOffsetUnit | null {
  return raw === 'meters' || raw === 'seconds' ? raw : null;
}

function parseTargetKind(raw: unknown): ShiftActionTargetKind | null {
  if (
    raw === 'specific_station'
    || raw === 'general_station'
    || raw === 'specific_facility'
    || raw === 'general_facility'
  ) {
    return raw;
  }
  return null;
}

function parseBehavior(raw: unknown): ShiftActionBehavior | null {
  if (raw === 'play_music') return raw;
  return null;
}

function parseAction(raw: unknown): ShiftRouteSegmentAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id =
    typeof o.id === 'string' && o.id.trim()
      ? o.id.trim()
      : `action-${Math.random().toString(36).slice(2, 10)}`;
  const categoryId = parseCategoryId(o.categoryId);
  const offsetRaw = o.offsetValue;
  const offsetValue =
    typeof offsetRaw === 'number' && Number.isFinite(offsetRaw) && offsetRaw >= 0
      ? Math.round(offsetRaw)
      : null;
  const revealed =
    typeof o.revealedStageCount === 'number' && o.revealedStageCount >= 0
      ? Math.round(o.revealedStageCount)
      : categoryId
        ? resolveActionFieldStages(resolveShiftActionCategory(categoryId)).length
        : 0;

  return {
    id,
    categoryId,
    revealedStageCount: revealed,
    offsetValue,
    offsetUnit: parseOffsetUnit(o.offsetUnit),
    targetKind: parseTargetKind(o.targetKind),
    targetId: typeof o.targetId === 'string' ? o.targetId.trim() || null : null,
    behavior: parseBehavior(o.behavior),
    resourceId: typeof o.resourceId === 'string' ? o.resourceId.trim() || null : null,
  };
}

function parseActionList(raw: unknown): ShiftRouteSegmentAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseAction)
    .filter((action): action is ShiftRouteSegmentAction => action != null);
}

export function parseShiftScheduleActionSettings(
  raw: unknown,
): ShiftScheduleActionSettingsDraft {
  if (!raw || typeof raw !== 'object') return emptyShiftScheduleActionSettingsDraft();
  const root = raw as Record<string, unknown>;
  if (!Array.isArray(root.routes)) return emptyShiftScheduleActionSettingsDraft();

  const routes: ShiftRouteActionSettings[] = [];
  for (const item of root.routes) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const routeId = typeof o.routeId === 'string' ? o.routeId.trim() : '';
    if (!routeId) continue;

    const stations: ShiftStationActionBlock[] = [];
    if (Array.isArray(o.stations)) {
      for (const stationRaw of o.stations) {
        if (!stationRaw || typeof stationRaw !== 'object') continue;
        const s = stationRaw as Record<string, unknown>;
        const stationId = typeof s.stationId === 'string' ? s.stationId.trim() : '';
        if (!stationId) continue;
        stations.push({
          stationId,
          stationName:
            typeof s.stationName === 'string' && s.stationName.trim()
              ? s.stationName
              : stationId,
          beforeArrive: parseActionList(s.beforeArrive),
          afterArrive: parseActionList(s.afterArrive),
        });
      }
    }

    const movingLegs: ShiftMovingActionBlock[] = [];
    const legsRaw = Array.isArray(o.movingLegs)
      ? o.movingLegs
      : Array.isArray(o.segments)
        ? o.segments
        : [];
    for (const legRaw of legsRaw) {
      if (!legRaw || typeof legRaw !== 'object') continue;
      const leg = legRaw as Record<string, unknown>;
      const fromStationId =
        typeof leg.fromStationId === 'string' ? leg.fromStationId.trim() : '';
      const toStationId = typeof leg.toStationId === 'string' ? leg.toStationId.trim() : '';
      if (!fromStationId || !toStationId) continue;
      movingLegs.push({
        fromStationId,
        fromStationName:
          typeof leg.fromStationName === 'string' && leg.fromStationName.trim()
            ? leg.fromStationName
            : fromStationId,
        toStationId,
        toStationName:
          typeof leg.toStationName === 'string' && leg.toStationName.trim()
            ? leg.toStationName
            : toStationId,
        actions: parseActionList(leg.actions),
      });
    }

    routes.push({
      routeId,
      routeName: typeof o.routeName === 'string' ? o.routeName : '',
      routeCode:
        typeof o.routeCode === 'string' && o.routeCode.trim()
          ? o.routeCode.trim().toUpperCase()
          : undefined,
      stations,
      movingLegs,
    });
  }
  return { routes };
}

export function isSegmentActionComplete(action: ShiftRouteSegmentAction): boolean {
  const category = resolveShiftActionCategory(action.categoryId);
  if (!category) return false;

  if (category.offsetUnits.length > 0) {
    if (action.offsetValue == null || action.offsetValue < 0) return false;
    if (!action.offsetUnit || !category.offsetUnits.includes(action.offsetUnit)) {
      return false;
    }
  }

  if (category.requiresTargetSelect) {
    if (!action.targetKind || !category.targetKinds.includes(action.targetKind)) {
      return false;
    }
    if (
      (action.targetKind === 'specific_facility'
        || action.targetKind === 'general_facility')
      && !action.targetId?.trim()
    ) {
      return false;
    }
  } else if (!action.targetId?.trim()) {
    // 站點類別必須綁定當前站點
    return false;
  }

  if (!action.behavior || !category.behaviors.includes(action.behavior)) {
    return false;
  }

  if (doesActionNeedResource(category, action.behavior) && !action.resourceId?.trim()) {
    return false;
  }

  return true;
}

function forEachAction(
  draft: ShiftScheduleActionSettingsDraft,
  visit: (action: ShiftRouteSegmentAction) => boolean,
): boolean {
  for (const route of draft.routes) {
    for (const station of route.stations ?? []) {
      for (const action of station.beforeArrive) {
        if (!visit(action)) return false;
      }
      for (const action of station.afterArrive) {
        if (!visit(action)) return false;
      }
    }
    for (const leg of route.movingLegs ?? []) {
      for (const action of leg.actions) {
        if (!visit(action)) return false;
      }
    }
  }
  return true;
}

/** 步驟可完成：允許無行動；若有行動則每一筆皆須填完 */
export function isActionSettingsDraftComplete(
  draft: ShiftScheduleActionSettingsDraft,
): boolean {
  return forEachAction(draft, (action) => isSegmentActionComplete(action));
}

/** 目前已解鎖欄位中，可否再按 + 往下一階 */
export function canRevealNextActionStage(action: ShiftRouteSegmentAction): boolean {
  const category = resolveShiftActionCategory(action.categoryId);
  if (!category) return false;
  const stages = resolveActionFieldStages(category);
  if (action.revealedStageCount >= stages.length) return false;

  if (action.revealedStageCount === 0) {
    return action.categoryId != null;
  }

  const currentStage = stages[action.revealedStageCount - 1];
  if (!currentStage) return false;

  switch (currentStage) {
    case 'offset':
      return (
        action.offsetValue != null
        && action.offsetValue >= 0
        && action.offsetUnit != null
        && category.offsetUnits.includes(action.offsetUnit)
      );
    case 'target':
      if (!action.targetKind || !category.targetKinds.includes(action.targetKind)) {
        return false;
      }
      if (
        (action.targetKind === 'specific_facility'
          || action.targetKind === 'general_facility')
        && !action.targetId?.trim()
      ) {
        return false;
      }
      return true;
    case 'behavior':
      if (!action.behavior || !category.behaviors.includes(action.behavior)) return false;
      if (
        category.resourceRule === 'media_only'
        && !doesActionNeedResource(category, action.behavior)
      ) {
        return false;
      }
      return true;
    case 'resource':
      return Boolean(action.resourceId?.trim());
    default:
      return false;
  }
}

export function shouldShowResourceStage(action: ShiftRouteSegmentAction): boolean {
  const category = resolveShiftActionCategory(action.categoryId);
  if (!category) return false;
  if (category.resourceRule === 'never') return false;
  // always／media_only：行為需要媒體時顯示
  return doesActionNeedResource(category, action.behavior);
}

function isStageFilled(
  action: ShiftRouteSegmentAction,
  category: NonNullable<ReturnType<typeof resolveShiftActionCategory>>,
  stage: 'offset' | 'target' | 'behavior' | 'resource',
): boolean {
  switch (stage) {
    case 'offset':
      return (
        action.offsetValue != null
        && action.offsetValue >= 0
        && action.offsetUnit != null
        && category.offsetUnits.includes(action.offsetUnit)
      );
    case 'target':
      if (!action.targetKind || !category.targetKinds.includes(action.targetKind)) {
        return false;
      }
      if (
        (action.targetKind === 'specific_facility'
          || action.targetKind === 'general_facility')
        && !action.targetId?.trim()
      ) {
        return false;
      }
      return true;
    case 'behavior':
      return Boolean(action.behavior && category.behaviors.includes(action.behavior));
    case 'resource':
      return Boolean(action.resourceId?.trim());
    default:
      return false;
  }
}

/**
 * 依已填內容自動決定要顯示到哪一階（選完就跳出下一框；未填完則停在該階）。
 */
export function resolveVisibleActionStages(
  action: ShiftRouteSegmentAction,
): Array<'offset' | 'target' | 'behavior' | 'resource'> {
  const category = resolveShiftActionCategory(action.categoryId);
  if (!category || !action.categoryId) return [];

  const stages = resolveActionFieldStages(category).filter((stage) => {
    if (stage === 'resource' && !shouldShowResourceStage(action)) return false;
    return stage !== 'category';
  }) as Array<'offset' | 'target' | 'behavior' | 'resource'>;

  const visible: Array<'offset' | 'target' | 'behavior' | 'resource'> = [];
  for (const stage of stages) {
    visible.push(stage);
    if (!isStageFilled(action, category, stage)) break;
  }
  return visible;
}

export function reorderActionsInList(
  actions: ShiftRouteSegmentAction[],
  actionId: string,
  direction: 'up' | 'down',
): ShiftRouteSegmentAction[] {
  const index = actions.findIndex((action) => action.id === actionId);
  if (index < 0) return actions;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= actions.length) return actions;
  const next = [...actions];
  const [item] = next.splice(index, 1);
  next.splice(targetIndex, 0, item!);
  return next;
}

export function countActionsInDraft(draft: ShiftScheduleActionSettingsDraft): number {
  let count = 0;
  forEachAction(draft, () => {
    count += 1;
    return true;
  });
  return count;
}

export function listCategoriesAllowedInZone(zone: ShiftActionZoneKind) {
  return categoriesForZone(zone);
}
