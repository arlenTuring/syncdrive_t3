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
