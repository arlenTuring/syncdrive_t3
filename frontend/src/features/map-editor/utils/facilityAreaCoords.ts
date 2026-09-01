import type { MapAreaDomain, MapAreaLayout } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  clampSizeMeters,
  defaultCanvasSizePxForType,
  getFacilitySizeMeters,
} from '../constants/facilityDimensions'
import {
  areaLocalPxSizeToMeters,
  areaLocalPxToMeter,
  areaPositionToCssTopLeft,
  cssTopLeftToAreaPosition,
  domainHeightM,
  domainWidthM,
  meterSizeToAreaLocalPx,
  meterToAreaLocalPx,
} from './areaCoords'
import { syncGeofenceVerticesAfterLayoutResize } from './geofence'
import {
  parseRoadLineWidthPx,
  resolveRoadLineAreaHeightPx,
} from './roadLineFacility'
import {
  crossoverPortalsAabb,
  getCrossoverPortals,
} from './trackCrossoverFacility'
import { normalizeDegrees, resolveRotatedRectAabb } from './rotation'

export type AreaLayoutAnchor = { wPx: number; hPx: number }

/** 區域座標（Area 內，左下原點，非地圖像素） */
export type AreaPosition = { x: number; y: number }
/** @deprecated 使用 AreaPosition */
export type AreaPositionPx = AreaPosition
/** 圖台顯示尺寸（絕對畫素） */
export type AreaSize = { w: number; h: number }
/** @deprecated 使用 AreaSize */
export type AreaSizePx = AreaSize
export type FieldPositionM = { x: number; y: number }

function hasStoredAreaPosition(ap: AreaPositionPx | undefined): ap is AreaPositionPx {
  return (
    !!ap &&
    Number.isFinite(ap.x) &&
    Number.isFinite(ap.y)
  )
}

function hasStoredAreaSizePx(asp: AreaSizePx | undefined): asp is AreaSizePx {
  return (
    !!asp &&
    typeof asp.w === 'number' &&
    typeof asp.h === 'number' &&
    Number.isFinite(asp.w) &&
    Number.isFinite(asp.h) &&
    asp.w > 0 &&
    asp.h > 0
  )
}

function hasStoredAreaLayoutAnchor(
  anchor: AreaLayoutAnchor | undefined,
): anchor is AreaLayoutAnchor {
  return (
    !!anchor &&
    typeof anchor.wPx === 'number' &&
    typeof anchor.hPx === 'number' &&
    Number.isFinite(anchor.wPx) &&
    Number.isFinite(anchor.hPx) &&
    anchor.wPx > 0 &&
    anchor.hPx > 0
  )
}

/** 渲染錨點 layout：記錄設施定位時 Area 的寬/長，拉伸外框時不變 */
export function resolveFacilityAreaLayoutAnchor(
  f: FacilityObject,
  layout: MapAreaLayout,
): AreaLayoutAnchor {
  const anchor = f.areaLayoutAnchor
  if (hasStoredAreaLayoutAnchor(anchor)) {
    return { wPx: anchor.wPx, hPx: anchor.hPx }
  }
  return { wPx: layout.wPx, hPx: layout.hPx }
}

/** 取得設施區域座標（Area 內，左下原點）；舊檔無 areaPosition 時由場域座標換算 */
export function resolveFacilityAreaPosition(
  f: FacilityObject,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): AreaPositionPx {
  const ap = f.areaPosition
  if (hasStoredAreaPosition(ap)) {
    return { x: ap.x, y: ap.y }
  }
  return meterToAreaLocalPx(f.position.x, f.position.y, domain, layout)
}

/**
 * 圖台顯示尺寸（絕對畫素，與 Area 外框／場域 domain 無關）。
 * 無 areaSizePx 時用類型預設畫素；圍籬由頂點包絡換算（僅 Geofence）。
 */
export function resolveFacilityAreaSize(
  f: FacilityObject,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
  domainSpan?: { w: number; h: number },
): AreaSizePx {
  const asp = f.areaSizePx
  if (f.type === 'RoadLine') {
    const base = hasStoredAreaSizePx(asp)
      ? { w: asp.w, h: asp.h }
      : defaultCanvasSizePxForType('RoadLine')
    const sw = parseRoadLineWidthPx(f.parameters?.roadLineWidthPx)
    return {
      w: base.w,
      h: resolveRoadLineAreaHeightPx(base.h, sw),
    }
  }
  if (f.type === 'TrackCrossover') {
    const portals = getCrossoverPortals(f)
    if (portals) {
      const aabb = crossoverPortalsAabb(portals)
      return meterSizeToAreaLocalPx(
        Math.max(0.5, aabb.xMaxM - aabb.xMinM),
        Math.max(0.5, aabb.yMaxM - aabb.yMinM),
        domain,
        layout,
      )
    }
  }
  if (hasStoredAreaSizePx(asp)) {
    return { w: asp.w, h: asp.h }
  }
  if (f.type === 'Geofence') {
    const sizeM = getFacilitySizeMeters(f, domainSpan)
    return meterSizeToAreaLocalPx(sizeM.w, sizeM.h, domain, layout)
  }
  return defaultCanvasSizePxForType(f.type)
}

export function resolveFacilityRotationDeg(f: FacilityObject): number {
  return normalizeDegrees(f.rotation ?? 0)
}

function clampCssTopLeftInLayoutUnrotated(
  css: { left: number; top: number },
  areaSize: AreaSizePx,
  layout: MapAreaLayout,
): { left: number; top: number } {
  const maxLeft = Math.max(0, layout.wPx - areaSize.w)
  const maxTop = Math.max(0, layout.hPx - areaSize.h)
  return {
    left: Math.max(0, Math.min(css.left, maxLeft)),
    top: Math.max(0, Math.min(css.top, maxTop)),
  }
}

/** 區域座標限制在 Area 內框內（左下原點；有旋轉時以 AABB 限制） */
export function clampAreaPositionInLayout(
  areaPosition: AreaPositionPx,
  areaSize: AreaSizePx,
  layout: MapAreaLayout,
  rotationDeg = 0,
): AreaPositionPx {
  const rot = normalizeDegrees(rotationDeg)
  if (rot === 0) {
    const maxX = Math.max(0, layout.wPx - areaSize.w)
    const maxY = Math.max(0, layout.hPx - areaSize.h)
    return {
      x: Math.max(0, Math.min(areaPosition.x, maxX)),
      y: Math.max(0, Math.min(areaPosition.y, maxY)),
    }
  }
  const css = areaPositionToCssTopLeft(areaPosition, areaSize, layout.hPx)
  const clampedCss = clampCssTopLeftInLayout(css, areaSize, layout, rot)
  return cssTopLeftToAreaPosition(clampedCss, areaSize, layout.hPx)
}

/** CSS 左上限制在 Area 內框內（有旋轉時以 AABB 限制） */
export function clampCssTopLeftInLayout(
  css: { left: number; top: number },
  areaSize: AreaSizePx,
  layout: MapAreaLayout,
  rotationDeg = 0,
): { left: number; top: number } {
  const rot = normalizeDegrees(rotationDeg)
  if (rot === 0) {
    return clampCssTopLeftInLayoutUnrotated(css, areaSize, layout)
  }
  const aabb = resolveRotatedRectAabb(areaSize.w, areaSize.h, rot)
  const aabbCss = {
    left: css.left + aabb.offsetLeft,
    top: css.top + aabb.offsetTop,
  }
  const clampedAabb = clampCssTopLeftInLayoutUnrotated(
    aabbCss,
    { w: aabb.w, h: aabb.h },
    layout,
  )
  return {
    left: clampedAabb.left - aabb.offsetLeft,
    top: clampedAabb.top - aabb.offsetTop,
  }
}

/** 設施在 Area 內 CSS 矩形（左上原點；含旋轉 AABB） */
export function resolveFacilitySnapRectCss(
  f: FacilityObject,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
  domainSpan?: { w: number; h: number },
): { left: number; top: number; width: number; height: number } {
  const placement = resolveFacilityRenderPlacement(f, domain, layout, domainSpan)
  const rot = resolveFacilityRotationDeg(f)
  if (rot === 0) {
    return {
      left: placement.css.left,
      top: placement.css.top,
      width: placement.areaSize.w,
      height: placement.areaSize.h,
    }
  }
  const aabb = resolveRotatedRectAabb(
    placement.areaSize.w,
    placement.areaSize.h,
    rot,
  )
  return {
    left: placement.css.left + aabb.offsetLeft,
    top: placement.css.top + aabb.offsetTop,
    width: aabb.w,
    height: aabb.h,
  }
}

/** 渲染／命中：依 layout 將區域座標換算為 CSS */
export function resolveFacilityRenderPlacement(
  f: FacilityObject,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
  domainSpan?: { w: number; h: number },
): { css: { left: number; top: number }; areaSize: AreaSizePx } {
  const areaPosition = hasStoredAreaPosition(f.areaPosition)
    ? { x: f.areaPosition.x, y: f.areaPosition.y }
    : resolveFacilityAreaPosition(f, domain, layout)
  const areaSize = hasStoredAreaSizePx(f.areaSizePx)
    ? { w: f.areaSizePx.w, h: f.areaSizePx.h }
    : resolveFacilityAreaSize(f, domain, layout, domainSpan)
  const css = areaPositionToCssTopLeft(
    areaPosition,
    areaSize,
    layout.hPx,
  )
  return {
    css: clampCssTopLeftInLayout(css, areaSize, layout, resolveFacilityRotationDeg(f)),
    areaSize,
  }
}

/** Area 拉伸預覽時補償 outer 位移，使內容在地圖上維持原位 */
export function areaLayoutResizeMapFreezeOffset(
  startLayout: MapAreaLayout,
  liveLayout: MapAreaLayout,
): { left: number; top: number } {
  return {
    left: startLayout.xPx - liveLayout.xPx,
    top: startLayout.yPx - liveLayout.yPx,
  }
}

/**
 * Area 外框拉伸預覽：元件在地圖上視覺不動（補償 outer 位移），不更新 state。
 */
export function resolveFacilityRenderPlacementDuringAreaResize(
  f: FacilityObject,
  domain: MapAreaDomain,
  startLayout: MapAreaLayout,
  liveLayout: MapAreaLayout,
  domainSpan?: { w: number; h: number },
): { css: { left: number; top: number }; areaSize: AreaSizePx } {
  const placement = resolveFacilityRenderPlacement(
    f,
    domain,
    startLayout,
    domainSpan,
  )
  const offset = areaLayoutResizeMapFreezeOffset(startLayout, liveLayout)
  const css = {
    left: placement.css.left + offset.left,
    top: placement.css.top + offset.top,
  }
  return {
    css: clampCssTopLeftInLayout(
      css,
      placement.areaSize,
      liveLayout,
      resolveFacilityRotationDeg(f),
    ),
    areaSize: placement.areaSize,
  }
}

/** 區域座標 → CSS 渲染錨點（元件左上角） */
export function resolveFacilityCssTopLeft(
  f: FacilityObject,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
  domainSpan?: { w: number; h: number },
): { left: number; top: number } {
  const areaPosition = resolveFacilityAreaPosition(f, domain, layout)
  const areaSize = resolveFacilityAreaSize(f, domain, layout, domainSpan)
  return areaPositionToCssTopLeft(areaPosition, areaSize, layout.hPx)
}

/** 區域座標 → 場域座標（依當前 layout/domain 外框映射） */
export function fieldPositionFromArea(
  areaPosition: AreaPositionPx,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): FieldPositionM {
  return areaLocalPxToMeter(areaPosition.x, areaPosition.y, domain, layout)
}

/** 區域尺寸 → 場域尺寸（依當前 layout/domain 外框映射） */
export function fieldSizeFromArea(
  areaSizePx: AreaSizePx,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): { w: number; h: number } {
  const raw = areaLocalPxSizeToMeters(areaSizePx.w, areaSizePx.h, domain, layout)
  return clampSizeMeters(raw, {
    w: domainWidthM(domain),
    h: domainHeightM(domain),
  })
}

/** 補齊並同步雙座標與雙尺寸（首次載入／新建） */
export function ensureFacilityDualCoords(
  f: FacilityObject,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): FacilityObject {
  const domainSpan = { w: domainWidthM(domain), h: domainHeightM(domain) }
  const areaPosition = resolveFacilityAreaPosition(f, domain, layout)
  const areaSizePx = resolveFacilityAreaSize(f, domain, layout, domainSpan)
  const areaLayoutAnchor = resolveFacilityAreaLayoutAnchor(f, layout)
  return {
    ...f,
    areaPosition,
    areaSizePx,
    areaLayoutAnchor,
    position: fieldPositionFromArea(areaPosition, domain, layout),
  }
}

/** 鍵盤方向鍵微調步長（Area 區域座標 px） */
export const FACILITY_AREA_NUDGE_STEP_PX = 0.5

/** 以 Area 區域座標微調設施位置（同步場域座標並限制在 Area 內） */
export function nudgeFacilityInArea(
  f: FacilityObject,
  deltaAreaPx: { x: number; y: number },
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): FacilityObject {
  if (f.type === 'Geofence') return f
  const domainSpan = { w: domainWidthM(domain), h: domainHeightM(domain) }
  const cur = resolveFacilityAreaPosition(f, domain, layout)
  return facilityWithAreaPosition(
    f,
    { x: cur.x + deltaAreaPx.x, y: cur.y + deltaAreaPx.y },
    domain,
    layout,
    domainSpan,
  )
}

/** 更新區域座標並同步場域座標（限制在 Area 內） */
export function facilityWithAreaPosition(
  f: FacilityObject,
  areaPosition: AreaPositionPx,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
  domainSpan?: { w: number; h: number },
): FacilityObject {
  const areaSize = resolveFacilityAreaSize(f, domain, layout, domainSpan)
  const clamped = clampAreaPositionInLayout(
    areaPosition,
    areaSize,
    layout,
    resolveFacilityRotationDeg(f),
  )
  const anchor =
    f.areaLayoutAnchor ?? { wPx: layout.wPx, hPx: layout.hPx }
  return {
    ...f,
    areaPosition: clamped,
    areaLayoutAnchor: anchor,
    position: fieldPositionFromArea(clamped, domain, layout),
  }
}

/** 更新區域尺寸並同步場域尺寸 */
export function facilityWithAreaSize(
  f: FacilityObject,
  areaSizePx: AreaSizePx,
): FacilityObject {
  return {
    ...f,
    areaSizePx,
  }
}

/** domain 變更等：凍結區域 px，重算場域座標／尺寸 */
export function syncAreaFacilitiesFieldCoords(
  facilities: FacilityObject[],
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): FacilityObject[] {
  return facilities.map((f) => syncFacilityFieldCoordsOnly(f, domain, layout))
}

/** 僅平移 Area 外框（寬高不變） */
export function isAreaLayoutPureMove(
  oldLayout: MapAreaLayout,
  newLayout: MapAreaLayout,
): boolean {
  return oldLayout.wPx === newLayout.wPx && oldLayout.hPx === newLayout.hPx
}

/**
 * Area 外框提交後：依拉伸前後 layout 反推區域座標，與預覽時地圖位置一致（不跳動）。
 * 純平移請勿呼叫（元件隨 Area 外框移動即可，區域／場域座標不變）。
 */
export function syncFacilityAreaCoordsAfterLayoutResize(
  f: FacilityObject,
  domain: MapAreaDomain,
  oldLayout: MapAreaLayout,
  newLayout: MapAreaLayout,
): FacilityObject {
  if (f.type === 'Geofence') {
    return syncGeofenceVerticesAfterLayoutResize(f, domain, oldLayout, newLayout)
  }
  const domainSpan = { w: domainWidthM(domain), h: domainHeightM(domain) }
  const { css, areaSize } = resolveFacilityRenderPlacementDuringAreaResize(
    f,
    domain,
    oldLayout,
    newLayout,
    domainSpan,
  )
  const areaPosition = clampAreaPositionInLayout(
    cssTopLeftToAreaPosition(css, areaSize, newLayout.hPx),
    areaSize,
    newLayout,
    resolveFacilityRotationDeg(f),
  )
  return {
    ...f,
    areaPosition,
    areaSizePx: areaSize,
    areaLayoutAnchor: { wPx: newLayout.wPx, hPx: newLayout.hPx },
    position: fieldPositionFromArea(areaPosition, domain, newLayout),
  }
}

export function syncAreaFacilitiesAreaCoordsAfterLayoutResize(
  facilities: FacilityObject[],
  domain: MapAreaDomain,
  oldLayout: MapAreaLayout,
  newLayout: MapAreaLayout,
): FacilityObject[] {
  return facilities.map((f) =>
    syncFacilityAreaCoordsAfterLayoutResize(f, domain, oldLayout, newLayout),
  )
}

/** 將設施區域座標限制在 Area 內框內 */
export function clampAreaFacilitiesInLayout(
  facilities: FacilityObject[],
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): FacilityObject[] {
  const domainSpan = { w: domainWidthM(domain), h: domainHeightM(domain) }
  return facilities.map((f) => {
    if (f.type === 'Geofence' || !hasStoredAreaPosition(f.areaPosition)) {
      return f
    }
    const areaSize = resolveFacilityAreaSize(f, domain, layout, domainSpan)
    const clamped = clampAreaPositionInLayout(
      f.areaPosition,
      areaSize,
      layout,
      resolveFacilityRotationDeg(f),
    )
    if (
      clamped.x === f.areaPosition.x &&
      clamped.y === f.areaPosition.y
    ) {
      return f
    }
    return facilityWithAreaPosition(f, clamped, domain, layout, domainSpan)
  })
}

/** 單一設施：凍結區域 px，重算場域 */
export function syncFacilityFieldCoordsOnly(
  f: FacilityObject,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
): FacilityObject {
  const domainSpan = { w: domainWidthM(domain), h: domainHeightM(domain) }

  // 規則 10/12：拉伸外框時區域 px 絕對凍結，僅重算場域座標
  const areaPosition = hasStoredAreaPosition(f.areaPosition)
    ? { x: f.areaPosition!.x, y: f.areaPosition!.y }
    : meterToAreaLocalPx(f.position.x, f.position.y, domain, layout)

  const areaSizePx = resolveFacilityAreaSize(f, domain, layout, domainSpan)

  const areaLayoutAnchor = hasStoredAreaLayoutAnchor(f.areaLayoutAnchor)
    ? { wPx: f.areaLayoutAnchor.wPx, hPx: f.areaLayoutAnchor.hPx }
    : undefined

  return {
    ...f,
    areaPosition,
    areaSizePx,
    ...(areaLayoutAnchor ? { areaLayoutAnchor } : {}),
    position: fieldPositionFromArea(areaPosition, domain, layout),
  }
}

/** @deprecated 圖台尺寸與場域無關；僅供舊 UI 換算提示，請用 areaSizePx */
export function layoutDisplaySizeMeters(
  f: FacilityObject,
  domain: MapAreaDomain,
  layout: MapAreaLayout,
  domainSpan?: { w: number; h: number },
): { w: number; h: number } {
  const areaSizePx = resolveFacilityAreaSize(f, domain, layout, domainSpan)
  return fieldSizeFromArea(areaSizePx, domain, layout)
}

/** CSS 左上錨點 → 更新區域／場域雙座標 */
export function facilityWithCssTopLeft(
  f: FacilityObject,
  cssTopLeft: { left: number; top: number },
  domain: MapAreaDomain,
  layout: MapAreaLayout,
  domainSpan?: { w: number; h: number },
): FacilityObject {
  const areaSize = resolveFacilityAreaSize(f, domain, layout, domainSpan)
  const areaPosition = cssTopLeftToAreaPosition(
    cssTopLeft,
    areaSize,
    layout.hPx,
  )
  return facilityWithAreaPosition(f, areaPosition, domain, layout, domainSpan)
}

