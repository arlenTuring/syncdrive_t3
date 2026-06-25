import type { FacilityObject } from '../types/facility'

type LegacyFacility = FacilityObject & {
  sizeMeters?: { w: number; h: number }
}

/** 移除已廢棄的 sizeMeters 欄位（舊檔匯入後清理） */
export function sanitizeFacilityForEditor(f: FacilityObject): FacilityObject {
  const legacy = f as LegacyFacility
  if (!legacy.sizeMeters) return f
  const { sizeMeters: _removed, ...rest } = legacy
  return rest as FacilityObject
}

export function sanitizeFacilitiesForEditor(
  list: FacilityObject[],
): FacilityObject[] {
  return list.map(sanitizeFacilityForEditor)
}
