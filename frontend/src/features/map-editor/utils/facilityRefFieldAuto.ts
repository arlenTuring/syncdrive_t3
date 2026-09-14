import type { MapAreaObject } from '../types/area'
import type { MapBasemapObject } from '../types/basemap'
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
import { getTrackGenAreaId } from './trackGenFacility'
import { getTrackGenPaths } from './trackGenPaths'

/** 放置在圖台上時應由映射自動帶入／拖曳同步場域座標（單點）的元件 */
export const AUTO_REF_FIELD_POINT_TYPES: FacilityType[] = [
  'DockingPoint',
  'Waypoint',
  'Signal',
  'Pole',
  'PSD',
]

export function shouldAutoSeedRefFieldPoint(type: FacilityType): boolean {
  return AUTO_REF_FIELD_POINT_TYPES.includes(type)
}

/**
 * 僅高精連結／已生成軌道的 Area 才自動寫場域座標。
 * 一般空白 Area：手動填寫，拖曳不覆寫。
 */
export function areaSupportsAutoFieldCoords(
  area: MapAreaObject,
  basemaps?: readonly MapBasemapObject[],
): boolean {
  if (
    area.facilities.some(
      (f) => f.type === 'Track' && getTrackGenPaths(f.parameters) != null,
    )
  ) {
    return true
  }
  if (
    basemaps?.some((b) => getTrackGenAreaId(b.parameters) === area.id)
  ) {
    return true
  }
  return false
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
 * 依圖台位置反推場域座標（單點，公尺）。
 * 僅在高精 Area 內生效；有軌道生成時走軌道映射。
 */
export function suggestRefFieldPositionFromPlacement(
  facility: FacilityObject,
  area: MapAreaObject,
  basemaps?: readonly MapBasemapObject[],
): { xM: number; yM: number } | null {
  if (!shouldAutoSeedRefFieldPoint(facility.type)) return null
  if (!areaSupportsAutoFieldCoords(area, basemaps)) return null
  const center = facilityCenterAreaLocal(facility, area)
  const field = fieldMetersAtAreaLocal(area, center.x, center.y)
  if (!Number.isFinite(field.xM) || !Number.isFinite(field.yM)) return null
  return {
    xM: roundFieldMeters(field.xM),
    yM: roundFieldMeters(field.yM),
  }
}

/**
 * 依目前圖台位置覆寫場域座標（停靠點／途經點）。
 * 拖曳、微調後呼叫，讓映射結果跟著走。
 */
export function syncAutoRefFieldPositionFromPlacement(
  facility: FacilityObject,
  area: MapAreaObject,
  basemaps?: readonly MapBasemapObject[],
): FacilityObject {
  if (!shouldAutoSeedRefFieldPoint(facility.type)) return facility
  if (!areaSupportsAutoFieldCoords(area, basemaps)) return facility
  const suggested = suggestRefFieldPositionFromPlacement(facility, area, basemaps)
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
 * 尚未設定場域座標時，寫入圖台映射建議值。
 * 已有手動／既有數值則不覆寫。
 */
export function applyAutoRefFieldPositionIfUnset(
  facility: FacilityObject,
  area: MapAreaObject,
  basemaps?: readonly MapBasemapObject[],
): FacilityObject {
  if (!shouldAutoSeedRefFieldPoint(facility.type)) return facility
  if (!areaSupportsAutoFieldCoords(area, basemaps)) return facility
  if (hasValidRefFieldPosition(facility.parameters)) return facility
  return syncAutoRefFieldPositionFromPlacement(facility, area, basemaps)
}

/**
 * 照目前畫的位置<strong>重算</strong>停靠點／途經點的場域座標。
 *
 * <h3>為什麼只補空的不夠</h3>
 * applyAutoRefFieldPositionIfUnset 只在「還沒有值」時寫入，有值就不碰。但那個值是
 * <strong>某一刻</strong>寫下來的：後來軌道被合併、微調、重放，同一個圖面位置底下的
 * 方塊換了一塊，那個值就過期了，而且沒有任何跡象。
 *
 * 實測 T3 那兩個停靠點：畫在 D19／U19（那一段的場域是 −178.5 ～ −244.7），身上記的
 * 卻是 −135.38——那是上面一塊 D18／U18 的範圍，差了 76 公尺。路線的端點錨在這個值上，
 * 中間的折線卻照畫的位置走，所以路徑會先跑過頭再折回來。
 *
 * 圖上放在哪裡就是哪裡：那一段的比例被壓縮過，放進去的元件也該照同一個比例映射。
 * 所以載入時照畫的位置重算一次，不管原本有沒有值。
 */
export function resyncAutoRefFieldPositionsInAreas(
  areas: MapAreaObject[],
  basemaps?: readonly MapBasemapObject[],
): { areas: MapAreaObject[]; moved: Array<{ name: string; fromM: string; toM: string }> } {
  const moved: Array<{ name: string; fromM: string; toM: string }> = []
  let changed = false
  const next = areas.map((area) => {
    if (!areaSupportsAutoFieldCoords(area, basemaps)) return area
    let areaChanged = false
    const facilities = area.facilities.map((f) => {
      const synced = syncAutoRefFieldPositionFromPlacement(f, area, basemaps)
      if (synced === f) return f
      const before = getRefFieldPosition(f.parameters)
      const after = getRefFieldPosition(synced.parameters)
      const shift = Math.hypot(
        (after.xM ?? 0) - (before.xM ?? 0),
        (after.yM ?? 0) - (before.yM ?? 0),
      )
      // 只有原本就有值、而且真的搬了一段，才值得說一聲
      if (before.xM !== null && before.yM !== null && shift > 0.5) {
        moved.push({
          name: f.customName?.trim() || f.id,
          fromM: `${before.xM}, ${before.yM}`,
          toM: `${after.xM}, ${after.yM}`,
        })
      }
      areaChanged = true
      return synced
    })
    if (!areaChanged) return area
    changed = true
    return { ...area, facilities }
  })
  return { areas: changed ? next : areas, moved }
}

/** 對 Area 內所有可自動帶入的點位補齊未設定的場域座標 */
export function ensureAutoRefFieldPositionsInAreas(
  areas: MapAreaObject[],
  basemaps?: readonly MapBasemapObject[],
): MapAreaObject[] {
  let changed = false
  const next = areas.map((area) => {
    if (!areaSupportsAutoFieldCoords(area, basemaps)) return area
    let areaChanged = false
    const facilities = area.facilities.map((f) => {
      const seeded = applyAutoRefFieldPositionIfUnset(f, area, basemaps)
      if (seeded !== f) areaChanged = true
      return seeded
    })
    if (!areaChanged) return area
    changed = true
    return { ...area, facilities }
  })
  return changed ? next : areas
}

/** 測試／除錯：讀取寫入的場域座標欄位鍵名 */
export const AUTO_REF_FIELD_PARAM_KEYS = [REF_FIELD_X_M, REF_FIELD_Y_M] as const
