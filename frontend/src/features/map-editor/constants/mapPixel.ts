import type { MapPixelSize } from '../types/area'

export type { MapPixelSize }

export const MIN_MAP_PIXEL = 320
export const MAX_MAP_PIXEL = 8192
export const DEFAULT_MAP_PIXEL_WIDTH = 1920
export const DEFAULT_MAP_PIXEL_HEIGHT = 1080

export const DEFAULT_MAP_PIXEL_SIZE: MapPixelSize = {
  width: DEFAULT_MAP_PIXEL_WIDTH,
  height: DEFAULT_MAP_PIXEL_HEIGHT,
}

export function clampMapPixelSize(raw: Partial<MapPixelSize>): MapPixelSize {
  const w = Number(raw.width)
  const h = Number(raw.height)
  return {
    width: Math.min(
      MAX_MAP_PIXEL,
      Math.max(MIN_MAP_PIXEL, Number.isFinite(w) ? Math.round(w) : DEFAULT_MAP_PIXEL_WIDTH),
    ),
    height: Math.min(
      MAX_MAP_PIXEL,
      Math.max(MIN_MAP_PIXEL, Number.isFinite(h) ? Math.round(h) : DEFAULT_MAP_PIXEL_HEIGHT),
    ),
  }
}
