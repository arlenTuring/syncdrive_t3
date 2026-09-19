import type { FacilityName, FacilityObject, FacilityType } from '../types/facility'
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

/**
 * smart_pole_enable.png 內燈頭＋燈桿大致範圍（相對整張方圖 0–1，不含大片黑邊／透明邊）。
 * 圖台選取框應對齊這塊內容，拉框時圖示才會跟著變大變小。
 */
export const POLE_ASSET_CONTENT = {
  left: 0.33,
  top: 0.05,
  width: 0.34,
  height: 0.58,
} as const

export type PoleVisualLayout = {
  frameW: number
  frameH: number
  iconSide: number
  imgLeft: number
  imgTop: number
}

/**
 * 將智慧桿 PNG 的實質內容撐滿選取框（可非等比拉伸）。
 * 回傳的是 <img> 的絕對定位尺寸與偏移（相對外框左上）。
 */
export function poleIconFillBoxStyle(boxW: number, boxH: number): {
  width: number
  height: number
  left: number
  top: number
} {
  const w = Math.max(1e-6, boxW)
  const h = Math.max(1e-6, boxH)
  const c = POLE_ASSET_CONTENT
  const imgW = w / Math.max(1e-6, c.width)
  const imgH = h / Math.max(1e-6, c.height)
  return {
    width: imgW,
    height: imgH,
    left: -c.left * imgW,
    top: -c.top * imgH,
  }
}

/**
 * 智慧電桿選取框與圖示排版（Area 內 px）。
 * @deprecated 請用 poleIconFillBoxStyle；保留供舊程式參考。
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
 */
const TAPER_RAMP_RUN = 3

/**
 * 交叉軌道的外框：長是高的幾倍。
 *
 * 交會角要淺，車子才過得去——也才看得出是兩條路交叉，不是一個叉叉。三比一是圖上
 * 讀得出來又不至於長到佔滿容器的角度。
 */
const CROSS_ASPECT = 3

/**
 * 帶寬反推交叉軌道的外框。
 */
function crossSizeFor(bandM: number): { w: number; h: number } {
  const cos = Math.cos(Math.atan(0.5 / CROSS_ASPECT))
  const h = (bandM * 2) / cos
  return { w: h * CROSS_ASPECT, h }
}

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
    RailCross: crossSizeFor(TRACK_RAIL_WIDTH_M),
  }
})()

/**
 * 地圖編輯器：拖進 Area 的<strong>唯一預設尺寸參數</strong>。
 *
 * - 設備類：相對 Area 正式佈局 `shortPx`／`longPx` 的比例（＋ clamp）
 * - 軌道類：相對場域 domain span 的帶寬／長度比例
 *
 * 改這裡＝之後所有新拖放、所有 layout 一併套用。勿在呼叫端另寫死像素。
 */
export const AREA_DROP_DEFAULTS = {
  /** 放進 Area 時最多佔容器每一邊的幾成（留空間拖／轉） */
  maxSpanFrac: 1 / 3,
  /** 短邊像素下限（略大於把手寬，過大會把小圖示撐回去） */
  minSidePx: 16,

  signal: { shortFrac: 0.08, minPx: 28, maxPx: 72 },
  /** 智慧桿：短邊 8%（已含「小 4 倍」），外框比例跟 PNG 內容 */
  pole: { shortFrac: 0.08, hMinPx: 22, hMaxPx: 60, wMinPx: 10, wMaxPx: 30 },
  /** 設施：短邊約 12%×9.3%（已含「小 1/3」） */
  facility: {
    wShortFrac: 0.12,
    hShortFrac: 0.14 * (2 / 3),
    wMinPx: 42,
    wMaxPx: 150,
    hMinPx: 32,
    hMaxPx: 115,
  },
  docking: { shortFrac: 0.04875, minPx: 18, maxPx: 42 },
  /** 途經點：短邊 2.75%（已含「小 4 倍」） */
  waypoint: { shortFrac: 0.0275, minPx: 10, maxPx: 20 },
  /** 月台門：長邊 4.125%、短邊 1.5%（長度已再小一倍） */
  psd: {
    longFrac: 0.04125,
    shortFrac: 0.015,
    wMinPx: 24,
    wMaxPx: 90,
    hMinPx: 10,
    hMaxPx: 18,
  },
  slot: {
    longFrac: 0.18,
    shortFrac: 0.055,
    wMinPx: 72,
    wMaxPx: 280,
    hMinPx: 22,
    hMaxPx: 56,
  },
  roadLine: {
    longFrac: 0.28,
    shortFrac: 0.016,
    wMinPx: 100,
    wMaxPx: 420,
    hMinPx: 8,
    hMaxPx: 22,
  },

  /** 軌道帶寬 = min(spanW,spanH) / bandDivisor */
  trackBandDivisor: 14,
  /** 一般軌道長度 = max(span) × lengthSpanFrac；帶寬 = band × bandScale */
  rail: { lengthSpanFrac: 0.046875, bandScale: 0.375 },
  /** 分岔軌道整體縮放（相對帶寬反推外框） */
  railSwitchScale: 0.8,
  taperRampRun: 3,
} as const

function trackDropSizeMeters(
  type: FacilityType,
  name: FacilityName | undefined,
  spanW: number,
  spanH: number,
): { w: number; h: number } | null {
  const d = AREA_DROP_DEFAULTS
  const band = Math.min(spanW, spanH) / d.trackBandDivisor
  if (!(band > 0)) return null
  if (type !== 'Track') return null
  if (name === 'RailCorner') {
    const side = band / (1 - DEFAULT_CORNER_TRACK.innerXRatio)
    return { w: side, h: side }
  }
  if (name === 'RailTaper') {
    const h = band / (DEFAULT_TAPER_TRACK.aTo - DEFAULT_TAPER_TRACK.aFrom)
    const shift = (DEFAULT_TAPER_TRACK.bFrom - DEFAULT_TAPER_TRACK.aFrom) * h
    return { w: shift * d.taperRampRun, h }
  }
  if (name === 'RailCross') return crossSizeFor(band)
  if (name === 'RailSwitch') {
    const h =
      (band / (DEFAULT_SWITCH_TRACK.aTo - DEFAULT_SWITCH_TRACK.aFrom)) *
      d.railSwitchScale
    const gap =
      Math.abs(
        (DEFAULT_SWITCH_TRACK.bFrom + DEFAULT_SWITCH_TRACK.bTo) / 2 -
          (DEFAULT_SWITCH_TRACK.mFrom + DEFAULT_SWITCH_TRACK.mTo) / 2,
      ) * h
    return { w: gap * d.taperRampRun, h }
  }
  return {
    w: Math.max(spanW, spanH) * d.rail.lengthSpanFrac,
    h: band * d.rail.bandScale,
  }
}

/**
 * 設備／設施類：依 Area<strong>正式佈局像素</strong>（落在地圖 pixelSize 內）推算示意尺寸。
 *
 * 參數一律讀 {@link AREA_DROP_DEFAULTS}，不同 layout 用同一套比例。
 */
function equipmentDropSizeAreaPx(
  type: FacilityType,
  layout: MapAreaLayout,
): { w: number; h: number } | null {
  const shortPx = Math.max(1, Math.min(layout.wPx, layout.hPx))
  const longPx = Math.max(1, Math.max(layout.wPx, layout.hPx))
  const clamp = (n: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, n))
  const d = AREA_DROP_DEFAULTS

  switch (type) {
    case 'Signal': {
      const s = clamp(shortPx * d.signal.shortFrac, d.signal.minPx, d.signal.maxPx)
      return { w: s, h: s }
    }
    case 'Pole': {
      const aspect =
        POLE_ASSET_CONTENT.width / Math.max(1e-6, POLE_ASSET_CONTENT.height)
      const h = clamp(shortPx * d.pole.shortFrac, d.pole.hMinPx, d.pole.hMaxPx)
      const w = clamp(h * aspect, d.pole.wMinPx, d.pole.wMaxPx)
      return { w, h }
    }
    case 'Facility': {
      return {
        w: clamp(
          shortPx * d.facility.wShortFrac,
          d.facility.wMinPx,
          d.facility.wMaxPx,
        ),
        h: clamp(
          shortPx * d.facility.hShortFrac,
          d.facility.hMinPx,
          d.facility.hMaxPx,
        ),
      }
    }
    case 'DockingPoint': {
      const s = clamp(
        shortPx * d.docking.shortFrac,
        d.docking.minPx,
        d.docking.maxPx,
      )
      return { w: s, h: s }
    }
    case 'Waypoint': {
      const s = clamp(
        shortPx * d.waypoint.shortFrac,
        d.waypoint.minPx,
        d.waypoint.maxPx,
      )
      return { w: s, h: s }
    }
    case 'PSD': {
      return {
        w: clamp(longPx * d.psd.longFrac, d.psd.wMinPx, d.psd.wMaxPx),
        h: clamp(shortPx * d.psd.shortFrac, d.psd.hMinPx, d.psd.hMaxPx),
      }
    }
    case 'Slot': {
      return {
        w: clamp(longPx * d.slot.longFrac, d.slot.wMinPx, d.slot.wMaxPx),
        h: clamp(shortPx * d.slot.shortFrac, d.slot.hMinPx, d.slot.hMaxPx),
      }
    }
    case 'RoadLine': {
      return {
        w: clamp(
          longPx * d.roadLine.longFrac,
          d.roadLine.wMinPx,
          d.roadLine.wMaxPx,
        ),
        h: clamp(
          shortPx * d.roadLine.shortFrac,
          d.roadLine.hMinPx,
          d.roadLine.hMaxPx,
        ),
      }
    }
    case 'Geofence':
      // 地圖編輯器不再提供電子圍籬拖放；保留分支僅供舊碼路徑防呆
      return null
    default:
      return null
  }
}

function fitDropSizeIntoLayout(
  size: { w: number; h: number },
  layout: MapAreaLayout,
): { w: number; h: number } {
  const maxSpan = AREA_DROP_DEFAULTS.maxSpanFrac
  const minSide = AREA_DROP_DEFAULTS.minSidePx
  const maxW = Math.max(minSide, layout.wPx * maxSpan)
  const maxH = Math.max(minSide, layout.hPx * maxSpan)
  const fit = Math.min(1, maxW / Math.max(1e-6, size.w), maxH / Math.max(1e-6, size.h))
  let w = size.w * fit
  let h = size.h * fit
  // 短邊低於把手可用尺寸時等比放大，避免只撐一邊把瘦高圖示拉胖
  const side = Math.min(w, h)
  if (side > 0 && side < minSide) {
    const grow = minSide / side
    w *= grow
    h *= grow
  }
  // 撐大後仍不得超出容器
  const inside = Math.min(1, layout.wPx / w, layout.hPx / h)
  return { w: w * inside, h: h * inside }
}

/**
 * 一個設施剛放進 Area 時的大小（Area 局部像素）。
 *
 * - 軌道：依場域公尺 span 推帶寬再換成 layout px（接得上、比例對）
 * - 其餘設備：依 Area 正式佈局像素比例（跟當前顯示畫布成比例）
 */
export function defaultAreaSizePxForDrop(
  type: FacilityType,
  name: FacilityName | undefined,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): { w: number; h: number } {
  const spanW = Math.max(1e-6, domainWidthM(domain))
  const spanH = Math.max(1e-6, domainHeightM(domain))

  const trackM = trackDropSizeMeters(type, name, spanW, spanH)
  if (trackM) {
    const px = meterSizeToAreaLocalPx(trackM.w, trackM.h, domain, layout)
    const grow = Math.max(
      1,
      AREA_DROP_DEFAULTS.minSidePx / Math.max(1e-6, Math.min(px.w, px.h)),
    )
    return fitDropSizeIntoLayout({ w: px.w * grow, h: px.h * grow }, layout)
  }

  const byLayout = equipmentDropSizeAreaPx(type, layout)
  if (byLayout) return fitDropSizeIntoLayout(byLayout, layout)

  // 後備：語意公尺 → layout px
  const m = defaultSizeMetersForType(type, name)
  const px = meterSizeToAreaLocalPx(m.w, m.h, domain, layout)
  return fitDropSizeIntoLayout(px, layout)
}

/**
 * 地圖層（Area／底圖／軌道群體）拖放預設尺寸——依正式顯示 pixelSize 比例。
 */
export function defaultMapChromeSizePxForDrop(
  kind: 'area' | 'basemap' | 'trackGen',
  mapPixelSize: { width: number; height: number },
): { w: number; h: number } {
  const W = Math.max(320, mapPixelSize.width)
  const H = Math.max(240, mapPixelSize.height)
  switch (kind) {
    case 'trackGen':
      // 軌道群體：橫向長條，約畫布寬 45%、高 52%（短畫布也保底可操作）
      return {
        w: Math.round(Math.min(W * 0.92, Math.max(520, W * 0.45))),
        h: Math.round(Math.min(H * 0.85, Math.max(180, H * 0.52))),
      }
    case 'basemap':
      return {
        w: Math.round(Math.min(W * 0.7, Math.max(280, W * 0.28))),
        h: Math.round(Math.min(H * 0.7, Math.max(200, H * 0.36))),
      }
    case 'area':
    default:
      return {
        w: Math.round(Math.min(W * 0.7, Math.max(260, W * 0.24))),
        h: Math.round(Math.min(H * 0.7, Math.max(180, H * 0.34))),
      }
  }
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

/** 各類型 refField／語意預設（公尺；非圖台畫素） */
/**
 * 設施預設尺寸。
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
  if (type === 'Track' && name === 'RailCross') {
    return { ...TRACK_VARIANT_SIZE_M.RailCross }
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
      // 示意圖示語意尺寸（公尺）；圖台拖放改走 layout 像素比例
      return { w: 5, h: 5 }
    case 'PSD':
      return { w: 18, h: 3.5 }
    case 'Pole':
      return { ...POLE_DEFAULT_SIZE_M }
    case 'DockingPoint':
    case 'Waypoint':
      return { w: 3.5, h: 3.5 }
    case 'RoadLine':
      return { w: 40, h: 1.2 }
    case 'Facility':
      return { w: 16, h: 12 }
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
 * 設施在場域中的語意寬高（公尺）：場域範圍 → 電子圍籬頂點包絡 → 類型預設。
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
