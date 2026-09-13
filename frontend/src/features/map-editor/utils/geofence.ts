import { metersToWorldPx, worldPxToMeters } from '../constants/map'
import type { MapAreaDomain, MapAreaLayout, MapAreaView } from '../types/area'
import { areaLocalPxToMeter, meterToAreaLocalPx } from './areaCoords'
import type { FacilityObject, GeofenceFacility } from '../types/facility'

export type GeofenceVertexMeters = { x: number; y: number }

/** 自工具列放上台時的預設矩形外框（公尺） */
export const GEOFENCE_DEFAULT_SIZE_METERS = { w: 36, h: 15 } as const

export type GeofenceStrokeStyle = 'solid' | 'dashed' | 'dotted'

export type GeofenceTextLabel = {
  id: string
  text: string
  /** 場域絕對公尺座標（標籤錨點，左上對齊） */
  x: number
  y: number
  rotationDeg: number
  fontSizePx: number
  fontWeight: 'normal' | 'bold'
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'center' | 'bottom'
  textWrap?: 'single' | 'wrap'
  labelBoxWidthPx?: number
  labelBoxHeightPx?: number
}

export type GeofenceParameters = {
  verticesMeters?: GeofenceVertexMeters[]
  strokeStyle?: GeofenceStrokeStyle
  strokeWidthPx?: number
  strokeColor?: string
  fillEnabled?: boolean
  fillColor?: string
  /** 填色透明度 0～1；未指定時由 fillColor 的 rgba alpha 或預設 0.12 推算 */
  fillOpacity?: number
  labels?: GeofenceTextLabel[]
}

export const DEFAULT_GEOFENCE_STROKE_COLOR = '#22d3ee'
export const DEFAULT_GEOFENCE_FILL_COLOR = 'rgba(34,211,238,0.12)'
export const DEFAULT_GEOFENCE_FILL_BASE_COLOR = '#22d3ee'
export const DEFAULT_GEOFENCE_FILL_OPACITY = 0.12
export const DEFAULT_GEOFENCE_STROKE_WIDTH_PX = 3

export function clampGeofenceFillOpacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GEOFENCE_FILL_OPACITY
  return Math.max(0, Math.min(1, value))
}

function parseHexColor(color: string): { r: number; g: number; b: number } | null {
  const m = color.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function parseRgbaColor(
  color: string,
): { r: number; g: number; b: number; a: number } | null {
  const m = color
    .trim()
    .match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
  if (!m) return null
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] !== undefined ? Number(m[4]) : 1,
  }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** 供色票選擇器使用的底色（#rrggbb） */
export function resolveGeofenceFillBaseColor(fillColor?: string): string {
  if (!fillColor) return DEFAULT_GEOFENCE_FILL_BASE_COLOR
  const rgba = parseRgbaColor(fillColor)
  if (rgba) return rgbToHex(rgba.r, rgba.g, rgba.b)
  const hex = parseHexColor(fillColor)
  if (hex) return rgbToHex(hex.r, hex.g, hex.b)
  return DEFAULT_GEOFENCE_FILL_BASE_COLOR
}

export function resolveGeofenceFillOpacity(
  fillColor?: string,
  fillOpacity?: number,
): number {
  if (typeof fillOpacity === 'number' && Number.isFinite(fillOpacity)) {
    return clampGeofenceFillOpacity(fillOpacity)
  }
  const rgba = fillColor ? parseRgbaColor(fillColor) : null
  if (rgba) return clampGeofenceFillOpacity(rgba.a)
  return DEFAULT_GEOFENCE_FILL_OPACITY
}

export function composeGeofenceFillColor(baseColor: string, opacity: number): string {
  const rgba = parseRgbaColor(baseColor)
  const hex = parseHexColor(baseColor)
  const rgb = rgba ?? hex
  if (!rgb) {
    return `rgba(34,211,238,${clampGeofenceFillOpacity(opacity)})`
  }
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${clampGeofenceFillOpacity(opacity)})`
}

/** 圖台 SVG 填色（含透明度） */
export function resolveGeofenceFillColor(
  params: Pick<GeofenceParameters, 'fillColor' | 'fillOpacity'>,
): string {
  return composeGeofenceFillColor(
    resolveGeofenceFillBaseColor(params.fillColor),
    resolveGeofenceFillOpacity(params.fillColor, params.fillOpacity),
  )
}

export function isGeofenceFacility(f: FacilityObject): f is GeofenceFacility {
  return f.type === 'Geofence'
}

export function parseGeofenceParameters(
  raw: Record<string, unknown> | undefined,
): GeofenceParameters {
  if (!raw) return {}
  const p = raw as GeofenceParameters
  const verticesMeters = parseVerticesMeters(p.verticesMeters)
  const labels = parseGeofenceLabels(p.labels)
  const strokeStyle =
    p.strokeStyle === 'solid' ||
    p.strokeStyle === 'dashed' ||
    p.strokeStyle === 'dotted'
      ? p.strokeStyle
      : undefined
  return {
    ...(verticesMeters.length >= 3 ? { verticesMeters } : {}),
    ...(strokeStyle ? { strokeStyle } : {}),
    ...(typeof p.strokeWidthPx === 'number' ? { strokeWidthPx: p.strokeWidthPx } : {}),
    ...(typeof p.strokeColor === 'string' ? { strokeColor: p.strokeColor } : {}),
    ...(typeof p.fillEnabled === 'boolean' ? { fillEnabled: p.fillEnabled } : {}),
    ...(typeof p.fillColor === 'string' ? { fillColor: p.fillColor } : {}),
    ...(typeof p.fillOpacity === 'number' && Number.isFinite(p.fillOpacity)
      ? { fillOpacity: clampGeofenceFillOpacity(p.fillOpacity) }
      : {}),
    ...(labels.length > 0 ? { labels } : {}),
  }
}

export function parseVerticesMeters(raw: unknown): GeofenceVertexMeters[] {
  if (!Array.isArray(raw)) return []
  const out: GeofenceVertexMeters[] = []
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const o = v as { x?: unknown; y?: unknown }
    if (typeof o.x !== 'number' || typeof o.y !== 'number') continue
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) continue
    out.push({ x: o.x, y: o.y })
  }
  return out
}

export function parseGeofenceLabels(raw: unknown): GeofenceTextLabel[] {
  if (!Array.isArray(raw)) return []
  const out: GeofenceTextLabel[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.text !== 'string') continue
    const x =
      typeof o.x === 'number'
        ? o.x
        : typeof o.xM === 'number'
          ? o.xM
          : null
    const y =
      typeof o.y === 'number'
        ? o.y
        : typeof o.yM === 'number'
          ? o.yM
          : null
    if (x === null || y === null) continue
    out.push({
      id: o.id,
      text: o.text,
      x,
      y,
      rotationDeg: typeof o.rotationDeg === 'number' ? o.rotationDeg : 0,
      fontSizePx:
        typeof o.fontSizePx === 'number' && o.fontSizePx > 0 ? o.fontSizePx : 16,
      fontWeight: o.fontWeight === 'bold' ? 'bold' : 'normal',
      textAlign:
        o.textAlign === 'left' || o.textAlign === 'center' || o.textAlign === 'right'
          ? o.textAlign
          : undefined,
      verticalAlign:
        o.verticalAlign === 'top' ||
        o.verticalAlign === 'center' ||
        o.verticalAlign === 'bottom'
          ? o.verticalAlign
          : undefined,
      textWrap: o.textWrap === 'wrap' || o.textWrap === 'single' ? o.textWrap : undefined,
      labelBoxWidthPx:
        typeof o.labelBoxWidthPx === 'number' && Number.isFinite(o.labelBoxWidthPx)
          ? o.labelBoxWidthPx
          : undefined,
      labelBoxHeightPx:
        typeof o.labelBoxHeightPx === 'number' && Number.isFinite(o.labelBoxHeightPx)
          ? o.labelBoxHeightPx
          : undefined,
    })
  }
  return out
}

export function getGeofenceParams(f: FacilityObject): Required<
  Pick<
    GeofenceParameters,
    | 'strokeStyle'
    | 'strokeWidthPx'
    | 'strokeColor'
    | 'fillEnabled'
    | 'fillColor'
    | 'fillOpacity'
  >
> & {
  verticesMeters: GeofenceVertexMeters[]
  labels: GeofenceTextLabel[]
  fillBaseColor: string
  resolvedFillColor: string
} {
  const p = f.type === 'Geofence' ? parseGeofenceParameters(f.parameters) : {}
  let verticesMeters = p.verticesMeters ?? []
  if (verticesMeters.length < 3 && f.type === 'Geofence') {
    verticesMeters = defaultRectVerticesFromPosition(f)
  }
  const fillColor = p.fillColor ?? DEFAULT_GEOFENCE_FILL_COLOR
  const fillOpacity = resolveGeofenceFillOpacity(fillColor, p.fillOpacity)
  const fillBaseColor = resolveGeofenceFillBaseColor(fillColor)
  return {
    verticesMeters,
    labels: p.labels ?? [],
    strokeStyle: p.strokeStyle ?? 'solid',
    strokeWidthPx: p.strokeWidthPx ?? DEFAULT_GEOFENCE_STROKE_WIDTH_PX,
    strokeColor: p.strokeColor ?? DEFAULT_GEOFENCE_STROKE_COLOR,
    fillEnabled: p.fillEnabled ?? false,
    fillColor,
    fillOpacity,
    fillBaseColor,
    resolvedFillColor: composeGeofenceFillColor(fillBaseColor, fillOpacity),
  }
}

/** 無頂點時由 position + size 還原矩形（公尺） */
function defaultRectVerticesFromPosition(f: GeofenceFacility): GeofenceVertexMeters[] {
  const x0 = f.position.x
  const y0 = f.position.y
  const sm = GEOFENCE_DEFAULT_SIZE_METERS
  return [
    { x: x0, y: y0 },
    { x: x0 + sm.w, y: y0 },
    { x: x0 + sm.w, y: y0 + sm.h },
    { x: x0, y: y0 + sm.h },
  ]
}

export function defaultRectVerticesMeters(
  centerMeters: { x: number; y: number },
  widthM: number = GEOFENCE_DEFAULT_SIZE_METERS.w,
  heightM: number = GEOFENCE_DEFAULT_SIZE_METERS.h,
): GeofenceVertexMeters[] {
  const x0 = centerMeters.x - widthM / 2
  const y0 = centerMeters.y - heightM / 2
  return [
    { x: x0, y: y0 },
    { x: x0 + widthM, y: y0 },
    { x: x0 + widthM, y: y0 + heightM },
    { x: x0, y: y0 + heightM },
  ]
}

export function verticesToAreaLocalPx(
  verticesMeters: GeofenceVertexMeters[],
  domain: MapAreaDomain,
  layout: MapAreaLayout,
  view?: MapAreaView,
): { x: number; y: number }[] {
  return verticesMeters.map((v) =>
    meterToAreaLocalPx(v.x, v.y, domain, layout, view),
  )
}

export function verticesToWorldPx(
  verticesMeters: GeofenceVertexMeters[],
): { x: number; y: number }[] {
  return verticesMeters.map((v) => ({
    x: metersToWorldPx(v.x),
    y: metersToWorldPx(v.y),
  }))
}

export function bboxWorldPx(verticesPx: { x: number; y: number }[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  w: number
  h: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const v of verticesPx) {
    minX = Math.min(minX, v.x)
    minY = Math.min(minY, v.y)
    maxX = Math.max(maxX, v.x)
    maxY = Math.max(maxY, v.y)
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100, w: 100, h: 100 }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

export function bboxMeters(verticesMeters: GeofenceVertexMeters[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  w: number
  h: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const v of verticesMeters) {
    minX = Math.min(minX, v.x)
    minY = Math.min(minY, v.y)
    maxX = Math.max(maxX, v.x)
    maxY = Math.max(maxY, v.y)
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, w: 1, h: 1 }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

export type GeofenceScaleCorner = 'nw' | 'ne' | 'se' | 'sw'

export function geofenceScaleAnchor(
  box: ReturnType<typeof bboxMeters>,
  corner: GeofenceScaleCorner,
): GeofenceVertexMeters {
  switch (corner) {
    case 'nw':
      return { x: box.maxX, y: box.maxY }
    case 'ne':
      return { x: box.minX, y: box.maxY }
    case 'se':
      return { x: box.minX, y: box.minY }
    case 'sw':
      return { x: box.maxX, y: box.minY }
  }
}

export function geofenceBboxCorner(
  box: ReturnType<typeof bboxMeters>,
  corner: GeofenceScaleCorner,
): GeofenceVertexMeters {
  switch (corner) {
    case 'nw':
      return { x: box.minX, y: box.minY }
    case 'ne':
      return { x: box.maxX, y: box.minY }
    case 'se':
      return { x: box.maxX, y: box.maxY }
    case 'sw':
      return { x: box.minX, y: box.maxY }
  }
}

export function scaleGeofenceFromAnchor(
  verticesMeters: GeofenceVertexMeters[],
  labels: GeofenceTextLabel[],
  anchor: GeofenceVertexMeters,
  scaleX: number,
  scaleY: number,
): { verticesMeters: GeofenceVertexMeters[]; labels: GeofenceTextLabel[] } {
  const sx = Number.isFinite(scaleX) ? scaleX : 1
  const sy = Number.isFinite(scaleY) ? scaleY : 1
  return {
    verticesMeters: verticesMeters.map((v) => ({
      x: anchor.x + (v.x - anchor.x) * sx,
      y: anchor.y + (v.y - anchor.y) * sy,
    })),
    labels: labels.map((lb) => ({
      ...lb,
      x: anchor.x + (lb.x - anchor.x) * sx,
      y: anchor.y + (lb.y - anchor.y) * sy,
    })),
  }
}

export function scaleGeofenceToDraggedCorner(
  startVerts: GeofenceVertexMeters[],
  startLabels: GeofenceTextLabel[],
  corner: GeofenceScaleCorner,
  dragMeter: GeofenceVertexMeters,
  minSizeM = 0.1,
): { verticesMeters: GeofenceVertexMeters[]; labels: GeofenceTextLabel[] } {
  const box = bboxMeters(startVerts)
  const anchor = geofenceScaleAnchor(box, corner)
  const spanX = Math.max(1e-9, box.maxX - box.minX)
  const spanY = Math.max(1e-9, box.maxY - box.minY)

  let scaleX = 1
  let scaleY = 1
  if (corner === 'se' || corner === 'ne') {
    scaleX = (dragMeter.x - anchor.x) / spanX
  } else {
    scaleX = (anchor.x - dragMeter.x) / spanX
  }
  if (corner === 'se' || corner === 'sw') {
    scaleY = (dragMeter.y - anchor.y) / spanY
  } else {
    scaleY = (anchor.y - dragMeter.y) / spanY
  }

  const minScaleX = minSizeM / spanX
  const minScaleY = minSizeM / spanY
  // 僅在縮小時限制最小尺寸，避免一碰就強制放大
  if (scaleX > 0 && scaleX < 1 && scaleX < minScaleX) scaleX = minScaleX
  if (scaleY > 0 && scaleY < 1 && scaleY < minScaleY) scaleY = minScaleY

  return scaleGeofenceFromAnchor(startVerts, startLabels, anchor, scaleX, scaleY)
}

export function positionFromVerticesMeters(
  verticesMeters: GeofenceVertexMeters[],
): { x: number; y: number } {
  let minX = Infinity
  let minY = Infinity
  for (const v of verticesMeters) {
    minX = Math.min(minX, v.x)
    minY = Math.min(minY, v.y)
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0 }
  return { x: minX, y: minY }
}

export function sizeMetersFromVertices(
  verticesMeters: GeofenceVertexMeters[],
): { w: number; h: number } {
  const px = verticesToWorldPx(verticesMeters)
  const box = bboxWorldPx(px)
  return { w: worldPxToMeters(box.w), h: worldPxToMeters(box.h) }
}

export function pointInPolygon(
  x: number,
  y: number,
  polygon: { x: number; y: number }[],
): boolean {
  if (polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.x
    const yi = polygon[i]!.y
    const xj = polygon[j]!.x
    const yj = polygon[j]!.y
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) {
    return Math.hypot(px - ax, py - ay)
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

const EDGE_HIT_PX = 10

/** 編輯時點擊圍籬邊線的額外命中寬度（世界 px） */
export const GEOFENCE_HIT_STROKE_PX = 16

/** 未填色時仍要能點選內部 */
export const GEOFENCE_HIT_FILL = 'rgba(0,0,0,0.01)'

export function findEdgeIndexAtWorldPoint(
  worldX: number,
  worldY: number,
  verticesPx: { x: number; y: number }[],
): number | null {
  const n = verticesPx.length
  if (n < 2) return null
  let best: { idx: number; dist: number } | null = null
  for (let i = 0; i < n; i++) {
    const a = verticesPx[i]!
    const b = verticesPx[(i + 1) % n]!
    const d = distanceToSegment(worldX, worldY, a.x, a.y, b.x, b.y)
    if (d <= EDGE_HIT_PX && (!best || d < best.dist)) {
      best = { idx: i, dist: d }
    }
  }
  return best?.idx ?? null
}

export function midpointOfEdge(
  verticesPx: { x: number; y: number }[],
  edgeIndex: number,
): { x: number; y: number } {
  const n = verticesPx.length
  const a = verticesPx[edgeIndex]!
  const b = verticesPx[(edgeIndex + 1) % n]!
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function insertVertexOnEdge(
  verticesMeters: GeofenceVertexMeters[],
  edgeIndex: number,
): GeofenceVertexMeters[] {
  const n = verticesMeters.length
  if (n < 2) return verticesMeters
  const a = verticesMeters[edgeIndex]!
  const b = verticesMeters[(edgeIndex + 1) % n]!
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const next = [...verticesMeters]
  next.splice(edgeIndex + 1, 0, mid)
  return next
}

export function strokeDashArray(
  style: GeofenceStrokeStyle,
  width: number,
): string | undefined {
  switch (style) {
    case 'dashed':
      return `${width * 4} ${width * 2.5}`
    case 'dotted':
      return `${width} ${width * 1.8}`
    default:
      return undefined
  }
}

export function geofenceContainsWorldPoint(
  f: GeofenceFacility,
  worldX: number,
  worldY: number,
): boolean {
  const { verticesMeters } = getGeofenceParams(f)
  const poly = verticesToWorldPx(verticesMeters)
  if (pointInPolygon(worldX, worldY, poly)) return true
  return findEdgeIndexAtWorldPoint(worldX, worldY, poly) !== null
}

export function newGeofenceLabelId(): string {
  return `lbl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function labelCenterWorldPx(label: GeofenceTextLabel): {
  x: number
  y: number
} {
  const x = metersToWorldPx(label.x)
  const y = metersToWorldPx(label.y)
  const w = Math.max(24, label.text.length * label.fontSizePx * 0.55)
  const h = label.fontSizePx * 1.35
  return { x: x + w / 2, y: y + h / 2 }
}

/**
 * Area 外框拉伸提交後：頂點／標籤維持地圖位置，僅依新 layout 換算場域公尺。
 */
export function syncGeofenceVerticesAfterLayoutResize(
  f: GeofenceFacility,
  domain: MapAreaDomain,
  oldLayout: MapAreaLayout,
  newLayout: MapAreaLayout,
): GeofenceFacility {
  const params = getGeofenceParams(f)
  const dx = oldLayout.xPx - newLayout.xPx
  const dy = oldLayout.yPx - newLayout.yPx
  const remapMeter = (xM: number, yM: number) => {
    const ap = meterToAreaLocalPx(xM, yM, domain, oldLayout)
    const shifted = { x: ap.x + dx, y: ap.y + dy }
    return areaLocalPxToMeter(shifted.x, shifted.y, domain, newLayout)
  }
  const verticesMeters = params.verticesMeters.map((v) => remapMeter(v.x, v.y))
  const labels = params.labels.map((lb) => {
    const m = remapMeter(lb.x, lb.y)
    return { ...lb, x: m.x, y: m.y }
  })
  return syncGeofenceFacility({
    ...f,
    parameters: {
      ...f.parameters,
      verticesMeters,
      labels,
    },
  })
}

/** 依頂點同步 position（匯入或更新後呼叫） */
export function syncGeofenceFacility(f: GeofenceFacility): GeofenceFacility {
  const { verticesMeters } = getGeofenceParams(f)
  if (verticesMeters.length < 3) return f
  return {
    ...f,
    position: positionFromVerticesMeters(verticesMeters),
    parameters: {
      ...f.parameters,
      verticesMeters,
    },
  }
}

export function isLabelInsideGeofence(
  f: GeofenceFacility,
  label: GeofenceTextLabel,
): boolean {
  const { verticesMeters } = getGeofenceParams(f)
  const poly = verticesToWorldPx(verticesMeters)
  const c = labelCenterWorldPx(label)
  return pointInPolygon(c.x, c.y, poly)
}
