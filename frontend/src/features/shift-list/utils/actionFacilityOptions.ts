import { FACILITY_PALETTE_ITEMS } from '../../map-editor/constants/palette';
import {
  MAP_EQUIPMENT_TYPES,
  MAP_FACILITY_AREA_TYPES,
} from '../../map-editor/constants/facilityTaxonomy';
import type { FacilityObject, FacilityType } from '../../map-editor/types/facility';
import type { ShiftActionTargetKind } from './actionSettingsCatalog';

/** 行動設定可選：設備（紅綠燈／智慧桿／月台門）+ 大型設施區塊 */
export const ACTION_FACILITY_TYPES = [
  ...MAP_EQUIPMENT_TYPES,
  ...MAP_FACILITY_AREA_TYPES,
] as const satisfies readonly FacilityType[];

export type ActionFacilityType = (typeof ACTION_FACILITY_TYPES)[number];

export type ActionFacilityItemOption = {
  id: string;
  name: string;
};

export type ActionFacilityTypeGroup = {
  type: ActionFacilityType;
  /** equipment = 設備；facility_area = 大型設施 */
  category: 'equipment' | 'facility_area';
  typeLabel: string;
  /** 通用選項顯示名，如「全紅綠燈」 */
  generalLabel: string;
  facilities: ActionFacilityItemOption[];
};

const TYPE_LABEL_BY_TYPE = new Map(
  FACILITY_PALETTE_ITEMS.map((item) => [item.type, item.label] as const),
);

function isActionFacilityType(type: FacilityObject['type']): type is ActionFacilityType {
  return (ACTION_FACILITY_TYPES as readonly string[]).includes(type);
}

function resolveCategory(
  type: ActionFacilityType,
): ActionFacilityTypeGroup['category'] {
  return (MAP_EQUIPMENT_TYPES as readonly string[]).includes(type)
    ? 'equipment'
    : 'facility_area';
}

function resolveFacilityDisplayName(facility: FacilityObject): string {
  const custom = facility.customName?.trim();
  if (custom) return custom;
  return facility.id;
}

export function labelForActionFacilityType(type: ActionFacilityType): string {
  return TYPE_LABEL_BY_TYPE.get(type) ?? type;
}

export function generalLabelForActionFacilityType(type: ActionFacilityType): string {
  if (type === 'Facility') return '全設施';
  return `全${labelForActionFacilityType(type)}`;
}

export function encodeFacilityTargetValue(
  targetKind: ShiftActionTargetKind | null,
  targetId: string | null,
): string {
  if (!targetKind || !targetId?.trim()) return '';
  if (targetKind === 'general_facility') return `general:${targetId.trim()}`;
  if (targetKind === 'specific_facility') return `facility:${targetId.trim()}`;
  return '';
}

export function decodeFacilityTargetValue(raw: string): {
  targetKind: ShiftActionTargetKind | null;
  targetId: string | null;
} {
  const value = raw.trim();
  if (!value) return { targetKind: null, targetId: null };
  if (value.startsWith('general:')) {
    const type = value.slice('general:'.length).trim();
    return type
      ? { targetKind: 'general_facility', targetId: type }
      : { targetKind: null, targetId: null };
  }
  if (value.startsWith('facility:')) {
    const id = value.slice('facility:'.length).trim();
    return id
      ? { targetKind: 'specific_facility', targetId: id }
      : { targetKind: null, targetId: null };
  }
  return { targetKind: null, targetId: null };
}

export function resolveFacilityTargetLabel(
  targetKind: ShiftActionTargetKind | null,
  targetId: string | null,
  groups: ActionFacilityTypeGroup[],
): string {
  if (!targetKind || !targetId?.trim()) return '';
  if (targetKind === 'general_facility') {
    const group = groups.find((item) => item.type === targetId);
    return group?.generalLabel ?? `全${targetId}`;
  }
  if (targetKind === 'specific_facility') {
    for (const group of groups) {
      const facility = group.facilities.find((item) => item.id === targetId);
      if (facility) return `${group.typeLabel} · ${facility.name}`;
    }
    return targetId;
  }
  return '';
}

export function findFacilityTypeForTarget(
  targetKind: ShiftActionTargetKind | null,
  targetId: string | null,
  groups: ActionFacilityTypeGroup[],
): ActionFacilityType | null {
  if (!targetKind || !targetId?.trim()) return null;
  if (targetKind === 'general_facility') {
    const group = groups.find((item) => item.type === targetId);
    return group?.type ?? null;
  }
  if (targetKind === 'specific_facility') {
    for (const group of groups) {
      if (group.facilities.some((item) => item.id === targetId)) return group.type;
    }
  }
  return null;
}

export function buildActionFacilityGroupsFromAreas(
  areas: Array<{ facilities?: FacilityObject[] }>,
): ActionFacilityTypeGroup[] {
  const byType = new Map<ActionFacilityType, ActionFacilityItemOption[]>();
  for (const type of ACTION_FACILITY_TYPES) {
    byType.set(type, []);
  }

  for (const area of areas) {
    for (const facility of area.facilities ?? []) {
      if (!isActionFacilityType(facility.type)) continue;
      byType.get(facility.type)?.push({
        id: facility.id,
        name: resolveFacilityDisplayName(facility),
      });
    }
  }

  return ACTION_FACILITY_TYPES.map((type) => {
    const facilities = [...(byType.get(type) ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-Hant'),
    );
    return {
      type,
      category: resolveCategory(type),
      typeLabel: labelForActionFacilityType(type),
      generalLabel: generalLabelForActionFacilityType(type),
      facilities,
    };
  });
}

export async function loadActionFacilityGroups(
  mapId: string,
): Promise<ActionFacilityTypeGroup[]> {
  const trimmed = mapId.trim();
  if (!trimmed) return buildActionFacilityGroupsFromAreas([]);
  const { resolveParsedMapForPlatform } = await import(
    '../../map-editor/utils/mapLibraryStorage'
  );
  const parsed = await resolveParsedMapForPlatform(trimmed);
  return buildActionFacilityGroupsFromAreas(parsed?.areas ?? []);
}
