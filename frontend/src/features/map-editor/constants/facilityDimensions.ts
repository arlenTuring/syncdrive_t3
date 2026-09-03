import type { FacilityName, FacilityType } from '../types/facility'
import {
  DEFAULT_CORNER_TRACK_SIZE_M,
  DEFAULT_TAPER_TRACK_SIZE_M,
  DEFAULT_SWITCH_TRACK_SIZE_M,
} from '../utils/trackShapes'
import {
  getRefFieldBounds,
  refFieldBoundsSpanMeters,
} from '../utils/facilityRefFieldBounds'
import {
  GEOFENCE_DEFAULT_SIZE_METERS,
  getGeofenceParams,
  sizeMetersFromVertices,
} from '../utils/geofence'
import {
  DEFAULT_MAP_EXTENT_HEIGHT_METERS,
  DEFAULT_MAP_EXTENT_WIDTH_METERS,
} from './mapExtent'
import { metersToWorldPx } from './map'

/** 圖台顯示寬高下限（畫素；與 Area 外框、場域 domain 無關） */
export const MIN_FACILITY_CANVAS_PX = 1

/** 可編輯寬／高之下限（公尺） */
export const MIN_FACILITY_SIZE_M = 0.1

/** 軌道窄邊預設寬度（公尺） */
export const TRACK_RAIL_WIDTH_M = 3.5

/** 智慧電桿圖台預設尺寸（公尺）：寬為舊預設 2 倍、高為 3 倍 */
export const POLE_DEFAULT_SIZE_M = { w: 3, h: 10.5 } as const

/** smart_pole_enable.png 內燈頭＋燈桿大致範圍（方圖內比例，不含透明邊） */
const POLE_ASSET_CONTENT = {
  left: 0.31,
  top: 0.08,
  width: 0.38,
  height: 0.52,
} as const

export type PoleVisualLayout = {
  frameW: number
  frameH: number
  iconSide: number
  imgLeft: number
  imgTop: number
}

/**
 * 智慧電桿選取框與圖示排版（Area 內 px）。
 * @deprecated 圖台改為 object-contain 撐滿 areaSizePx；保留供舊程式參考。
 */
export function resolvePoleVisualLayout(
  areaW: number,
  areaH: number,
): PoleVisualLayout {
  const base = Math.min(areaW, areaH * 0.52)
  const iconSide = Math.max(14, base * 0.82)
  const frameW = Math.max(8, iconSide * POLE_ASSET_CONTENT.width)
  const frameH = Math.max(14, iconSide * POLE_ASSET_CONTENT.height)
  const imgLeft = -iconSide * POLE_ASSET_CONTENT.left
  const imgTop = -iconSide * POLE_ASSET_CONTENT.top
  return { frameW, frameH, iconSide, imgLeft, imgTop }
}

/** @deprecated 使用 resolvePoleVisualLayout */
export function resolvePoleFrameSizePx(
  areaW: number,
  areaH: number,
): { w: number; h: number } {
  const v = resolvePoleVisualLayout(areaW, areaH)
  return { w: v.frameW, h: v.frameH }
}

/**
 * 圖台預設顯示尺寸（絕對畫素）。
 * 與 Area 外框、場域 domain 無關；僅決定元件在圖台上的視覺大小。
 */
export function defaultCanvasSizePxForType(
  type: FacilityType,
  name?: FacilityName,
): {
  w: number
  h: number
} {
  const m = defaultSizeMetersForType(type, name)
  return {
    w: Math.max(MIN_FACILITY_CANVAS_PX, metersToWorldPx(m.w)),
    h: Math.max(MIN_FACILITY_CANVAS_PX, metersToWorldPx(m.h)),
  }
}

/** 各類型參照場域／語意預設（公尺；非圖台畫素） */
/**
 * 設施預設尺寸。
 *
 * name 是選填的：多數設施只看 type 就夠，但軌道有幾種變體，形狀不同、
 * 合理的初始尺寸也不同——圓角軌道是接近正方的 L 形，用一般軌道那種
 * 50×3.5 的細長比例放下去會被壓成一條線。
 */
export function defaultSizeMetersForType(
  type: FacilityType,
  name?: FacilityName,
): {
  w: number
  h: number
} {
  if (type === 'Track' && name === 'RailCorner') {
    return { ...DEFAULT_CORNER_TRACK_SIZE_M }
  }
  if (type === 'Track' && name === 'RailTaper') {
    return { ...DEFAULT_TAPER_TRACK_SIZE_M }
  }
  if (type === 'Track' && name === 'RailSwitch') {
    return { ...DEFAULT_SWITCH_TRACK_SIZE_M }
  }
  switch (type) {
    case 'Slot':
      return { w: 20, h: 5 }
    case 'Track':
      return { w: 50, h: TRACK_RAIL_WIDTH_M }
    case 'Signal':
      return { w: 16, h: 16 }
    case 'PSD':
      return { w: 40, h: 4 }
    case 'Pole':
      return { ...POLE_DEFAULT_SIZE_M }
    case 'DockingPoint':
    case 'Waypoint':
      return { w: 4, h: 4 }
    case 'RoadLine':
      return { w: 40, h: 1.2 }
    case 'TrackCrossover':
      // 預設約覆蓋一節平行股交叉區（寬沿軌道、高跨 U/D 間距）
      return { w: 28, h: 14 }
    case 'Facility':
      return { w: 24, h: 18 }
    case 'Geofence':
      return { ...GEOFENCE_DEFAULT_SIZE_METERS }
    case 'Basemap':
      return { w: 80, h: 60 }
    default:
      return { w: 12, h: 5 }
  }
}

export function clampSizeMeters(
  m: { w: number; h: number },
  maxMeters?: { w: number; h: number },
): {
  w: number
  h: number
} {
  const maxW = maxMeters?.w ?? DEFAULT_MAP_EXTENT_WIDTH_METERS
  const maxH = maxMeters?.h ?? DEFAULT_MAP_EXTENT_HEIGHT_METERS
  const w = Math.min(
    maxW,
    Math.max(MIN_FACILITY_SIZE_M, Number.isFinite(m.w) ? m.w : MIN_FACILITY_SIZE_M),
  )
  const h = Math.min(
    maxH,
    Math.max(MIN_FACILITY_SIZE_M, Number.isFinite(m.h) ? m.h : MIN_FACILITY_SIZE_M),
  )
  return { w, h }
}

/**
 * 設施在場域中的語意寬高（公尺）：參照場域範圍 → 電子圍籬頂點包絡 → 類型預設。
 * 圖台顯示尺寸請用 areaSizePx，勿與此混用。
 */
export function getFacilitySizeMeters(
  f: FacilityObject,
  maxMeters?: { w: number; h: number },
): { w: number; h: number } {
  if (f.type === 'Geofence') {
    const { verticesMeters } = getGeofenceParams(f)
    if (verticesMeters.length >= 3) {
      return clampSizeMeters(sizeMetersFromVertices(verticesMeters), maxMeters)
    }
  }
  const refSpan = refFieldBoundsSpanMeters(getRefFieldBounds(f.parameters))
  if (refSpan) {
    return clampSizeMeters(refSpan, maxMeters)
  }
  return clampSizeMeters(defaultSizeMetersForType(f.type, f.name), maxMeters)
}

/**
 * 圖台上各類設施卡片之世界座標尺寸（寬×高，單位＝內部世界單位，10＝1m）。
 */
export function facilityNodeWorldSize(f: FacilityObject): { w: number; h: number } {
  const { w, h } = getFacilitySizeMeters(f)
  return { w: metersToWorldPx(w), h: metersToWorldPx(h) }
}

/** 新增／置中元件時預設用整備格尺寸（與 Slot 一致） */
export function defaultPlacementNodeWorldSize(): { w: number; h: number } {
  return { w: metersToWorldPx(20), h: metersToWorldPx(5) }
}

/** 預設場域對應之世界座標上限（未載入地圖時） */
export const MAX_NODE_WORLD_W = metersToWorldPx(DEFAULT_MAP_EXTENT_WIDTH_METERS)
export const MAX_NODE_WORLD_H = metersToWorldPx(DEFAULT_MAP_EXTENT_HEIGHT_METERS)
