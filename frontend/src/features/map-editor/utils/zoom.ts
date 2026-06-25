import { WORLD_UNITS_PER_METER } from '../constants/map'
import {
  defaultMapExtentMeters,
  mapWorldSizeFromExtent,
} from '../constants/mapExtent'

/** 縮放段數：1 = 最放大，7 = 最遠 */
export const ZOOM_LEVEL_COUNT = 7

/**
 * 最近縮放（等級 1）時，單屏可視範圍的場域邊長（公尺）：約 60m；寬與高皆須滿足。
 */
export const DEFAULT_MIN_ZOOM_IN_VISIBLE_M = 60

/**
 * 最遠縮放（等級 7）時，單屏至少可涵蓋的場域寬度（公尺）。
 * 與 {@link DEFAULT_MAX_ZOOM_OUT_VISIBLE_HEIGHT_M} 搭配，使約 1km×0.5km 內的範例可一屏看清。
 */
export const DEFAULT_MAX_ZOOM_OUT_VISIBLE_WIDTH_M = 1000

/**
 * 最遠縮放（等級 7）時，單屏至少可涵蓋的場域高度（公尺）。
 */
export const DEFAULT_MAX_ZOOM_OUT_VISIBLE_HEIGHT_M = 500

/** @deprecated 請改用寬／高公尺常數；保留供舊選項相容 */
export const DEFAULT_MAX_ZOOM_OUT_METERS_PER_AXIS = 500

export type ZoomScaleOptions = {
  /**
   * 舊版：單一「每軸」公尺數；若設定則覆寫預設寬高邏輯（與 maxZoomOutVisibleWidthMeters 互斥時以此為準）
   */
  maxZoomOutMetersPerAxis?: number
  /** 最遠縮放時可視寬度下限（公尺），預設 {@link DEFAULT_MAX_ZOOM_OUT_VISIBLE_WIDTH_M} */
  maxZoomOutVisibleWidthMeters?: number
  /** 最遠縮放時可視高度下限（公尺），預設 {@link DEFAULT_MAX_ZOOM_OUT_VISIBLE_HEIGHT_M} */
  maxZoomOutVisibleHeightMeters?: number
  /** 最近縮放時單屏可視之最小邊長（公尺），預設 {@link DEFAULT_MIN_ZOOM_IN_VISIBLE_M} */
  minZoomInVisibleMetersPerAxis?: number
}

/**
 * 依視窗大小產生 7 段 scale（由近到遠線性插值）。
 * - 等級 1：單屏可視約 minZoomIn×minZoomIn 公尺（預設 60×60）
 * - 等級 7：單屏可視至少約預設寬×高公尺（預設 1000×500）
 */
export function computeZoomScales(
  viewportW: number,
  viewportH: number,
  options?: ZoomScaleOptions,
): number[] {
  if (viewportW < 32 || viewportH < 32) {
    return Array.from({ length: ZOOM_LEVEL_COUNT }, () => 1)
  }

  const { worldW, worldH } = mapWorldSizeFromExtent(defaultMapExtentMeters())

  const sFitAll =
    Math.min(viewportW / worldW, viewportH / worldH) * 0.92

  let sFloorMax: number
  if (options?.maxZoomOutMetersPerAxis != null) {
    const maxM = options.maxZoomOutMetersPerAxis
    const maxWorldPerAxis = maxM * WORLD_UNITS_PER_METER
    sFloorMax = Math.max(
      viewportW / maxWorldPerAxis,
      viewportH / maxWorldPerAxis,
    )
  } else {
    const wM =
      options?.maxZoomOutVisibleWidthMeters ??
      DEFAULT_MAX_ZOOM_OUT_VISIBLE_WIDTH_M
    const hM =
      options?.maxZoomOutVisibleHeightMeters ??
      DEFAULT_MAX_ZOOM_OUT_VISIBLE_HEIGHT_M
    const wWorld = wM * WORLD_UNITS_PER_METER
    const hWorld = hM * WORLD_UNITS_PER_METER
    /** 同時滿足「寬至少 wM、高至少 hM」的最遠縮放（scale 下限） */
    sFloorMax = Math.min(viewportW / wWorld, viewportH / hWorld)
  }

  const minInM =
    options?.minZoomInVisibleMetersPerAxis ?? DEFAULT_MIN_ZOOM_IN_VISIBLE_M
  const minInWorld = minInM * WORLD_UNITS_PER_METER
  /** 等級 1 的 scale：單軸可視約 minInM 公尺（勿與 sFitAll 取 max，否則小視窗時「最近」會變成看全圖） */
  const sZoomInMax = Math.min(
    viewportW / minInWorld,
    viewportH / minInWorld,
  )

  const sHi = sZoomInMax
  let sLo = Math.min(sZoomInMax, sFitAll)
  sLo = Math.max(sLo, sFloorMax)
  sLo = Math.min(sLo, sHi)

  const levels: number[] = []
  if (sHi <= 0 || sLo <= 0 || Math.abs(sHi - sLo) < 1e-12) {
    for (let i = 0; i < ZOOM_LEVEL_COUNT; i++) levels.push(sHi)
    return levels
  }

  for (let i = 0; i < ZOOM_LEVEL_COUNT; i++) {
    const t = i / (ZOOM_LEVEL_COUNT - 1)
    levels.push(sHi + t * (sLo - sHi))
  }
  return levels
}
