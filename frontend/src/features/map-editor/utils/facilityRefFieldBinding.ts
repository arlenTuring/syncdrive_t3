import type { FacilityName, FacilityType } from '../types/facility'
import {
  defaultRefFieldBoundsParameters,
  ZERO_REF_FIELD_BOUNDS_PARAMETERS,
  REF_FIELD_X_MAX_M,
  REF_FIELD_X_MIN_M,
  REF_FIELD_Y_MAX_M,
  REF_FIELD_Y_MIN_M,
} from './facilityRefFieldBounds'
import {
  emptyRefFieldCorners,
  REF_FIELD_CORNERS_M,
} from './facilityRefFieldCorners'
import {
  defaultRefFieldPositionParameters,
  REF_FIELD_X_M,
  REF_FIELD_Y_M,
} from './facilityRefFieldPosition'

/** 場域座標為單點：號誌、智慧桿、月台門、停靠點、途經點（均可依圖台映射自動帶入） */
export const REF_FIELD_POINT_FACILITY_TYPES: FacilityType[] = [
  'Signal',
  'Pole',
  'PSD',
  'DockingPoint',
  'Waypoint',
]

/** 場域範圍（min/max）：軌道、設施、圍籬 */
export const REF_FIELD_BOUNDS_FACILITY_TYPES: FacilityType[] = [
  'Track',
  'Facility',
  'Geofence',
]

export function usesRefFieldPoint(type: FacilityType): boolean {
  return REF_FIELD_POINT_FACILITY_TYPES.includes(type)
}

export function usesRefFieldBounds(type: FacilityType): boolean {
  return REF_FIELD_BOUNDS_FACILITY_TYPES.includes(type)
}

/** 新增元件時預設 refField 欄位；Track 用範圍，其餘可設範圍的類型預設為 0 */
export function defaultRefFieldParametersForType(
  type: FacilityType,
  _options?: { customName?: string; segmentId?: string },
): Record<string, number | null> {
  if (usesRefFieldPoint(type)) return defaultRefFieldPositionParameters()
  if (usesRefFieldBounds(type)) {
    if (type === 'Track') return defaultRefFieldBoundsParameters()
    return { ...ZERO_REF_FIELD_BOUNDS_PARAMETERS }
  }
  return {}
}

/** 匯出地圖 JSON 時補齊 refField 欄位（未設定則為 null） */
export function ensureRefFieldParametersForExport(
  type: FacilityType,
  parameters: Record<string, unknown> | undefined,
  name?: FacilityName,
): Record<string, unknown> {
  const base = { ...(parameters ?? {}) }
  if (usesRefFieldPoint(type)) {
    if (!(REF_FIELD_X_M in base)) base[REF_FIELD_X_M] = null
    if (!(REF_FIELD_Y_M in base)) base[REF_FIELD_Y_M] = null
  }
  if (usesRefFieldBounds(type)) {
    if (!(REF_FIELD_X_MIN_M in base)) base[REF_FIELD_X_MIN_M] = null
    if (!(REF_FIELD_X_MAX_M in base)) base[REF_FIELD_X_MAX_M] = null
    if (!(REF_FIELD_Y_MIN_M in base)) base[REF_FIELD_Y_MIN_M] = null
    if (!(REF_FIELD_Y_MAX_M in base)) base[REF_FIELD_Y_MAX_M] = null
  }
  if (name === 'RailTaper' && !(REF_FIELD_CORNERS_M in base)) {
    base[REF_FIELD_CORNERS_M] = emptyRefFieldCorners()
  }
  return base
}
