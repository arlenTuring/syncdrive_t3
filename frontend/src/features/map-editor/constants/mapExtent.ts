import { metersToWorldPx } from './map'

/** 新建空白圖台預設場域（公尺）：寬 × 高 */
export const DEFAULT_MAP_EXTENT_WIDTH_METERS = 960
export const DEFAULT_MAP_EXTENT_HEIGHT_METERS = 420

export const MIN_MAP_EXTENT_METERS = 10
export const MAX_MAP_EXTENT_METERS = 100_000

export type MapExtentMeters = { width: number; height: number }

export function defaultMapExtentMeters(): MapExtentMeters {
  return {
    width: DEFAULT_MAP_EXTENT_WIDTH_METERS,
    height: DEFAULT_MAP_EXTENT_HEIGHT_METERS,
  }
}

export function clampMapExtentMeters(raw: {
  width: unknown
  height: unknown
}): MapExtentMeters {
  const width =
    typeof raw.width === 'number' && Number.isFinite(raw.width)
      ? raw.width
      : DEFAULT_MAP_EXTENT_WIDTH_METERS
  const height =
    typeof raw.height === 'number' && Number.isFinite(raw.height)
      ? raw.height
      : DEFAULT_MAP_EXTENT_HEIGHT_METERS
  return {
    width: Math.min(
      MAX_MAP_EXTENT_METERS,
      Math.max(MIN_MAP_EXTENT_METERS, width),
    ),
    height: Math.min(
      MAX_MAP_EXTENT_METERS,
      Math.max(MIN_MAP_EXTENT_METERS, height),
    ),
  }
}

export function mapWorldSizeFromExtent(extent: MapExtentMeters): {
  widthM: number
  heightM: number
  worldW: number
  worldH: number
} {
  return {
    widthM: extent.width,
    heightM: extent.height,
    worldW: metersToWorldPx(extent.width),
    worldH: metersToWorldPx(extent.height),
  }
}
