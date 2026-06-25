import {
  clampMapPixelSize,
  MIN_MAP_PIXEL,
  type MapPixelSize,
} from '../constants/mapPixel'
import type { MapAreaObject } from '../types/area'

export type MapPixelResizeEdge =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'tl'
  | 'tr'
  | 'bl'
  | 'br'

/** 畫布外框拖曳軌道寬度（與 Area 外軌道同級） */
export const MAP_PIXEL_FRAME_TRACK_PX = 14

export function cursorForMapPixelEdge(edge: MapPixelResizeEdge): string {
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

/** 依現有 Area 布局推算畫布最小可縮尺寸（保留邊距） */
export function minMapPixelSizeFromAreas(
  areas: MapAreaObject[],
  paddingPx = 32,
): MapPixelSize {
  let minW = MIN_MAP_PIXEL
  let minH = MIN_MAP_PIXEL
  for (const area of areas) {
    const { xPx, yPx, wPx, hPx } = area.layout
    minW = Math.max(minW, xPx + wPx + paddingPx)
    minH = Math.max(minH, yPx + hPx + paddingPx)
  }
  return clampMapPixelSize({ width: minW, height: minH })
}

export type MapPixelResizeResult = {
  pixelSize: MapPixelSize
  /** 從左／上縮放時需平移所有 Area 的偏移（px） */
  areaOffsetPx: { dx: number; dy: number }
}

/**
 * 依拖曳邊／角調整監控畫布像素尺寸（錨點：拖右／下為擴張；拖左／上會平移 Area）。
 */
export function mapPixelSizeFromEdgeDrag(
  start: MapPixelSize,
  edge: MapPixelResizeEdge,
  dx: number,
  dy: number,
  minSize: MapPixelSize,
): MapPixelResizeResult {
  let width = start.width
  let height = start.height
  let offsetX = 0
  let offsetY = 0

  if (edge === 'right') {
    width = start.width + dx
  } else if (edge === 'left') {
    width = start.width - dx
    offsetX = dx
  } else if (edge === 'bottom') {
    height = start.height + dy
  } else if (edge === 'top') {
    height = start.height - dy
    offsetY = dy
  } else if (edge === 'br') {
    width = start.width + dx
    height = start.height + dy
  } else if (edge === 'bl') {
    width = start.width - dx
    height = start.height + dy
    offsetX = dx
  } else if (edge === 'tr') {
    width = start.width + dx
    height = start.height - dy
    offsetY = dy
  } else if (edge === 'tl') {
    width = start.width - dx
    height = start.height - dy
    offsetX = dx
    offsetY = dy
  }

  const clamped = clampMapPixelSize({ width, height })
  const clampedDx =
    start.width !== clamped.width && (edge === 'left' || edge === 'tl' || edge === 'bl')
      ? start.width - clamped.width
      : 0
  const clampedDy =
    start.height !== clamped.height && (edge === 'top' || edge === 'tl' || edge === 'tr')
      ? start.height - clamped.height
      : 0

  const minW = minSize.width
  const minH = minSize.height
  const finalW = Math.max(clamped.width, minW)
  const finalH = Math.max(clamped.height, minH)

  return {
    pixelSize: { width: finalW, height: finalH },
    areaOffsetPx: {
      dx: offsetX + clampedDx,
      dy: offsetY + clampedDy,
    },
  }
}
