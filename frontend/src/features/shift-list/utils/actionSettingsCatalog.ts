/** 班表「行動設定」步驟：行動類別與串聯欄位規則 */

export type ShiftActionCategoryId =
  | 'before_arrive_station'
  | 'vehicle_stopped'
  | 'station_dwelling'
  | 'about_to_depart'
  | 'left_station'
  | 'approaching_facility'
  | 'facility_waiting'
  | 'passed_facility';

/** 行動放置區塊 */
export type ShiftActionZoneKind = 'before_arrive' | 'after_arrive' | 'moving';

export type ShiftActionOffsetUnit = 'meters' | 'seconds';

export type ShiftActionTargetKind =
  | 'specific_station'
  | 'general_station'
  | 'specific_facility'
  | 'general_facility';

export type ShiftActionBehavior = 'play_music';

export type ShiftActionResourceRule = 'always' | 'media_only' | 'never';

export type ShiftActionFieldStage =
  | 'category'
  | 'offset'
  | 'target'
  | 'behavior'
  | 'resource';

export type ShiftActionCategoryDef = {
  id: ShiftActionCategoryId;
  group: 'station' | 'facility';
  /** 可出現的區塊 */
  zone: ShiftActionZoneKind;
  label: string;
  /** 數值偏移說明；null 表示此類別無偏移 */
  offsetLabel: string | null;
  /** 允許的偏移單位；空陣列＝無偏移 */
  offsetUnits: ShiftActionOffsetUnit[];
  targetKinds: ShiftActionTargetKind[];
  /**
   * 站點類別固定為當前站點，不需使用者選目標。
   * 設施類別仍需選指定／通用設施。
   */
  requiresTargetSelect: boolean;
  behaviors: ShiftActionBehavior[];
  resourceRule: ShiftActionResourceRule;
};

export const SHIFT_ACTION_OFFSET_UNIT_OPTIONS: Array<{
  value: ShiftActionOffsetUnit;
  label: string;
}> = [
  { value: 'meters', label: '公尺' },
  { value: 'seconds', label: '秒' },
];

export const SHIFT_ACTION_TARGET_KIND_OPTIONS: Array<{
  value: ShiftActionTargetKind;
  label: string;
}> = [
  { value: 'specific_station', label: '指定站點' },
  { value: 'general_station', label: '通用站點' },
  { value: 'specific_facility', label: '指定設施' },
  { value: 'general_facility', label: '通用設施' },
];

export const SHIFT_ACTION_BEHAVIOR_OPTIONS: Array<{
  value: ShiftActionBehavior;
  label: string;
}> = [{ value: 'play_music', label: '播放音樂' }];

export const SHIFT_ACTION_ZONE_LABELS: Record<ShiftActionZoneKind, string> = {
  before_arrive: '進站前',
  after_arrive: '進站後',
  moving: '移動中',
};

export const SHIFT_ACTION_CATEGORY_CATALOG: ShiftActionCategoryDef[] = [
  {
    id: 'before_arrive_station',
    group: 'station',
    zone: 'before_arrive',
    label: '抵達站點前',
    offsetLabel: '前',
    offsetUnits: ['meters', 'seconds'],
    targetKinds: ['specific_station'],
    requiresTargetSelect: false,
    behaviors: ['play_music'],
    resourceRule: 'always',
  },
  {
    id: 'vehicle_stopped',
    group: 'station',
    zone: 'before_arrive',
    label: '載具已停妥',
    offsetLabel: '停妥後',
    offsetUnits: ['seconds'],
    targetKinds: ['specific_station'],
    requiresTargetSelect: false,
    behaviors: ['play_music'],
    resourceRule: 'always',
  },
  {
    id: 'station_dwelling',
    group: 'station',
    zone: 'after_arrive',
    label: '站點停留中',
    offsetLabel: null,
    offsetUnits: [],
    targetKinds: ['specific_station'],
    requiresTargetSelect: false,
    behaviors: ['play_music'],
    resourceRule: 'always',
  },
  {
    id: 'about_to_depart',
    group: 'station',
    zone: 'after_arrive',
    label: '即將發車中',
    offsetLabel: null,
    offsetUnits: [],
    targetKinds: ['specific_station'],
    requiresTargetSelect: false,
    behaviors: ['play_music'],
    resourceRule: 'always',
  },
  {
    id: 'left_station',
    group: 'station',
    zone: 'after_arrive',
    label: '已離開站點',
    offsetLabel: '離開後',
    offsetUnits: ['meters', 'seconds'],
    targetKinds: ['specific_station'],
    requiresTargetSelect: false,
    behaviors: ['play_music'],
    resourceRule: 'always',
  },
  {
    id: 'approaching_facility',
    group: 'facility',
    zone: 'moving',
    label: '駛近設施前',
    offsetLabel: '前',
    offsetUnits: ['meters', 'seconds'],
    targetKinds: ['specific_facility', 'general_facility'],
    requiresTargetSelect: true,
    behaviors: ['play_music'],
    resourceRule: 'always',
  },
  {
    id: 'facility_waiting',
    group: 'facility',
    zone: 'moving',
    label: '設施停等中',
    offsetLabel: null,
    offsetUnits: [],
    targetKinds: ['specific_facility', 'general_facility'],
    requiresTargetSelect: true,
    behaviors: ['play_music'],
    resourceRule: 'always',
  },
  {
    id: 'passed_facility',
    group: 'facility',
    zone: 'moving',
    label: '已通過設施',
    offsetLabel: '通過後',
    offsetUnits: ['meters', 'seconds'],
    targetKinds: ['specific_facility', 'general_facility'],
    requiresTargetSelect: true,
    behaviors: ['play_music'],
    resourceRule: 'always',
  },
];

const CATEGORY_BY_ID = new Map(
  SHIFT_ACTION_CATEGORY_CATALOG.map((item) => [item.id, item]),
);

export function resolveShiftActionCategory(
  id: ShiftActionCategoryId | null | undefined,
): ShiftActionCategoryDef | null {
  if (!id) return null;
  return CATEGORY_BY_ID.get(id) ?? null;
}

export function categoriesForZone(zone: ShiftActionZoneKind): ShiftActionCategoryDef[] {
  return SHIFT_ACTION_CATEGORY_CATALOG.filter((item) => item.zone === zone);
}

/** 需要媒體／媒體群組的行為 */
export function isMediaBehavior(behavior: ShiftActionBehavior | null | undefined): boolean {
  return behavior === 'play_music';
}

export function doesActionNeedResource(
  category: ShiftActionCategoryDef | null,
  behavior: ShiftActionBehavior | null | undefined,
): boolean {
  if (!category) return false;
  if (category.resourceRule === 'never') return false;
  return isMediaBehavior(behavior);
}

/** 依類別決定欄位串聯順序（不含 category 本身） */
export function resolveActionFieldStages(
  category: ShiftActionCategoryDef | null,
): ShiftActionFieldStage[] {
  if (!category) return [];
  const stages: ShiftActionFieldStage[] = [];
  if (category.offsetUnits.length > 0) stages.push('offset');
  if (category.requiresTargetSelect) stages.push('target');
  stages.push('behavior');
  if (category.resourceRule === 'always' || category.resourceRule === 'media_only') {
    stages.push('resource');
  }
  return stages;
}

/** 預設單位：有公尺則用公尺，否則取該類別唯一單位（如秒） */
export function resolveDefaultOffsetUnit(
  category: ShiftActionCategoryDef | null,
): ShiftActionOffsetUnit | null {
  if (!category || category.offsetUnits.length === 0) return null;
  if (category.offsetUnits.includes('meters')) return 'meters';
  return category.offsetUnits[0]!;
}

export function labelForActionTargetKind(kind: ShiftActionTargetKind): string {
  return SHIFT_ACTION_TARGET_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? kind;
}

export function labelForActionBehavior(behavior: ShiftActionBehavior): string {
  return SHIFT_ACTION_BEHAVIOR_OPTIONS.find((item) => item.value === behavior)?.label ?? behavior;
}

export function labelForOffsetUnit(unit: ShiftActionOffsetUnit): string {
  return SHIFT_ACTION_OFFSET_UNIT_OPTIONS.find((item) => item.value === unit)?.label ?? unit;
}
