/**
 * 內部世界座標：1 單位 = 0.1m（10cm），為絕對場域座標之離散表示。
 * 顯示與匯出仍以公尺為準。
 */
export const WORLD_UNITS_PER_METER = 10

/** 拖曳／貼上吸附步長（公尺） */
export const SNAP_METERS = 0.1

/** 圖台輔助線間隔（公尺） */
export const AUX_LINE_SPACING_METERS = 5

/**
 * @deprecated 場域尺寸改由地圖檔 `coordinateSystem.extentMeters` 與 MapExtentContext 提供。
 * 以下常數僅作為未載入地圖時的預設參考。
 */
export {
  DEFAULT_MAP_EXTENT_WIDTH_METERS as MAP_EXTENT_WIDTH_METERS,
  DEFAULT_MAP_EXTENT_HEIGHT_METERS as MAP_EXTENT_HEIGHT_METERS,
} from './mapExtent'

/**
 * 橫／縱倍率 zx、zy：可視寬 ≈ VIEW_BASELINE_WIDTH_M×zx（m）、高 ≈ VIEW_BASELINE_HEIGHT_M×zy（m）。
 * 例：0.1×→100m×50m；1×→1km×0.5km；2×→2km×1km；2.5×→2.5km×1.25km。
 */
export const VIEW_BASELINE_WIDTH_M = 1000
export const VIEW_BASELINE_HEIGHT_M = 500

/** 連續縮放倍率範圍（各軸獨立；數值愈大可視範圍愈大） */
export const MAP_ZOOM_FACTOR_MIN = 0.1
export const MAP_ZOOM_FACTOR_MAX = 2.5

/** 地圖編輯器捲動區四周留白（螢幕 px）；僅擴大可平移範圍，不改 pixelSize／Area layout */
export const MAP_EDITOR_VIEWPORT_PAN_GUTTER_PX = 280

export function clampMapZoomFactor(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(
    MAP_ZOOM_FACTOR_MAX,
    Math.max(MAP_ZOOM_FACTOR_MIN, n),
  )
}

/**
 * 橫向／縱向倍率分別套用（倍率愈大，該軸可視公尺數愈大）。
 * sx≠sy 時場上圖塊長寬比會隨視窗比例改變。
 */
export function viewportScalesFromZoomFactors(
  viewportW: number,
  viewportH: number,
  zoomFactorX: number,
  zoomFactorY: number,
): { sx: number; sy: number } {
  const zx = clampMapZoomFactor(zoomFactorX)
  const zy = clampMapZoomFactor(zoomFactorY)
  const w = Math.max(32, viewportW)
  const h = Math.max(32, viewportH)
  const sx = w / (VIEW_BASELINE_WIDTH_M * zx * WORLD_UNITS_PER_METER)
  const sy = h / (VIEW_BASELINE_HEIGHT_M * zy * WORLD_UNITS_PER_METER)
  return { sx, sy }
}

/**
 * 單一倍率、畫面等比例（sx＝sy）。保留供需要時使用。
 */
export function viewportScalesFromUniformZoomFactor(
  viewportW: number,
  viewportH: number,
  zoomFactor: number,
): { sx: number; sy: number } {
  const z = clampMapZoomFactor(zoomFactor)
  const w = Math.max(32, viewportW)
  const h = Math.max(32, viewportH)
  const spanW = VIEW_BASELINE_WIDTH_M * z * WORLD_UNITS_PER_METER
  const spanH = VIEW_BASELINE_HEIGHT_M * z * WORLD_UNITS_PER_METER
  const s = Math.min(w / spanW, h / spanH)
  return { sx: s, sy: s }
}

/** 世界單位 → 場域公尺（原點左上，x 向右、y 向下） */
export function worldPxToMeters(n: number): number {
  return n / WORLD_UNITS_PER_METER
}

/** 場域公尺 → 世界單位 */
export function metersToWorldPx(m: number): number {
  return m * WORLD_UNITS_PER_METER
}
