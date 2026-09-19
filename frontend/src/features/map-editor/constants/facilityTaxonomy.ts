import type { FacilityType } from '../types/facility'

/**
 * 圖台物件分類（暫定）：
 * - 設備：路側／站務硬體（紅綠燈、智慧桿、月台門）
 * - 設施：大型區塊（充電格、停車格、維修格等，type=Facility + purpose）
 */
export const MAP_EQUIPMENT_TYPES = ['Signal', 'Pole', 'PSD'] as const satisfies readonly FacilityType[]

export const MAP_FACILITY_AREA_TYPES = ['Facility'] as const satisfies readonly FacilityType[]

/**
 * 軌道：車子真的會走在上面的那一類。
 *
 * 一般軌道、圓角、斜接、分岔、交叉軌道都是 <code>Track</code>。它們在元件庫裡本來散在
 * 「其他」，跟電子圍籬、停靠點混在一起；使用者要放一段軌道時得在一整排裡面找。
 */
export const MAP_TRACK_TYPES = ['Track'] as const satisfies readonly FacilityType[]

export type MapEquipmentType = (typeof MAP_EQUIPMENT_TYPES)[number]
export type MapFacilityAreaType = (typeof MAP_FACILITY_AREA_TYPES)[number]
export type MapTrackType = (typeof MAP_TRACK_TYPES)[number]

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

export function isMapTrackType(type: FacilityType): type is MapTrackType {
  return (MAP_TRACK_TYPES as readonly string[]).includes(type)
}
