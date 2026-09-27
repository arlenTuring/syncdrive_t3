import { MAX_NODE_WORLD_H, MAX_NODE_WORLD_W } from '../constants/facilityDimensions'
import { clamp } from './dom'
import type { MapWorldBounds } from './mapViewport'

/** 維持游標下的世界座標不變（圖台 scale 變更後調整 scroll） */
export function preserveViewportWorldPointAtClient(
  viewport: HTMLDivElement,
  prevScaleX: number,
  prevScaleY: number,
  newScaleX: number,
  newScaleY: number,
  clientX: number,
  clientY: number,
  worldBounds?: MapWorldBounds,
): void {
  const rect = viewport.getBoundingClientRect()
  const localX = clientX - rect.left
  const localY = clientY - rect.top
  const psx = prevScaleX > 0 ? prevScaleX : 1
  const psy = prevScaleY > 0 ? prevScaleY : 1
  const nsx = newScaleX > 0 ? newScaleX : 1
  const nsy = newScaleY > 0 ? newScaleY : 1
  const worldX = (viewport.scrollLeft + localX) / psx
  const worldY = (viewport.scrollTop + localY) / psy
  const w = viewport.clientWidth
  const h = viewport.clientHeight
  const worldW = worldBounds?.worldW ?? MAX_NODE_WORLD_W
  const worldH = worldBounds?.worldH ?? MAX_NODE_WORLD_H
  const maxSl = Math.max(0, worldW * nsx - w)
  const maxSt = Math.max(0, worldH * nsy - h)
  viewport.scrollLeft = clamp(worldX * nsx - localX, 0, maxSl)
  viewport.scrollTop = clamp(worldY * nsy - localY, 0, maxSt)
}

/** 是否為觸控板捏合／Ctrl+滾輪縮放手勢 */
export function isCanvasZoomWheelEvent(e: WheelEvent): boolean {
  return e.ctrlKey || e.metaKey
}

/**
 * 是否為滑鼠滾輪一格一格的捲動（不是觸控板兩指滑動）。
 *
 * 地圖編輯器拿掉縮放列之後，放大縮小只靠滾輪與觸控板：滑鼠滾輪直接縮放，觸控板捏合縮放，
 * 觸控板兩指滑動仍是平移。瀏覽器不直接說是哪一種，用舊的 wheelDeltaY 判斷：
 * 觸控板的 wheelDeltaY 固定是 deltaY 的 -3 倍；滑鼠是 120 的倍數、且不等於 -3 倍。
 * 沒有 wheelDeltaY 的瀏覽器（Firefox）滑鼠用行為單位（deltaMode ≠ 0）。
 */
export function isMouseWheelNotchEvent(e: WheelEvent): boolean {
  if (e.ctrlKey || e.metaKey) return false
  if (e.deltaMode !== 0) return true
  if (e.deltaX !== 0 || e.deltaY === 0) return false
  const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY
  if (typeof legacy === 'number' && legacy !== 0) {
    return Math.abs(legacy) % 120 === 0 && legacy !== -3 * e.deltaY
  }
  return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50
}
