function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * 刻度帶尺寸（Area 內容框外的局部 px）。
 * 上帶在 top∈[-bandTop, 0)、左帶在 left∈[-bandLeft, 0)，不佔正式顯示範圍。
 */
export function getAreaRulerBandPx(mapScale = 1): {
  bandTop: number
  bandLeft: number
} {
  const uiScale = clamp(1 / Math.max(0.15, mapScale), 1, 2.75)
  return {
    bandTop: Math.round(24 * uiScale),
    bandLeft: Math.round(48 * uiScale),
  }
}

/**
 * 點擊是否落在框外 X/Y 刻度帶（含左上角）。
 * localX/localY 為相對 Area 內容框左上的 CSS 座標（可為負）。
 */
export function isInAreaRulerBand(
  localX: number,
  localY: number,
  contentHPx: number,
  mapScale = 1,
): boolean {
  const { bandTop, bandLeft } = getAreaRulerBandPx(mapScale)
  const inTop =
    localY >= -bandTop &&
    localY < 0 &&
    localX >= -bandLeft &&
    localX <= Number.POSITIVE_INFINITY
  const inLeft =
    localX >= -bandLeft &&
    localX < 0 &&
    localY >= -bandTop &&
    localY <= contentHPx
  return inTop || inLeft
}
