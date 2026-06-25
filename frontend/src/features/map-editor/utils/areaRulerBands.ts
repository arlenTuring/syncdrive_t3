function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** 與 AreaRulerOverlay 一致的刻度帶尺寸（Area 內局部 px） */
export function getAreaRulerBandPx(mapScale = 1): {
  bandTop: number
  bandLeft: number
} {
  const uiScale = clamp(1 / Math.max(0.15, mapScale), 1, 2.75)
  return {
    bandTop: Math.round(24 * uiScale),
    bandLeft: Math.round(44 * uiScale),
  }
}

/** 點擊是否落在 X/Y 刻度帶（含左上角） */
export function isInAreaRulerBand(
  localX: number,
  localY: number,
  mapScale = 1,
): boolean {
  const { bandTop, bandLeft } = getAreaRulerBandPx(mapScale)
  if (localX <= bandLeft && localY <= bandTop) return true
  if (localY <= bandTop && localX > bandLeft) return true
  if (localX <= bandLeft && localY > bandTop) return true
  return false
}
