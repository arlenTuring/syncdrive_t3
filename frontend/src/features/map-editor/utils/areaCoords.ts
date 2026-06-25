import type {
  MapAreaDomain,
  MapAreaLayout,
  MapAreaObject,
  MapAreaView,
} from '../types/area'
import { defaultMapAreaView } from '../types/area'
import type { FacilityObject } from '../types/facility'

export function domainWidthM(domain: MapAreaDomain): number {
  return Math.max(0.001, domain.xMaxM - domain.xMinM)
}

export function domainHeightM(domain: MapAreaDomain): number {
  return Math.max(0.001, domain.yMaxM - domain.yMinM)
}

export function normalizeAreaView(view?: Partial<MapAreaView>): MapAreaView {
  const base = defaultMapAreaView()
  if (!view) return base
  return {
    panXM: typeof view.panXM === 'number' ? view.panXM : base.panXM,
    panYM: typeof view.panYM === 'number' ? view.panYM : base.panYM,
    zoom: typeof view.zoom === 'number' ? view.zoom : base.zoom,
  }
}

export type MapAreaPatch = Partial<Omit<MapAreaObject, 'view'>> & {
  view?: Partial<MapAreaView>
}

/**
 * Area 區域座標 ↔ 場域座標（左下原點）：
 * - 原點 (0,0) 在 Area 內框左下角，x 向右、y 向上
 * - (0,0) → (xMinM, yMinM)，(wPx, hPx) → (xMaxM, yMaxM)
 * - fieldX = xMinM + areaX × (domainW / wPx)
 * - fieldY = yMinM + areaY × (domainH / hPx)
 */
export function areaPxPerMeter(
  layout: MapAreaLayout,
  domain: MapAreaDomain,
): { pxPerMeterX: number; pxPerMeterY: number } {
  return {
    pxPerMeterX: layout.wPx / domainWidthM(domain),
    pxPerMeterY: layout.hPx / domainHeightM(domain),
  }
}

/** @deprecated 與 areaPxPerMeter 相同 */
export function contentPxPerMeterFromLayout(
  layout: MapAreaLayout,
  domain: MapAreaDomain,
): { pxPerMeterX: number; pxPerMeterY: number } {
  return areaPxPerMeter(layout, domain)
}

/** @deprecated 與 areaPxPerMeter 相同；不再凍結比例 */
export function areaContentPxPerMeter(
  _view: MapAreaView | undefined,
  layout: MapAreaLayout,
  domain: MapAreaDomain,
): { pxPerMeterX: number; pxPerMeterY: number } {
  return areaPxPerMeter(layout, domain)
}

/** 載入時正規化 view（不再凍結 px/m） */
export function ensureAreaContentScale(area: MapAreaObject): MapAreaObject {
  return {
    ...area,
    view: normalizeAreaView(area.view),
  }
}

/** 場域公尺 → 區域座標（Area 內，左下原點，y 向上） */
export function meterToAreaLocalPx(
  xM: number,
  yM: number,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
  _view?: MapAreaView,
): { x: number; y: number } {
  const { pxPerMeterX, pxPerMeterY } = areaPxPerMeter(layout, domain)
  return {
    x: (xM - domain.xMinM) * pxPerMeterX,
    y: (yM - domain.yMinM) * pxPerMeterY,
  }
}

/** 場域公尺尺寸 → 區域座標像素尺寸 */
export function meterSizeToAreaLocalPx(
  wM: number,
  hM: number,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): { w: number; h: number } {
  const { pxPerMeterX, pxPerMeterY } = areaPxPerMeter(layout, domain)
  return { w: wM * pxPerMeterX, h: hM * pxPerMeterY }
}

/** 區域座標像素尺寸 → 場域公尺尺寸 */
export function areaLocalPxSizeToMeters(
  wPx: number,
  hPx: number,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): { w: number; h: number } {
  const { pxPerMeterX, pxPerMeterY } = areaPxPerMeter(layout, domain)
  return { w: wPx / pxPerMeterX, h: hPx / pxPerMeterY }
}

/** 區域座標 → 場域公尺（左下原點，y 向上） */
export function areaLocalPxToMeter(
  xPx: number,
  yPx: number,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
  _view?: MapAreaView,
): { x: number; y: number } {
  const { pxPerMeterX, pxPerMeterY } = areaPxPerMeter(layout, domain)
  return {
    x: domain.xMinM + xPx / pxPerMeterX,
    y: domain.yMinM + yPx / pxPerMeterY,
  }
}

/**
 * 區域座標 → Area 內渲染位置（元件左上角）。
 * 區域座標原點在 Area 內框左下；areaY 為距下緣距離，需依當前 hPx 換算 CSS top（規則 10）。
 */
export function areaPositionToCssTopLeft(
  areaPosition: { x: number; y: number },
  areaSize: { w: number; h: number },
  layoutHPx: number,
): { left: number; top: number } {
  return {
    left: areaPosition.x,
    top: layoutHPx - areaPosition.y - areaSize.h,
  }
}

/** Area 內 CSS 左上 → 區域座標（左下原點） */
export function cssTopLeftToAreaPosition(
  css: { left: number; top: number },
  areaSize: { w: number; h: number },
  layoutHPx: number,
): { x: number; y: number } {
  return {
    x: css.left,
    y: layoutHPx - css.top - areaSize.h,
  }
}

/** 指標在 Area 內的 CSS 局部座標 → 區域座標 */
export function cssLocalToAreaPosition(
  cssLocal: { x: number; y: number },
  areaSize: { w: number; h: number },
  layoutHPx: number,
): { x: number; y: number } {
  return cssTopLeftToAreaPosition(
    { left: cssLocal.x, top: cssLocal.y },
    areaSize,
    layoutHPx,
  )
}

/** @deprecated 不再使用 contentOffset */
export function areaContentOffsetPx(_view?: MapAreaView): { x: number; y: number } {
  return { x: 0, y: 0 }
}

/** @deprecated 區域座標獨立儲存，拉伸外框時不需 offset */
export function layoutResizeViewPatch(
  _startLayout: MapAreaLayout,
  _startContentOffset: { x: number; y: number },
  _newLayout: MapAreaLayout,
): Partial<MapAreaView> {
  return {}
}

/** @deprecated */
export function layoutChangeContentOffsetPatch(
  _oldLayout: MapAreaLayout,
  _view: MapAreaView,
  _newLayout: MapAreaLayout,
): Partial<MapAreaView> | null {
  return null
}

/** 確保 domain 最小值小於最大值，且跨度有效 */
export function normalizeAreaDomain(domain: MapAreaDomain): MapAreaDomain {
  let { xMinM, xMaxM, yMinM, yMaxM } = domain
  if (xMinM > xMaxM) [xMinM, xMaxM] = [xMaxM, xMinM]
  if (yMinM > yMaxM) [yMinM, yMaxM] = [yMaxM, yMinM]
  const minSpan = 0.001
  if (xMaxM - xMinM < minSpan) xMaxM = xMinM + minSpan
  if (yMaxM - yMinM < minSpan) yMaxM = yMinM + minSpan
  return { xMinM, xMaxM, yMinM, yMaxM }
}

/** 螢幕座標 → Area 內局部 CSS 座標（左上原點，僅供指標換算） */
export function clientToAreaLocalPx(
  clientX: number,
  clientY: number,
  areaInnerEl: HTMLElement,
  mapScale = 1,
): { x: number; y: number } {
  const r = areaInnerEl.getBoundingClientRect()
  const s = mapScale > 0 ? mapScale : 1
  return { x: (clientX - r.left) / s, y: (clientY - r.top) / s }
}

/** 指標在 Area 內的位置 → 設施左上角公尺 */
export function facilityMeterFromAreaPointer(
  clientX: number,
  clientY: number,
  areaInnerEl: HTMLElement,
  mapScale: number,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): { x: number; y: number } {
  const local = clientToAreaLocalPx(clientX, clientY, areaInnerEl, mapScale)
  return areaLocalPxToMeter(local.x, local.y, domain, layout)
}

/** 拖曳不 clamp 至 domain */
export function clampFacilityMeterPosition(
  xM: number,
  yM: number,
  _sizeM?: { w: number; h: number },
  _domain?: MapAreaDomain,
): { x: number; y: number } {
  return { x: xM, y: yM }
}

export function clampFacilityPositionInAreaDomain(
  facility: FacilityObject,
  _domain: MapAreaDomain,
): FacilityObject {
  return facility
}

export function clampFacilityToAreaDomain(
  facility: FacilityObject,
  _domain: MapAreaDomain,
): FacilityObject {
  return facility
}

export function clampFacilitiesToAreaDomain(
  facilities: FacilityObject[],
  _domain: MapAreaDomain,
): FacilityObject[] {
  return facilities
}

export function clampFacilityPositionsToAreaDomain(
  facilities: FacilityObject[],
  _domain: MapAreaDomain,
): FacilityObject[] {
  return facilities
}

/** @deprecated 內部視角已固定 */
export function zoomAreaViewAtAnchor(
  view: MapAreaView,
  _nextZoom: number,
  _anchorLocalPx: { x: number; y: number } | undefined,
  _layout: MapAreaLayout,
  _domain: MapAreaDomain,
): MapAreaView {
  return normalizeAreaView(view)
}

/** 車輛 MQTT 座標是否落在 Area domain 對應的物理範圍內 */
export function isMeterInDomain(
  xM: number,
  yM: number,
  domain: MapAreaDomain,
): boolean {
  return (
    xM >= domain.xMinM &&
    xM <= domain.xMaxM &&
    yM >= domain.yMinM &&
    yM <= domain.yMaxM
  )
}

/** 拖放／指標換算後的公尺點（不 clamp 至 domain） */
export function clampMeterPointToDomain(
  point: { x: number; y: number },
  _domain: MapAreaDomain,
): { x: number; y: number } {
  return point
}
