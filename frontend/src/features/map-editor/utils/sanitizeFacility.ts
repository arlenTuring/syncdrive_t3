import type { FacilityObject } from '../types/facility'
import { sanitizeZoneParameters } from './zonePartition'

type LegacyFacility = FacilityObject & {
  sizeMeters?: { w: number; h: number }
}

/** 移除已廢棄的 sizeMeters 欄位（舊檔匯入後清理） */
export function sanitizeFacilityForEditor(f: FacilityObject): FacilityObject {
  const legacy = f as LegacyFacility
  let next: FacilityObject = f
  if (legacy.sizeMeters) {
    const { sizeMeters: _removed, ...rest } = legacy
    next = rest as FacilityObject
  }
  return sanitizeZoneParameters(next)
}

export function sanitizeFacilitiesForEditor(
  list: FacilityObject[],
): FacilityObject[] {
  return list.map(sanitizeFacilityForEditor)
}
