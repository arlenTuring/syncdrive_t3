import { getTrackGenPaths } from './trackGenPaths'
import { realBounds } from './trackGenApply'
import type { MapAreaObject } from '../types/area'
import type { MapBasemapObject } from '../types/basemap'
import type { FacilityObject, FacilityType } from '../types/facility'
import {
  resolveFacilityAreaPosition,
  resolveFacilityAreaSize,
} from './facilityAreaCoords'
import { areaHasTrackGenTracks, fieldMetersAtAreaLocal } from './fieldFromArea'
import {
  areaSupportsAutoFieldCoords,
} from './facilityRefFieldAuto'
import {
  getRefFieldBounds,
  hasValidRefFieldBounds,
  patchRefFieldBounds,
  type RefFieldBoundsMeters,
} from './facilityRefFieldBounds'
import {
  boundsFromRefFieldCorners,
  getRefFieldCorners,
  hasValidRefFieldCorners,
  REF_FIELD_CORNER_COUNT,
  REF_FIELD_CORNERS_M,
  serializeRefFieldCorners,
  type RefFieldCornerMeters,
} from './facilityRefFieldCorners'
import {
  CROSS_HANDLE_KEYS,
  cornerTrackEndSegmentsPx,
  crossTrackEndSegmentsPx,
  readCornerTrack,
  readCrossTrack,
  readSwitchTrack,
  readTaperTrack,
  switchTrackEndSegmentsPx,
  taperTrackEndSegmentsPx,
} from './trackShapes'

/** 可依圖台外型自動推算場域範圍的元件類型 */
export function shouldAutoSeedRefFieldBounds(type: FacilityType): boolean {
  return type === 'Track'
}

function roundFieldMeters(n: number): number {
  return Math.round(n * 100) / 100
}

/** 斜接的場域範圍是四個角，不是左右上下四個數 */
export function usesCornerFieldRange(facility: FacilityObject): boolean {
  return facility.type === 'Track' && facility.name === 'RailTaper'
}

/**
 * 軌道填色外型在 Area 內的角點（左下原點、y 向上）。
 * 斜接取梯形四角，順序 A→B→C→D：A 端起 → A 端迄 → B 端迄 → B 端起。
 */
export function trackFootprintCornersAreaLocal(
  facility: FacilityObject,
  area: MapAreaObject,
): Array<{ x: number; y: number }> {
  const pos = resolveFacilityAreaPosition(facility, area.domain, area.layout)
  const size = resolveFacilityAreaSize(facility, area.domain, area.layout)
  if (!(size.w > 0) || !(size.h > 0)) return []

  const top = area.layout.hPx - pos.y - size.h
  const cx = pos.x + size.w / 2
  const cyCss = top + size.h / 2
  const rad = ((facility.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  /**
   * 元件內相對左上（y 向下）→ Area 區域座標（y 向上）。
   * 須套用 facility.rotation，與畫面 CSS 旋轉一致。
   */
  const fromBoxLocal = (qx: number, qy: number) => {
    const dx = qx - size.w / 2
    const dy = qy - size.h / 2
    const x = cx + dx * cos - dy * sin
    const yCss = cyCss + dx * sin + dy * cos
    return { x, y: area.layout.hPx - yCss }
  }

  if (facility.name === 'RailTaper') {
    const segs = taperTrackEndSegmentsPx(
      readTaperTrack(facility.parameters),
      size.w,
      size.h,
    )
    return [
      fromBoxLocal(segs.a[0].x, segs.a[0].y),
      fromBoxLocal(segs.a[1].x, segs.a[1].y),
      fromBoxLocal(segs.b[1].x, segs.b[1].y),
      fromBoxLocal(segs.b[0].x, segs.b[0].y),
    ]
  }

  if (facility.name === 'RailCorner') {
    const segs = cornerTrackEndSegmentsPx(
      readCornerTrack(facility.parameters),
      size.w,
      size.h,
    )
    return [
      fromBoxLocal(segs.a[0].x, segs.a[0].y),
      fromBoxLocal(segs.a[1].x, segs.a[1].y),
      fromBoxLocal(segs.b[1].x, segs.b[1].y),
      fromBoxLocal(segs.b[0].x, segs.b[0].y),
    ]
  }

  if (facility.name === 'RailSwitch') {
    const segs = switchTrackEndSegmentsPx(
      readSwitchTrack(facility.parameters),
      size.w,
      size.h,
    )
    const pts: Array<{ x: number; y: number }> = []
    for (const k of ['a', 'm', 'b'] as const) {
      pts.push(fromBoxLocal(segs[k][0].x, segs[k][0].y))
      pts.push(fromBoxLocal(segs[k][1].x, segs[k][1].y))
    }
    return pts
  }

  if (facility.name === 'RailCross') {
    const segs = crossTrackEndSegmentsPx(
      readCrossTrack(facility.parameters),
      size.w,
      size.h,
    )
    const pts: Array<{ x: number; y: number }> = []
    for (const k of CROSS_HANDLE_KEYS) {
      pts.push(fromBoxLocal(segs[k][0].x, segs[k][0].y))
      pts.push(fromBoxLocal(segs[k][1].x, segs[k][1].y))
    }
    return pts
  }

  const hw = size.w / 2
  const hh = size.h / 2
  const cornerCss = (dx: number, dy: number) => ({
    x: cx + dx * cos - dy * sin,
    y: cyCss + dx * sin + dy * cos,
  })
  return [
    cornerCss(-hw, -hh),
    cornerCss(hw, -hh),
    cornerCss(hw, hh),
    cornerCss(-hw, hh),
  ].map((p) => ({ x: p.x, y: area.layout.hPx - p.y }))
}

/** 斜接：圖上四角 → 場域四點（各 x/y） */
export function suggestRefFieldCornersFromPlacement(
  facility: FacilityObject,
  area: MapAreaObject,
  basemaps?: readonly MapBasemapObject[],
): RefFieldCornerMeters[] | null {
  if (!usesCornerFieldRange(facility)) return null
  if (!areaSupportsAutoFieldCoords(area, basemaps)) return null

  const locals = trackFootprintCornersAreaLocal(facility, area)
  if (locals.length < REF_FIELD_CORNER_COUNT) return null

  const generated = areaHasTrackGenTracks(area)
  const corners: RefFieldCornerMeters[] = []
  for (let i = 0; i < REF_FIELD_CORNER_COUNT; i += 1) {
    const c = locals[i]!
    const field = fieldMetersAtAreaLocal(area, c.x, c.y, {
      preferTrackId: facility.id,
    })
    if (!Number.isFinite(field.xM) || !Number.isFinite(field.yM)) return null
    /*
     * 有生成軌道的圖上，沒有任何一塊能解釋這個角。
     *
     * 換算會退回容器自己的網域，那是另一個座標系；四個角混著兩套數字寫進去，出來的
     * 範圍會橫跨整張圖。這種時候<strong>不要寫</strong>——沒有場域範圍的方塊，下游看得
     * 出來它沒有；範圍是錯的則看不出來。
     */
    if (generated && field.source === 'area') return null
    corners.push({
      xM: roundFieldMeters(field.xM),
      yM: roundFieldMeters(field.yM),
    })
  }
  return corners
}

/** 寫入四角點，並同步左右上下四個數給舊消費者 */
export function patchRefFieldCornersAndBounds(
  parameters: Record<string, unknown> | undefined,
  corners: RefFieldCornerMeters[],
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(parameters ?? {}),
    [REF_FIELD_CORNERS_M]: serializeRefFieldCorners(corners),
  }
  const bounds = boundsFromRefFieldCorners(corners)
  if (bounds) {
    return patchRefFieldBounds(next, bounds)
  }
  return next
}

/**
 * 依圖台外型反推場域範圍（左右上下）。
 * 斜接會先算四角點再取極值。
 */
export function suggestRefFieldBoundsFromPlacement(
  facility: FacilityObject,
  area: MapAreaObject,
  basemaps?: readonly MapBasemapObject[],
): RefFieldBoundsMeters | null {
  if (!shouldAutoSeedRefFieldBounds(facility.type)) return null
  if (!areaSupportsAutoFieldCoords(area, basemaps)) return null

  if (usesCornerFieldRange(facility)) {
    const corners = suggestRefFieldCornersFromPlacement(facility, area, basemaps)
    if (!corners) return null
    const bounds = boundsFromRefFieldCorners(corners)
    if (!bounds) return null
    return {
      xMinM: bounds.xMinM,
      xMaxM: bounds.xMaxM,
      yMinM: bounds.yMinM,
      yMaxM: bounds.yMaxM,
    }
  }

  /*
   * 有現場中心線的直軌道與圓角：範圍就是中心線的外框往兩側撐半個車道——生成器寫的就是這個
   * （trackGenApply.realBounds）。「重算」與載入時的範圍必須是同一個定義，否則每按一次、
   * 每載入一次都會改一批軌道的數字（72 塊裡 40 塊）。
   */
  if (facility.name === 'Rail' || facility.name === 'RailCorner') {
    const paths = getTrackGenPaths(facility.parameters)
    if (paths && paths.real.length > 0) {
      const b = realBounds(paths.real.map(([x, y]) => ({ x, y })))
      if (Object.keys(b).length === 4) {
        const v = b as Record<string, number>
        return {
          xMinM: v.refFieldXMinM!,
          xMaxM: v.refFieldXMaxM!,
          yMinM: v.refFieldYMinM!,
          yMaxM: v.refFieldYMaxM!,
        }
      }
    }
  }

  const locals = trackFootprintCornersAreaLocal(facility, area)
  if (locals.length < 2) return null

  const generated = areaHasTrackGenTracks(area)
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (const c of locals) {
    const field = fieldMetersAtAreaLocal(area, c.x, c.y, {
      preferTrackId: facility.id,
    })
    if (!Number.isFinite(field.xM) || !Number.isFinite(field.yM)) continue
    // 混到容器網域的答案就整塊不寫，理由同 suggestRefFieldCornersFromPlacement
    if (generated && field.source === 'area') return null
    if (field.xM < xMin) xMin = field.xM
    if (field.xM > xMax) xMax = field.xM
    if (field.yM < yMin) yMin = field.yM
    if (field.yM > yMax) yMax = field.yM
  }
  if (!(xMax > xMin) || !(yMax > yMin)) return null
  return {
    xMinM: roundFieldMeters(xMin),
    xMaxM: roundFieldMeters(xMax),
    yMinM: roundFieldMeters(yMin),
    yMaxM: roundFieldMeters(yMax),
  }
}

function cornersEqual(
  a: RefFieldCornerMeters[],
  b: RefFieldCornerMeters[],
): boolean {
  for (let i = 0; i < REF_FIELD_CORNER_COUNT; i += 1) {
    if (a[i]?.xM !== b[i]?.xM || a[i]?.yM !== b[i]?.yM) return false
  }
  return true
}

/** 依目前圖台外型覆寫場域範圍（接合後、手動重算） */
export function syncAutoRefFieldBoundsFromPlacement(
  facility: FacilityObject,
  area: MapAreaObject,
  basemaps?: readonly MapBasemapObject[],
): FacilityObject {
  if (!shouldAutoSeedRefFieldBounds(facility.type)) return facility
  if (!areaSupportsAutoFieldCoords(area, basemaps)) return facility

  if (usesCornerFieldRange(facility)) {
    const corners = suggestRefFieldCornersFromPlacement(facility, area, basemaps)
    if (!corners) return facility
    if (cornersEqual(getRefFieldCorners(facility.parameters), corners)) {
      return facility
    }
    return {
      ...facility,
      parameters: patchRefFieldCornersAndBounds(facility.parameters, corners),
    }
  }

  const suggested = suggestRefFieldBoundsFromPlacement(facility, area, basemaps)
  if (!suggested) return facility
  const current = getRefFieldBounds(facility.parameters)
  if (
    current.xMinM === suggested.xMinM &&
    current.xMaxM === suggested.xMaxM &&
    current.yMinM === suggested.yMinM &&
    current.yMaxM === suggested.yMaxM
  ) {
    return facility
  }
  return {
    ...facility,
    parameters: patchRefFieldBounds(facility.parameters, suggested),
  }
}

/** 尚未設定時寫入圖台推算值（斜接看四角點是否齊） */
export function applyAutoRefFieldBoundsIfUnset(
  facility: FacilityObject,
  area: MapAreaObject,
  basemaps?: readonly MapBasemapObject[],
): FacilityObject {
  if (!shouldAutoSeedRefFieldBounds(facility.type)) return facility
  if (!areaSupportsAutoFieldCoords(area, basemaps)) return facility
  if (usesCornerFieldRange(facility)) {
    if (hasValidRefFieldCorners(facility.parameters)) return facility
    return syncAutoRefFieldBoundsFromPlacement(facility, area, basemaps)
  }
  if (hasValidRefFieldBounds(facility.parameters)) return facility
  return syncAutoRefFieldBoundsFromPlacement(facility, area, basemaps)
}

/** 對 Area 內軌道補齊未設定的場域範圍 */
export function ensureAutoRefFieldBoundsInAreas(
  areas: MapAreaObject[],
  basemaps?: readonly MapBasemapObject[],
): MapAreaObject[] {
  let changed = false
  const next = areas.map((area) => {
    if (!areaSupportsAutoFieldCoords(area, basemaps)) return area
    let areaChanged = false
    const facilities = area.facilities.map((f) => {
      const seeded = applyAutoRefFieldBoundsIfUnset(f, area, basemaps)
      if (seeded !== f) areaChanged = true
      return seeded
    })
    if (!areaChanged) return area
    changed = true
    return { ...area, facilities }
  })
  return changed ? next : areas
}

/**
 * 接合完成後立刻寫入場域範圍（覆寫既有值，因形狀已變）。
 */
export function refFieldBoundsPatchAfterTrackJoin(
  facility: FacilityObject,
  area: MapAreaObject,
  next: {
    box: { x: number; y: number; w: number; h: number }
    patch: Record<string, unknown> | null
    layoutHPx: number
  },
  basemaps?: readonly MapBasemapObject[],
): Record<string, unknown> {
  if (!areaSupportsAutoFieldCoords(area, basemaps)) return {}
  const preview: FacilityObject = {
    ...facility,
    parameters: { ...(facility.parameters ?? {}), ...(next.patch ?? {}) },
    areaSizePx: { w: next.box.w, h: next.box.h },
    areaPosition: {
      x: next.box.x,
      y: next.layoutHPx - next.box.y - next.box.h,
    },
  }

  if (usesCornerFieldRange(preview)) {
    const corners = suggestRefFieldCornersFromPlacement(preview, area, basemaps)
    if (!corners) return {}
    return patchRefFieldCornersAndBounds({}, corners)
  }

  const suggested = suggestRefFieldBoundsFromPlacement(preview, area, basemaps)
  if (!suggested) return {}
  return patchRefFieldBounds({}, suggested)
}
