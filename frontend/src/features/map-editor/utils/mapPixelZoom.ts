import { ZOOM_LEVEL_COUNT } from './zoom'

/** 像素 Map 縮放段數（與 ZoomLevelBar 一致） */
export const MAP_PIXEL_ZOOM_LEVEL_COUNT = ZOOM_LEVEL_COUNT

/** 預設縮放等級：6 遠（1 近、7 最遠） */
export const MAP_PIXEL_ZOOM_DEFAULT_LEVEL = 6

/** 滾輪／捏合：每 px deltaY 對應的等級增量（小值＝較細緻） */
export const MAP_PIXEL_ZOOM_WHEEL_SENSITIVITY = 0.0048

/**
 * 依視窗與 Map 像素尺寸產生 7 段「額外縮放倍率」。
 * - 等級 1：最放大（約可視 Map 寬度的 1/6）
 * - 等級 7：1×（配合 fit 剛好一屏看全圖）
 */
export function computeMapPixelZoomMultipliers(
  viewportW: number,
  viewportH: number,
  mapW: number,
  mapH: number,
): number[] {
  const vw = Math.max(32, viewportW)
  const vh = Math.max(32, viewportH)
  const mw = Math.max(1, mapW)
  const mh = Math.max(1, mapH)

  const maxMul = Math.max(
    2,
    Math.min(6, Math.max(mw / Math.max(vw * 0.55, 360), mh / Math.max(vh * 0.55, 200))),
  )

  const levels: number[] = []
  for (let i = 0; i < MAP_PIXEL_ZOOM_LEVEL_COUNT; i++) {
    const t = i / (MAP_PIXEL_ZOOM_LEVEL_COUNT - 1)
    levels.push(maxMul + t * (1 - maxMul))
  }
  return levels
}

export function clampMapPixelZoomLevel(level: number): number {
  return Math.max(1, Math.min(MAP_PIXEL_ZOOM_LEVEL_COUNT, level))
}

/** 滾輪／捏合：連續調整等級（可含小數，避免一次跳一整級） */
export function applyWheelToMapPixelZoomLevel(level: number, deltaY: number): number {
  return clampMapPixelZoomLevel(level + deltaY * MAP_PIXEL_ZOOM_WHEEL_SENSITIVITY)
}

/** 依浮點等級在相鄰段之間線性插值倍率 */
export function interpolateMapPixelZoomMultiplier(
  multipliers: readonly number[],
  level: number,
): number {
  if (multipliers.length === 0) return 1
  const idx = clampMapPixelZoomLevel(level) - 1
  const lo = Math.floor(idx)
  const hi = Math.min(multipliers.length - 1, lo + 1)
  if (lo === hi) return multipliers[lo] ?? 1
  const t = idx - lo
  const a = multipliers[lo] ?? 1
  const b = multipliers[hi] ?? 1
  return a + t * (b - a)
}

/** @deprecated 整級步進；請改用 applyWheelToMapPixelZoomLevel */
export function stepMapPixelZoomLevel(level: number, deltaY: number): number {
  const step = deltaY > 0 ? 1 : -1
  return clampMapPixelZoomLevel(Math.round(level) + step)
}
