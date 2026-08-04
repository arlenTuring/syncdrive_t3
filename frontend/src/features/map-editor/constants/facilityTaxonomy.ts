import type { FacilityType } from '../types/facility'

/**
 * 圖台物件分類（暫定）：
 * - 設備：路側／站務硬體（紅綠燈、智慧桿、月台門）
 * - 設施：大型區塊（充電格、停車格、維修格等，type=Facility + purpose）
 */
export const MAP_EQUIPMENT_TYPES = ['Signal', 'Pole', 'PSD'] as const satisfies readonly FacilityType[]

export const MAP_FACILITY_AREA_TYPES = ['Facility'] as const satisfies readonly FacilityType[]

export type MapEquipmentType = (typeof MAP_EQUIPMENT_TYPES)[number]
export type MapFacilityAreaType = (typeof MAP_FACILITY_AREA_TYPES)[number]

export function isMapEquipmentType(
  type: FacilityType,
): type is MapEquipmentType {
  return (MAP_EQUIPMENT_TYPES as readonly string[]).includes(type)
}

export function isMapFacilityAreaType(
  type: FacilityType,
): type is MapFacilityAreaType {
  return (MAP_FACILITY_AREA_TYPES as readonly string[]).includes(type)
}
