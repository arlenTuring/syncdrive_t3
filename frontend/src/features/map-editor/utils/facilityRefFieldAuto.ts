import type { MapAreaObject } from '../types/area'
import type { FacilityObject, FacilityType } from '../types/facility'
import {
  resolveFacilityAreaPosition,
  resolveFacilityAreaSize,
} from './facilityAreaCoords'
import { fieldMetersAtAreaLocal } from './fieldFromArea'
import {
  getRefFieldPosition,
  hasValidRefFieldPosition,
  patchRefFieldPosition,
  REF_FIELD_X_M,
  REF_FIELD_Y_M,
} from './facilityRefFieldPosition'

/** 放置在圖台上時應由映射自動帶入參照場域單點的元件 */
export const AUTO_REF_FIELD_POINT_TYPES: FacilityType[] = [
  'DockingPoint',
  'Waypoint',
]

export function shouldAutoSeedRefFieldPoint(type: FacilityType): boolean {
  return AUTO_REF_FIELD_POINT_TYPES.includes(type)
}

function roundFieldMeters(n: number): number {
  return Math.round(n * 100) / 100
}

/** 元件中心在 Area 內的區域座標（左下原點、y 向上） */
export function facilityCenterAreaLocal(
  facility: FacilityObject,
  area: MapAreaObject,
): { x: number; y: number } {
  const pos = resolveFacilityAreaPosition(facility, area.domain, area.layout)
  const size = resolveFacilityAreaSize(facility, area.domain, area.layout)
  return {
    x: pos.x + size.w / 2,
    y: pos.y + size.h / 2,
  }
}

/**
 * 依圖台位置反推參照場域單點（公尺）。
 * 有軌道生成時走軌道映射；否則退回 Area domain。
 */
export function suggestRefFieldPositionFromPlacement(
  facility: FacilityObject,
  area: MapAreaObject,
): { xM: number; yM: number } | null {
  if (!shouldAutoSeedRefFieldPoint(facility.type)) return null
  const center = facilityCenterAreaLocal(facility, area)
  const field = fieldMetersAtAreaLocal(area, center.x, center.y)
  if (!Number.isFinite(field.xM) || !Number.isFinite(field.yM)) return null
  return {
    xM: roundFieldMeters(field.xM),
    yM: roundFieldMeters(field.yM),
  }
}

/**
 * 依目前圖台位置覆寫參照場域單點（停靠點／途經點）。
 * 拖曳、微調後呼叫，讓映射結果跟著走。
 */
export function syncAutoRefFieldPositionFromPlacement(
  facility: FacilityObject,
  area: MapAreaObject,
): FacilityObject {
  if (!shouldAutoSeedRefFieldPoint(facility.type)) return facility
  const suggested = suggestRefFieldPositionFromPlacement(facility, area)
  if (!suggested) return facility
  const current = getRefFieldPosition(facility.parameters)
  if (current.xM === suggested.xM && current.yM === suggested.yM) return facility
  return {
    ...facility,
    parameters: patchRefFieldPosition(facility.parameters, {
      xM: suggested.xM,
      yM: suggested.yM,
    }),
  }
}

/**
 * 尚未設定參照場域位置時，寫入圖台映射建議值。
 * 已有手動／既有數值則不覆寫。
 */
export function applyAutoRefFieldPositionIfUnset(
  facility: FacilityObject,
  area: MapAreaObject,
): FacilityObject {
  if (!shouldAutoSeedRefFieldPoint(facility.type)) return facility
  if (hasValidRefFieldPosition(facility.parameters)) return facility
  return syncAutoRefFieldPositionFromPlacement(facility, area)
}

/** 對 Area 內所有可自動帶入的點位補齊未設定的參照場域位置 */
export function ensureAutoRefFieldPositionsInAreas(
  areas: MapAreaObject[],
): MapAreaObject[] {
  let changed = false
  const next = areas.map((area) => {
    let areaChanged = false
    const facilities = area.facilities.map((f) => {
      const seeded = applyAutoRefFieldPositionIfUnset(f, area)
      if (seeded !== f) areaChanged = true
      return seeded
    })
    if (!areaChanged) return area
    changed = true
    return { ...area, facilities }
  })
  return changed ? next : areas
}

/** 測試／除錯：讀取寫入的參照場域欄位鍵名 */
export const AUTO_REF_FIELD_PARAM_KEYS = [REF_FIELD_X_M, REF_FIELD_Y_M] as const
