import type { TextHorizontalAlign, TextVerticalAlign } from '../../../lib/textAlignment'
import type { TextWrapMode } from '../../../lib/textLayout'
import {
  resolveTextHorizontalAlign,
  resolveTextVerticalAlign,
} from '../../../lib/textAlignment'
import { resolveTextWrapMode } from '../../../lib/textLayout'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject, FacilityType } from '../types/facility'
import { clamp } from './dom'

export const LABEL_STYLE_PARAM_KEY = 'labelStyle'

/** 未指定時依設施尺寸推算的預設字級（世界座標 px） */
export const DEFAULT_AUTO_LABEL_FONT_PX = 16

/** 內建範例地圖設施預設字級（非軌道） */
export const EXAMPLE_MAP_DEFAULT_LABEL_FONT_PX = 16

/** 圖台軌道／道路元件預設字級 */
export const TRACK_DEFAULT_LABEL_FONT_PX = 16

/** 載入內建地圖時統一補上 16px 字級的 mapId */
export const UNIFORM_LABEL_MAP_IDS = new Set(['t3-main-version'])

/** 名稱相對圖示／圖元的擺放位置 */
export const LABEL_PLACEMENTS = [
  'above',
  'below',
  'left',
  'right',
  'center',
] as const
export type LabelPlacement = (typeof LABEL_PLACEMENTS)[number]

export type FacilityLabelStyle = {
  /** 明確 false 時不顯示名稱 */
  visible?: boolean
  /** 圖台標籤字級（世界座標 px，與設施卡片同一座標系） */
  fontSizePx?: number
  color?: string
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
  /** 名稱相對圖示位置（號誌、智慧桿等；未拖曳時的預設錨點） */
  labelPlacement?: LabelPlacement
  /** 名稱相對圖示中心偏移（Area 內世界 px；拖曳後寫入） */
  labelOffsetPx?: { x: number; y: number }
  /** 使用者曾拖曳調整名稱位置（未設時忽略舊版 labelOffsetPx，預設置中） */
  labelOffsetCustom?: boolean
  /** 名稱文字旋轉（度；相對設施本體，與 facility.rotation 疊加） */
  labelRotationDeg?: number
  /** 名稱橫向對齊（預設置中） */
  textAlign?: TextHorizontalAlign
  /** 名稱縱向對齊（預設置中） */
  verticalAlign?: TextVerticalAlign
  /** 文字排列：single 單行不換行、wrap 自動換行 */
  textWrap?: TextWrapMode
  /** 標籤框寬度（世界 px；未設時依文字內容或設施寬度推算） */
  labelBoxWidthPx?: number
  /** 標籤框高度（世界 px） */
  labelBoxHeightPx?: number
}

export function parseLabelPlacement(raw: unknown): LabelPlacement | undefined {
  if (
    raw === 'above' ||
    raw === 'below' ||
    raw === 'left' ||
    raw === 'right' ||
    raw === 'center'
  ) {
    return raw
  }
  return undefined
}

/** 圖示在前、名稱在後的 DOM 順序下，依 placement 排列 flex */
export function labelPlacementFlexClass(placement: LabelPlacement): string {
  switch (placement) {
    case 'above':
      return 'flex-col-reverse items-center justify-center gap-0.5'
    case 'below':
      return 'flex-col items-center justify-center gap-0.5'
    case 'left':
      return 'flex-row-reverse items-center justify-center gap-1'
    case 'right':
      return 'flex-row items-center justify-center gap-1'
    case 'center':
      return 'relative flex size-full items-center justify-center'
  }
}

export const LABEL_PLACEMENT_LABELS: Record<LabelPlacement, string> = {
  above: '名稱在圖示上方',
  below: '名稱在圖示下方',
  left: '名稱在圖示左側',
  right: '名稱在圖示右側',
  center: '名稱疊在圖示中央',
}

export function resolveLabelPlacement(
  facility: FacilityObject,
  style: FacilityLabelStyle,
): LabelPlacement {
  const explicit = style.labelPlacement
  if (explicit) return explicit
  if (facility.type === 'Track' || facility.type === 'Facility') return 'center'
  if (facility.type === 'Pole' || facility.type === 'DockingPoint') return 'below'
  return 'below'
}

export function parseLabelOffsetPx(
  raw: unknown,
): { x: number; y: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if (typeof o.x !== 'number' || typeof o.y !== 'number') return undefined
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return undefined
  return { x: o.x, y: o.y }
}

/** 依預設擺放方向推算名稱錨點（圖示中心為原點） */
export function defaultLabelOffsetFromPlacement(
  placement: LabelPlacement,
  iconWorld: number,
  fontSize: number,
): { x: number; y: number } {
  const gap = Math.max(4, fontSize * 0.35)
  const half = iconWorld / 2
  const textHalf = fontSize * 0.55
  switch (placement) {
    case 'above':
      return { x: 0, y: -(half + textHalf + gap) }
    case 'below':
      return { x: 0, y: half + textHalf + gap }
    case 'left':
      return { x: -(half + gap + fontSize * 1.8), y: 0 }
    case 'right':
      return { x: half + gap + fontSize * 1.8, y: 0 }
    case 'center':
      return { x: 0, y: 0 }
  }
}

export function clampLabelOffsetPx(
  offset: { x: number; y: number },
  boxW: number,
  boxH: number,
): { x: number; y: number } {
  const margin = Math.max(boxW, boxH, 24) * 0.85
  return {
    x: clamp(offset.x, -margin, margin),
    y: clamp(offset.y, -margin, margin),
  }
}

export type ResolveLabelOffsetOptions = {
  /** 圖台可拖曳標籤：錨點為設施中心；僅在使用者拖曳後套用 labelOffsetPx */
  mapLabelMode?: boolean
}

export function resolveLabelOffsetPx(
  style: FacilityLabelStyle,
  placement: LabelPlacement,
  iconWorld: number,
  fontSize: number,
  boxW: number,
  boxH: number,
  options?: ResolveLabelOffsetOptions,
): { x: number; y: number } {
  const mapLabel = options?.mapLabelMode === true
  const stored = style.labelOffsetPx
  if (mapLabel) {
    if (stored && style.labelOffsetCustom === true) {
      return clampLabelOffsetPx(stored, boxW, boxH)
    }
    return clampLabelOffsetPx(
      defaultLabelOffsetFromPlacement(placement, iconWorld, fontSize),
      boxW,
      boxH,
    )
  }
  if (stored) return clampLabelOffsetPx(stored, boxW, boxH)
  return clampLabelOffsetPx(
    defaultLabelOffsetFromPlacement(placement, iconWorld, fontSize),
    boxW,
    boxH,
  )
}

export function defaultLabelFontPxForFacility(_minDim: number): number {
  return DEFAULT_AUTO_LABEL_FONT_PX
}

export function parseFacilityLabelStyle(raw: unknown): FacilityLabelStyle {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const style: FacilityLabelStyle = {}
  if (o.visible === false) style.visible = false
  if (o.visible === true) style.visible = true
  if (typeof o.fontSizePx === 'number' && Number.isFinite(o.fontSizePx)) {
    style.fontSizePx = clamp(o.fontSizePx, 6, 72)
  } else if (
    typeof o.fontSizeScale === 'number' &&
    Number.isFinite(o.fontSizeScale)
  ) {
    style.fontSizePx = clamp(
      defaultLabelFontPxForFacility(100) * o.fontSizeScale,
      6,
      72,
    )
  }
  if (typeof o.color === 'string') {
    const c = o.color.trim()
    if (c) style.color = c
  }
  if (o.fontWeight === 'bold') style.fontWeight = 'bold'
  if (o.fontStyle === 'italic') style.fontStyle = 'italic'
  const placement = parseLabelPlacement(o.labelPlacement)
  if (placement) style.labelPlacement = placement
  const offset = parseLabelOffsetPx(o.labelOffsetPx)
  if (offset) style.labelOffsetPx = offset
  if (o.labelOffsetCustom === true) style.labelOffsetCustom = true
  if (typeof o.labelRotationDeg === 'number' && Number.isFinite(o.labelRotationDeg)) {
    style.labelRotationDeg = clamp(o.labelRotationDeg, -360, 360)
  }
  const textAlign = o.textAlign
  if (textAlign === 'left' || textAlign === 'center' || textAlign === 'right') {
    style.textAlign = textAlign
  }
  const verticalAlign = o.verticalAlign
  if (verticalAlign === 'top' || verticalAlign === 'center' || verticalAlign === 'bottom') {
    style.verticalAlign = verticalAlign
  }
  if (o.textWrap === 'wrap' || o.textWrap === 'single') {
    style.textWrap = o.textWrap
  }
  if (typeof o.labelBoxWidthPx === 'number' && Number.isFinite(o.labelBoxWidthPx)) {
    style.labelBoxWidthPx = clamp(o.labelBoxWidthPx, 16, 960)
  }
  if (typeof o.labelBoxHeightPx === 'number' && Number.isFinite(o.labelBoxHeightPx)) {
    style.labelBoxHeightPx = clamp(o.labelBoxHeightPx, 12, 240)
  }
  return style
}

export function resolveLabelRotationDeg(style: FacilityLabelStyle): number {
  if (style.labelRotationDeg === undefined) return 0
  const n = style.labelRotationDeg
  return Number.isFinite(n) ? n : 0
}

export function getFacilityLabelStyle(facility: FacilityObject): FacilityLabelStyle {
  const parsed = parseFacilityLabelStyle(facility.parameters?.[LABEL_STYLE_PARAM_KEY])
  if (
    (facility.type === 'RoadLine' || facility.type === 'DockingPoint') &&
    parsed.visible === undefined
  ) {
    return { ...parsed, visible: false }
  }
  return parsed
}

export function mergeFacilityLabelStyle(
  current: FacilityLabelStyle,
  patch: Partial<FacilityLabelStyle>,
): FacilityLabelStyle {
  const next: FacilityLabelStyle = { ...current, ...patch }
  if (patch.visible === true) {
    next.visible = true
  } else if (patch.visible === false) {
    next.visible = false
  }
  if (patch.fontSizePx === undefined && 'fontSizePx' in patch) {
    delete next.fontSizePx
  }
  if (patch.color === '' || patch.color === undefined) delete next.color
  if (patch.fontWeight === 'normal') delete next.fontWeight
  if (patch.fontStyle === 'normal') delete next.fontStyle
  if (patch.labelPlacement === undefined && 'labelPlacement' in patch) {
    delete next.labelPlacement
  }
  if (patch.labelOffsetPx === undefined && 'labelOffsetPx' in patch) {
    delete next.labelOffsetPx
  }
  if (patch.labelOffsetCustom === false) {
    delete next.labelOffsetCustom
  } else if (patch.labelOffsetCustom === true) {
    next.labelOffsetCustom = true
  }
  if (patch.labelRotationDeg === undefined && 'labelRotationDeg' in patch) {
    delete next.labelRotationDeg
  } else if (patch.labelRotationDeg !== undefined) {
    next.labelRotationDeg = clamp(patch.labelRotationDeg, -360, 360)
  }
  if (patch.textWrap === undefined && 'textWrap' in patch) {
    delete next.textWrap
  }
  if (patch.labelBoxWidthPx === undefined && 'labelBoxWidthPx' in patch) {
    delete next.labelBoxWidthPx
  }
  if (patch.labelBoxHeightPx === undefined && 'labelBoxHeightPx' in patch) {
    delete next.labelBoxHeightPx
  }
  return next
}

export function labelStyleToParameters(
  style: FacilityLabelStyle,
): Record<string, unknown> {
  const out: FacilityLabelStyle = {}
  if (style.visible === false) out.visible = false
  if (style.visible === true) out.visible = true
  if (style.fontSizePx !== undefined) out.fontSizePx = style.fontSizePx
  if (style.color) out.color = style.color
  if (style.fontWeight === 'bold') out.fontWeight = 'bold'
  if (style.fontStyle === 'italic') out.fontStyle = 'italic'
  if (style.labelPlacement) out.labelPlacement = style.labelPlacement
  if (style.labelOffsetPx) out.labelOffsetPx = style.labelOffsetPx
  if (style.labelOffsetCustom === true) out.labelOffsetCustom = true
  if (style.labelRotationDeg !== undefined && style.labelRotationDeg !== 0) {
    out.labelRotationDeg = style.labelRotationDeg
  }
  if (style.textAlign) out.textAlign = style.textAlign
  if (style.verticalAlign) out.verticalAlign = style.verticalAlign
  if (style.textWrap) out.textWrap = style.textWrap
  if (style.labelBoxWidthPx !== undefined) out.labelBoxWidthPx = style.labelBoxWidthPx
  if (style.labelBoxHeightPx !== undefined) out.labelBoxHeightPx = style.labelBoxHeightPx
  return Object.keys(out).length > 0
    ? { [LABEL_STYLE_PARAM_KEY]: out }
    : { [LABEL_STYLE_PARAM_KEY]: undefined }
}

export function resolveLabelFontPx(
  minDim: number,
  style: FacilityLabelStyle,
  facilityType?: FacilityType,
): number {
  if (style.fontSizePx !== undefined) {
    return clamp(style.fontSizePx, 6, 72)
  }
  if (facilityType === 'Track') return TRACK_DEFAULT_LABEL_FONT_PX
  return defaultLabelFontPxForFacility(minDim)
}

export function resolveLabelCss(
  style: FacilityLabelStyle,
  minDim: number,
  facilityType?: FacilityType,
): {
  fontSize: number
  color: string
  fontWeight: number | 'bold' | 'normal'
  fontStyle: 'normal' | 'italic'
  textAlign: TextHorizontalAlign
  verticalAlign: TextVerticalAlign
  textWrap: TextWrapMode
  labelBoxWidthPx?: number
  labelBoxHeightPx?: number
} {
  return {
    fontSize: resolveLabelFontPx(minDim, style, facilityType),
    color: style.color ?? '#e4e4e7',
    fontWeight: style.fontWeight === 'bold' ? 'bold' : 400,
    fontStyle: style.fontStyle === 'italic' ? 'italic' : 'normal',
    textAlign: resolveTextHorizontalAlign(style.textAlign),
    verticalAlign: resolveTextVerticalAlign(style.verticalAlign),
    textWrap: resolveTextWrapMode(style.textWrap),
    labelBoxWidthPx: style.labelBoxWidthPx,
    labelBoxHeightPx: style.labelBoxHeightPx,
  }
}

export function shouldShowFacilityLabel(style: FacilityLabelStyle): boolean {
  return style.visible !== false
}

/** 內建地圖載入時，為所有設施統一補上 16px 字級 */
export function applyExampleMapDefaultLabelStyle(
  facilities: FacilityObject[],
  mapId: string,
): FacilityObject[] {
  if (!UNIFORM_LABEL_MAP_IDS.has(mapId)) return facilities
  return facilities.map((f) => {
    const targetPx = EXAMPLE_MAP_DEFAULT_LABEL_FONT_PX
    const cur = getFacilityLabelStyle(f)
    if (cur.fontSizePx === targetPx) return f
    const nextStyle = mergeFacilityLabelStyle(cur, {
      fontSizePx: targetPx,
    })
    const patch = labelStyleToParameters(nextStyle)
    return {
      ...f,
      parameters: { ...(f.parameters ?? {}), ...patch },
    }
  })
}

export function applyExampleMapDefaultLabelStyleToAreas(
  areas: MapAreaObject[],
  mapId: string,
): MapAreaObject[] {
  if (!UNIFORM_LABEL_MAP_IDS.has(mapId)) return areas
  return areas.map((a) => ({
    ...a,
    facilities: applyExampleMapDefaultLabelStyle(a.facilities, mapId),
  }))
}
