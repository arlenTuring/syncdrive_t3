import {
  clampMapPixelSize,
  MIN_MAP_PIXEL,
} from '../constants/mapPixel'
import type { MapPixelOrigin, MapPixelSize } from '../types/area'

/** 工作區四周留白（px），用於在較大空間承載現有地圖 */
export const CROP_WORKSPACE_PADDING_PX = 400

export type MapCropRect = {
  x: number
  y: number
  width: number
  height: number
}

export type MapCropWorkspace = {
  workspace: MapPixelSize
  mapOffset: { x: number; y: number }
  /** 地圖內容在像素座標中的完整範圍（含已裁掉的留白區） */
  contentExtent: MapPixelSize
  cropRect: MapCropRect
}

/** 可視畫布 + 原點 → 內容座標系完整尺寸 */
export function mapContentExtent(
  viewport: MapPixelSize,
  pixelOrigin: MapPixelOrigin,
): MapPixelSize {
  return {
    width: viewport.width + pixelOrigin.x,
    height: viewport.height + pixelOrigin.y,
  }
}

export type MapCropResizeEdge =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'tl'
  | 'tr'
  | 'bl'
  | 'br'

export function cursorForCropEdge(edge: MapCropResizeEdge): string {
  switch (edge) {
    case 'left':
    case 'right':
      return 'ew-resize'
    case 'top':
    case 'bottom':
      return 'ns-resize'
    case 'tl':
    case 'br':
      return 'nwse-resize'
    case 'tr':
    case 'bl':
      return 'nesw-resize'
  }
}

/**
 * 建立裁減工作區：以完整內容範圍置中，初始裁切框＝目前可視區（pixelSize + pixelOrigin）。
 */
export function createCropWorkspace(
  viewport: MapPixelSize,
  pixelOrigin: MapPixelOrigin,
): MapCropWorkspace {
  const contentExtent = mapContentExtent(viewport, pixelOrigin)
  const pad = CROP_WORKSPACE_PADDING_PX
  const workspace = clampMapPixelSize({
    width: contentExtent.width + pad * 2,
    height: contentExtent.height + pad * 2,
  })
  const mapOffset = {
    x: Math.round((workspace.width - contentExtent.width) / 2),
    y: Math.round((workspace.height - contentExtent.height) / 2),
  }
  const cropRect: MapCropRect = {
    x: mapOffset.x + pixelOrigin.x,
    y: mapOffset.y + pixelOrigin.y,
    width: viewport.width,
    height: viewport.height,
  }
  return { workspace, mapOffset, contentExtent, cropRect }
}

/** 裁切框限制在工作區內，寬高至少 MIN_MAP_PIXEL */
export function clampCropRect(
  rect: MapCropRect,
  workspace: MapPixelSize,
): MapCropRect {
  let width = Math.max(MIN_MAP_PIXEL, Math.round(rect.width))
  let height = Math.max(MIN_MAP_PIXEL, Math.round(rect.height))
  let x = Math.round(rect.x)
  let y = Math.round(rect.y)

  if (x < 0) {
    width += x
    x = 0
  }
  if (y < 0) {
    height += y
    y = 0
  }

  x = Math.min(x, Math.max(0, workspace.width - MIN_MAP_PIXEL))
  y = Math.min(y, Math.max(0, workspace.height - MIN_MAP_PIXEL))
  width = Math.min(width, workspace.width - x)
  height = Math.min(height, workspace.height - y)
  width = Math.max(MIN_MAP_PIXEL, width)
  height = Math.max(MIN_MAP_PIXEL, height)

  return { x, y, width, height }
}

/**
 * 依拖曳邊／角調整裁切框：拖上邊時上邊下移（底邊固定），拖左邊時左邊右移（右邊固定）。
 */
export function cropRectFromDrag(
  start: MapCropRect,
  edge: MapCropResizeEdge,
  dx: number,
  dy: number,
  workspace: MapPixelSize,
): MapCropRect {
  let x = start.x
  let y = start.y
  let width = start.width
  let height = start.height

  switch (edge) {
    case 'right':
      width = start.width + dx
      break
    case 'left':
      x = start.x + dx
      width = start.width - dx
      break
    case 'bottom':
      height = start.height + dy
      break
    case 'top':
      y = start.y + dy
      height = start.height - dy
      break
    case 'br':
      width = start.width + dx
      height = start.height + dy
      break
    case 'bl':
      x = start.x + dx
      width = start.width - dx
      height = start.height + dy
      break
    case 'tr':
      y = start.y + dy
      width = start.width + dx
      height = start.height - dy
      break
    case 'tl':
      x = start.x + dx
      y = start.y + dy
      width = start.width - dx
      height = start.height - dy
      break
  }

  return clampCropRect({ x, y, width, height }, workspace)
}

export type MapCropApplyResult = {
  pixelSize: MapPixelSize
  pixelOrigin: MapPixelOrigin
}

/** 套用裁切：更新畫布 pixelSize 與內容原點；不修改 Area 座標 */
export function applyMapCrop(
  crop: MapCropRect,
  mapOffset: { x: number; y: number },
): MapCropApplyResult {
  return {
    pixelSize: clampMapPixelSize({
      width: crop.width,
      height: crop.height,
    }),
    pixelOrigin: {
      x: Math.max(0, Math.round(crop.x - mapOffset.x)),
      y: Math.max(0, Math.round(crop.y - mapOffset.y)),
    },
  }
}
