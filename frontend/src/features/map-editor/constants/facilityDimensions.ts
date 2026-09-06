import type { FacilityName, FacilityType } from '../types/facility'
import type { MapAreaDomain, MapAreaLayout } from '../types/area'
import { domainHeightM, domainWidthM, meterSizeToAreaLocalPx } from '../utils/areaCoords'
import {
  DEFAULT_CORNER_TRACK,
  DEFAULT_TAPER_TRACK,
  DEFAULT_SWITCH_TRACK,
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
/**
 * 三種軌道變體放下去時的預設外框（公尺），由<strong>帶寬</strong>反推。
 *
 * 帶寬要跟一般軌道一樣（TRACK_RAIL_WIDTH_M），不然放下去接不起來，看起來也不成比例
 * ——先前圓角寫死 60×60，帶寬因此是 18 公尺，是一般軌道的五倍多，放進小一點的容器
 * 就整個爆出去。
 *
 * 每一種的帶寬各由自己的幾何比例決定，所以只要把那個比例倒推回去就得到外框：
 *
 * <ul>
 *   <li>圓角：帶寬 = (1 − innerRatio) × 邊長</li>
 *   <li>斜接：帶寬 = (aTo − aFrom) × 高；長度照它自己的坡，換一條軌道的位置走三倍距離</li>
 *   <li>分岔：帶寬同上；長度照兩個出口分開多遠再乘上同一個坡</li>
 * </ul>
 */
const TAPER_RAMP_RUN = 3

export const TRACK_VARIANT_SIZE_M = (() => {
  const cornerSide = TRACK_RAIL_WIDTH_M / (1 - DEFAULT_CORNER_TRACK.innerXRatio)
  const taperH = TRACK_RAIL_WIDTH_M / (DEFAULT_TAPER_TRACK.aTo - DEFAULT_TAPER_TRACK.aFrom)
  const taperShift = (DEFAULT_TAPER_TRACK.bFrom - DEFAULT_TAPER_TRACK.aFrom) * taperH
  const switchH = TRACK_RAIL_WIDTH_M / (DEFAULT_SWITCH_TRACK.aTo - DEFAULT_SWITCH_TRACK.aFrom)
  const outletGap =
    Math.abs(
      (DEFAULT_SWITCH_TRACK.bFrom + DEFAULT_SWITCH_TRACK.bTo) / 2 -
        (DEFAULT_SWITCH_TRACK.mFrom + DEFAULT_SWITCH_TRACK.mTo) / 2,
    ) * switchH
  return {
    RailCorner: { w: cornerSide, h: cornerSide },
    RailTaper: { w: taperShift * TAPER_RAMP_RUN, h: taperH },
    RailSwitch: { w: outletGap * TAPER_RAMP_RUN, h: switchH },
  }
})()

/**
 * 軌道家族放進 Area 時的大小，<strong>由容器決定</strong>。
 *
 * 先前是固定的公尺數，所以同一組元件放進大容器全都變成小點點、放進小容器又頂到邊。
 * 現在先從容器訂出一個<strong>帶寬</strong>，四種軌道全部由它推出來——彼此的比例因此
 * 一定對得上，接起來也不會一粗一細。
 *
 * <ul>
 *   <li>帶寬 = 容器短邊 ÷ 14</li>
 *   <li>一般軌道：長度取容器長邊的四分之一。它是四種裡唯一沒有「自然長度」的——
 *       圓角有半徑、斜接與分岔有坡度，矩形沒有，所以只能照容器給一個好放的長度。
 *       先前寫死 50 公尺，在 85 公尺寬的容器裡就佔掉六成，看起來像一條橫貫線。</li>
 *   <li>圓角、斜接、分岔：由帶寬反推自己的外框（見下面各自的算式），長度照斜接的坡
 *       1:3——與生成器同一個慣例。</li>
 *   <li>虛擬渡線：跨過兩條軌道，所以高是四個帶寬、長是八個。</li>
 * </ul>
 */
const DROP_BAND_DIVISOR = 14
const DROP_RAIL_SPAN = 1 / 4
const TAPER_RAMP_RUN_DROP = 3

function trackDropSizeMeters(
  type: FacilityType,
  name: FacilityName | undefined,
  spanW: number,
  spanH: number,
): { w: number; h: number } | null {
  const band = Math.min(spanW, spanH) / DROP_BAND_DIVISOR
  if (!(band > 0)) return null
  if (type === 'TrackCrossover') return { w: band * 8, h: band * 4 }
  if (type !== 'Track') return null
  if (name === 'RailCorner') {
    const side = band / (1 - DEFAULT_CORNER_TRACK.innerXRatio)
    return { w: side, h: side }
  }
  if (name === 'RailTaper') {
    const h = band / (DEFAULT_TAPER_TRACK.aTo - DEFAULT_TAPER_TRACK.aFrom)
    const shift = (DEFAULT_TAPER_TRACK.bFrom - DEFAULT_TAPER_TRACK.aFrom) * h
    return { w: shift * TAPER_RAMP_RUN_DROP, h }
  }
  if (name === 'RailSwitch') {
    const h = band / (DEFAULT_SWITCH_TRACK.aTo - DEFAULT_SWITCH_TRACK.aFrom)
    const gap =
      Math.abs(
        (DEFAULT_SWITCH_TRACK.bFrom + DEFAULT_SWITCH_TRACK.bTo) / 2 -
          (DEFAULT_SWITCH_TRACK.mFrom + DEFAULT_SWITCH_TRACK.mTo) / 2,
      ) * h
    return { w: gap * TAPER_RAMP_RUN_DROP, h }
  }
  return { w: Math.max(spanW, spanH) * DROP_RAIL_SPAN, h: band }
}

/**
 * 放進 Area 時最多佔容器每一邊的幾成。
 *
 * 放下去之後還要挪位置、拉把手，佔滿整個容器就什麼都做不了；留三分之二的空間才轉得動。
 */
const DROP_MAX_SPAN = 1 / 3
/**
 * 放下去之後短邊至少幾個像素。
 *
 * 四個角的把手各約 14 像素；短邊要放得下兩個把手還分得開，才抓得住上下（或左右）不同的
 * 那一個。抓不住就談不上縮放與旋轉。
 *
 * 這一條與上面那一條會打架：細長的元件（一般軌道 14:1）為了把短邊撐到這個高度，長邊會
 * 跟著超過三分之一。那時以「抓得住」為準，最後再一起夾進容器裡。
 */
const DROP_MIN_SIDE_PX = 24

/**
 * 一個設施剛放進 Area 時的大小（Area 局部像素）。
 *
 * 先前直接把預設公尺數換成<strong>世界</strong>像素，跟容器自己的比例尺無關——所以同一個
 * 元件放進大容器剛好、放進小容器就整個爆出去（實測圓角遠遠超出容器）。
 *
 * 現在照容器換算：等比縮到每一邊都不超過容器的三分之一，再確保短邊抓得住。只會縮不會放，
 * 元件本來的長寬比也不變。
 */
export function defaultAreaSizePxForDrop(
  type: FacilityType,
  name: FacilityName | undefined,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): { w: number; h: number } {
  const spanW = Math.max(1e-6, domainWidthM(domain))
  const spanH = Math.max(1e-6, domainHeightM(domain))
  // 軌道家族的大小由容器決定；其餘設施仍用自己的預設公尺數
  const m = trackDropSizeMeters(type, name, spanW, spanH) ?? defaultSizeMetersForType(type, name)
  const fit = Math.min(1, (spanW * DROP_MAX_SPAN) / m.w, (spanH * DROP_MAX_SPAN) / m.h)
  const px = meterSizeToAreaLocalPx(m.w * fit, m.h * fit, domain, layout)
  const grow = Math.max(1, DROP_MIN_SIDE_PX / Math.max(1e-6, Math.min(px.w, px.h)))
  // 撐大之後仍然不准超出容器——「不能比容器大」是硬規則，其餘都是取捨
  const inside = Math.min(1, layout.wPx / (px.w * grow), layout.hPx / (px.h * grow))
  return { w: px.w * grow * inside, h: px.h * grow * inside }
}

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
    return { ...TRACK_VARIANT_SIZE_M.RailCorner }
  }
  if (type === 'Track' && name === 'RailTaper') {
    return { ...TRACK_VARIANT_SIZE_M.RailTaper }
  }
  if (type === 'Track' && name === 'RailSwitch') {
    return { ...TRACK_VARIANT_SIZE_M.RailSwitch }
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
