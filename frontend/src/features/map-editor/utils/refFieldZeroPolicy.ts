import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { usesRefFieldBounds } from './facilityRefFieldBinding'
import {
  ZERO_REF_FIELD_BOUNDS_PARAMETERS,
  hasValidRefFieldBounds,
  isZeroRefFieldBoundsSpan,
} from './facilityRefFieldBounds'

/**
 * 僅對「尚未設定」的 Facility／Geofence 補 0 占位（不參與斷路掃描）。
 * 已設有效範圍或已為 0 占位者一律保留，避免載入時清掉編輯器設定。
 */
export function shouldZeroRefFieldBounds(f: FacilityObject): boolean {
  if (f.type === 'Signal') return false
  if (f.type === 'Track') return false
  if (!usesRefFieldBounds(f.type)) return false
  if (hasValidRefFieldBounds(f.parameters)) return false
  if (isZeroRefFieldBoundsSpan(f.parameters)) return false
  return true
}

export function applyZeroRefFieldBoundsToFacility(
  f: FacilityObject,
): FacilityObject {
  if (!shouldZeroRefFieldBounds(f)) return f
  return {
    ...f,
    parameters: { ...(f.parameters ?? {}), ...ZERO_REF_FIELD_BOUNDS_PARAMETERS },
  }
}

export function applyRefFieldZeroPolicyToAreas(
  areas: MapAreaObject[],
): MapAreaObject[] {
  return areas.map((area) => ({
    ...area,
    facilities: (area.facilities ?? []).map(applyZeroRefFieldBoundsToFacility),
  }))
}

/** 已明確設為 0 或有效範圍：不需從內建檔補 refField */
export function localRefFieldIsSatisfied(
  type: FacilityObject['type'],
  parameters: Record<string, unknown> | undefined,
): boolean {
  if (isZeroRefFieldBoundsSpan(parameters)) return true
  if (!usesRefFieldBounds(type)) return true
  if (hasValidRefFieldBounds(parameters)) return true
  return false
}
