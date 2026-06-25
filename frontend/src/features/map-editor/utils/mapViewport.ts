import {
  MAX_NODE_WORLD_H,
  MAX_NODE_WORLD_W,
  facilityNodeWorldSize,
} from '../constants/facilityDimensions'
import { metersToWorldPx } from '../constants/map'
import type { FacilityObject } from '../types/facility'
import { clamp } from './dom'

export type MapWorldBounds = { worldW: number; worldH: number }

function resolveWorldBounds(bounds?: MapWorldBounds): MapWorldBounds {
  return {
    worldW: bounds?.worldW ?? MAX_NODE_WORLD_W,
    worldH: bounds?.worldH ?? MAX_NODE_WORLD_H,
  }
}

/** 將捲動位置對齊到圖台幾何中心（世界座標中心對齊可視區中心） */
export function scrollViewportToMapCenter(
  viewport: HTMLDivElement | null,
  scaleX: number,
  scaleY: number,
  worldBounds?: MapWorldBounds,
): void {
  if (!viewport) return
  const { worldW, worldH } = resolveWorldBounds(worldBounds)
  const sx = scaleX > 0 ? scaleX : 1
  const sy = scaleY > 0 ? scaleY : 1
  const cw = worldW * sx
  const ch = worldH * sy
  const w = viewport.clientWidth
  const h = viewport.clientHeight
  viewport.scrollLeft = Math.max(0, (cw - w) / 2)
  viewport.scrollTop = Math.max(0, (ch - h) / 2)
}

/**
 * 將可視區對齊到「所有設施」的包圍盒中心（世界像素座標）。
 * 大場域（5km）時若只捲到整張圖中心，位於角落的範例會完全在畫外。
 */
export function scrollViewportToFacilitiesFocus(
  viewport: HTMLDivElement | null,
  scaleX: number,
  scaleY: number,
  facilities: FacilityObject[],
  worldBounds?: MapWorldBounds,
): void {
  if (!viewport || facilities.length === 0) {
    scrollViewportToMapOrigin(viewport, scaleX, scaleY, worldBounds)
    return
  }
  const { worldW, worldH } = resolveWorldBounds(worldBounds)
  const sx = scaleX > 0 ? scaleX : 1
  const sy = scaleY > 0 ? scaleY : 1
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const f of facilities) {
    const { w, h } = facilityNodeWorldSize(f)
    minX = Math.min(minX, f.position.x)
    minY = Math.min(minY, f.position.y)
    maxX = Math.max(maxX, f.position.x + w)
    maxY = Math.max(maxY, f.position.y + h)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const w = viewport.clientWidth
  const h = viewport.clientHeight
  const maxSl = Math.max(0, worldW * sx - w)
  const maxSt = Math.max(0, worldH * sy - h)
  viewport.scrollLeft = clamp(cx * sx - w / 2, 0, maxSl)
  viewport.scrollTop = clamp(cy * sy - h / 2, 0, maxSt)
}

/** 對準世界像素座標的一點（例如由 mapCenterMeters 換算後） */
export function scrollViewportToWorldPoint(
  viewport: HTMLDivElement | null,
  scaleX: number,
  scaleY: number,
  worldX: number,
  worldY: number,
  worldBounds?: MapWorldBounds,
): void {
  if (!viewport) return
  const { worldW, worldH } = resolveWorldBounds(worldBounds)
  const sx = scaleX > 0 ? scaleX : 1
  const sy = scaleY > 0 ? scaleY : 1
  const w = viewport.clientWidth
  const h = viewport.clientHeight
  const maxSl = Math.max(0, worldW * sx - w)
  const maxSt = Math.max(0, worldH * sy - h)
  viewport.scrollLeft = clamp(worldX * sx - w / 2, 0, maxSl)
  viewport.scrollTop = clamp(worldY * sy - h / 2, 0, maxSt)
}

/** 將可視區中心對齊場域原點（0,0 公尺，左上角） */
export function scrollViewportToMapOrigin(
  viewport: HTMLDivElement | null,
  scaleX: number,
  scaleY: number,
  worldBounds?: MapWorldBounds,
): void {
  scrollViewportToWorldPoint(viewport, scaleX, scaleY, 0, 0, worldBounds)
}

/**
 * 將可視區對準軌跡（公尺座標）包圍盒中心，避免先建立大量世界像素點陣列。
 */
export function scrollViewportToTrajectoryMeters(
  viewport: HTMLDivElement | null,
  scaleX: number,
  scaleY: number,
  points: { positionMeters: { x: number; y: number } }[],
): void {
  if (!viewport || points.length === 0) return
  let minXm = Infinity
  let minYm = Infinity
  let maxXm = -Infinity
  let maxYm = -Infinity
  for (const p of points) {
    const x = p.positionMeters.x
    const y = p.positionMeters.y
    minXm = Math.min(minXm, x)
    minYm = Math.min(minYm, y)
    maxXm = Math.max(maxXm, x)
    maxYm = Math.max(maxYm, y)
  }
  const cx = metersToWorldPx((minXm + maxXm) / 2)
  const cy = metersToWorldPx((minYm + maxYm) / 2)
  scrollViewportToWorldPoint(viewport, scaleX, scaleY, cx, cy)
}

/**
 * 將可視區對準軌跡上「目前車輛」點（replay 指標；無則對準第一個點）。
 */
export function scrollViewportToTrajectoryHead(
  viewport: HTMLDivElement | null,
  scaleX: number,
  scaleY: number,
  points: { positionMeters: { x: number; y: number } }[],
  headIndex: number | null,
): void {
  if (!viewport || points.length === 0) return
  let idx = 0
  if (
    headIndex !== null &&
    headIndex >= 0 &&
    headIndex < points.length
  ) {
    idx = headIndex
  }
  const p = points[idx]
  const wx = metersToWorldPx(p.positionMeters.x)
  const wy = metersToWorldPx(p.positionMeters.y)
  scrollViewportToWorldPoint(viewport, scaleX, scaleY, wx, wy)
}

/** 對準地圖檔定義的中心點（公尺 → 世界像素） */
export function scrollViewportToMapCenterMeters(
  viewport: HTMLDivElement | null,
  scaleX: number,
  scaleY: number,
  centerMeters: { x: number; y: number },
): void {
  const wx = metersToWorldPx(centerMeters.x)
  const wy = metersToWorldPx(centerMeters.y)
  scrollViewportToWorldPoint(viewport, scaleX, scaleY, wx, wy)
}

/**
 * 載入地圖後捲動優先順序：
 * 1. 地圖檔 mapCenterMeters
 * 2. 有設施則包圍盒中心
 * 3. 無設施則場域原點（0,0 公尺）
 */
export function scrollViewportAfterMapLoad(
  viewport: HTMLDivElement | null,
  scaleX: number,
  scaleY: number,
  facilities: FacilityObject[],
  mapCenterMeters: { x: number; y: number } | null,
  worldBounds?: MapWorldBounds,
): void {
  if (mapCenterMeters) {
    scrollViewportToMapCenterMeters(viewport, scaleX, scaleY, mapCenterMeters)
    return
  }
  if (facilities.length === 0) {
    scrollViewportToMapOrigin(viewport, scaleX, scaleY, worldBounds)
  } else {
    scrollViewportToFacilitiesFocus(
      viewport,
      scaleX,
      scaleY,
      facilities,
      worldBounds,
    )
  }
}

/**
 * scaleX／scaleY 變更時（縮放列或顯示比例），維持「可視區中心」對應的世界座標不變，
 * 否則 scroll 像素未換算，視角會飄走，虛擬化節點會像消失。
 */
export function preserveViewportWorldCenterOnScaleChange(
  viewport: HTMLDivElement | null,
  prevScaleX: number,
  prevScaleY: number,
  newScaleX: number,
  newScaleY: number,
  worldBounds?: MapWorldBounds,
): void {
  if (!viewport) return
  const { worldW, worldH } = resolveWorldBounds(worldBounds)
  const psx = prevScaleX > 0 ? prevScaleX : 1
  const psy = prevScaleY > 0 ? prevScaleY : 1
  const nsx = newScaleX > 0 ? newScaleX : 1
  const nsy = newScaleY > 0 ? newScaleY : 1
  if (
    Math.abs(psx - nsx) < 1e-12 &&
    Math.abs(psy - nsy) < 1e-12
  ) {
    return
  }
  const w = viewport.clientWidth
  const h = viewport.clientHeight
  if (w < 1 || h < 1) return
  const worldCx = (viewport.scrollLeft + w / 2) / psx
  const worldCy = (viewport.scrollTop + h / 2) / psy
  const maxSl = Math.max(0, worldW * nsx - w)
  const maxSt = Math.max(0, worldH * nsy - h)
  viewport.scrollLeft = clamp(worldCx * nsx - w / 2, 0, maxSl)
  viewport.scrollTop = clamp(worldCy * nsy - h / 2, 0, maxSt)
}
