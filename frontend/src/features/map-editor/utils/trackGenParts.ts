import type { FacilityObject } from '../types/facility'
import { CROSS_DIAG_PARTS, CROSS_PARTS, SWITCH_PARTS, type TrackGenPart } from './trackGenGroups'
import { TRACK_DEFAULT_LABEL_FONT_PX } from './facilityLabelStyle'

export type { TrackGenPart } from './trackGenGroups'

/**
 * 交叉與分岔<strong>一個元件、兩條軌道</strong>。
 */

export const TRACKGEN_PART_NAMES_KEY = 'trackGenPartNames'
export const TRACKGEN_PART_COLORS_KEY = 'trackGenPartColors'
export const TRACKGEN_PART_FONT_KEY = 'trackGenPartFontPx'
/** 分岔主線／岔線顯示：fill=實心色塊，dashed=同形虛線軌道（無填色） */
export const TRACKGEN_PART_STYLES_KEY = 'trackGenPartStyles'
/** 各半名字相對幾何中心的偏移（元件內像素） */
export const TRACKGEN_PART_LABEL_OFFSETS_KEY = 'trackGenPartLabelOffsets'

export type TrackGenPartStyle = 'fill' | 'dashed'

/**
 * 兩半名字的預設字級——與一般軌道 {@link TRACK_DEFAULT_LABEL_FONT_PX} 一致。
 * 軌道生成套用時也寫入同一值，避免主線／岔線看起來比直軌小一截。
 */
export const DEFAULT_PART_FONT_PX = TRACK_DEFAULT_LABEL_FONT_PX
export const MIN_PART_FONT_PX = 6
export const MAX_PART_FONT_PX = 48

/** 各段名字要不要標在圖上；只有斜行兩條可以關（沒有的鍵視為顯示） */
export const TRACKGEN_PART_LABEL_HIDDEN_KEY = 'trackGenPartLabelHidden'

/** 這個設施分成哪幾段可以各自命名：交叉是兩條直行加兩條斜行，分岔是主線與岔線 */
export function facilityParts(f: FacilityObject): readonly TrackGenPart[] | null {
  if (f.name === 'RailCross') return [...CROSS_PARTS, ...CROSS_DIAG_PARTS]
  if (f.name === 'RailSwitch') return SWITCH_PARTS
  return null
}

/** 這一段的名字能不能關掉不標：只有斜行可以 */
export function partLabelCanHide(part: TrackGenPart): boolean {
  return (CROSS_DIAG_PARTS as readonly string[]).includes(part)
}

/** 被關掉名稱顯示的段 */
export function getTrackGenPartLabelHidden(f: FacilityObject): Record<string, boolean> {
  const v = f.parameters?.[TRACKGEN_PART_LABEL_HIDDEN_KEY]
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, boolean> = {}
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (raw === true) out[k] = true
  }
  return out
}

/** 只改一段的名稱顯示；顯示（預設）就把鍵拿掉 */
export function patchTrackGenPartLabelHidden(
  f: FacilityObject,
  part: TrackGenPart,
  hidden: boolean,
): Record<string, unknown> {
  const next = { ...getTrackGenPartLabelHidden(f) }
  if (hidden) next[part] = true
  else delete next[part]
  return { [TRACKGEN_PART_LABEL_HIDDEN_KEY]: next }
}

function readMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' && val.trim()) out[k] = val.trim()
  }
  return out
}

/** 兩半各自的名字；沒命名的那一半不會出現在裡面 */
export function getTrackGenPartNames(f: FacilityObject): Record<string, string> {
  return readMap(f.parameters?.[TRACKGEN_PART_NAMES_KEY])
}

/** 兩半各自的底色 */
export function getTrackGenPartColors(f: FacilityObject): Record<string, string> {
  return readMap(f.parameters?.[TRACKGEN_PART_COLORS_KEY])
}

/** 兩半各自的字級（像素）；沒設的那一半不會出現在裡面 */
export function getTrackGenPartFontPx(f: FacilityObject): Record<string, number> {
  const v = f.parameters?.[TRACKGEN_PART_FONT_KEY]
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) {
      out[k] = Math.max(MIN_PART_FONT_PX, Math.min(MAX_PART_FONT_PX, n))
    }
  }
  return out
}

/** 分岔主線／岔線顯示樣式；未設定視為色塊 */
export function getTrackGenPartStyles(
  f: FacilityObject,
): Record<string, TrackGenPartStyle> {
  const v = f.parameters?.[TRACKGEN_PART_STYLES_KEY]
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, TrackGenPartStyle> = {}
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (raw === 'fill' || raw === 'dashed') out[k] = raw
  }
  return out
}

export function getTrackGenPartStyle(
  f: FacilityObject,
  part: TrackGenPart,
): TrackGenPartStyle {
  return getTrackGenPartStyles(f)[part] ?? 'fill'
}

/** 各半名字相對該半幾何中心的偏移；未拖過則沒有該鍵 */
export function getTrackGenPartLabelOffsets(
  f: FacilityObject,
): Record<string, { x: number; y: number }> {
  const v = f.parameters?.[TRACKGEN_PART_LABEL_OFFSETS_KEY]
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, { x: number; y: number }> = {}
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as { x?: unknown; y?: unknown }
    const x = typeof o.x === 'number' && Number.isFinite(o.x) ? o.x : null
    const y = typeof o.y === 'number' && Number.isFinite(o.y) ? o.y : null
    if (x === null || y === null) continue
    out[k] = { x, y }
  }
  return out
}

export function getTrackGenPartLabelOffset(
  f: FacilityObject,
  part: TrackGenPart,
): { x: number; y: number } {
  return getTrackGenPartLabelOffsets(f)[part] ?? { x: 0, y: 0 }
}

/** 只改一半的名字，另一半原封不動 */
export function patchTrackGenPartName(
  f: FacilityObject,
  part: TrackGenPart,
  name: string,
): Record<string, unknown> {
  const next = { ...getTrackGenPartNames(f) }
  const trimmed = name.trim()
  if (trimmed) next[part] = trimmed
  else delete next[part]
  return { [TRACKGEN_PART_NAMES_KEY]: next }
}

/** 只改一半的底色 */
export function patchTrackGenPartColor(
  f: FacilityObject,
  part: TrackGenPart,
  color: string,
): Record<string, unknown> {
  const next = { ...getTrackGenPartColors(f) }
  const trimmed = color.trim()
  if (trimmed) next[part] = trimmed
  else delete next[part]
  return { [TRACKGEN_PART_COLORS_KEY]: next }
}

/** 只改一半的字級；給 null 或超出範圍就回到預設 */
export function patchTrackGenPartFont(
  f: FacilityObject,
  part: TrackGenPart,
  px: number | null,
): Record<string, unknown> {
  const next = { ...getTrackGenPartFontPx(f) }
  if (px === null || !Number.isFinite(px)) delete next[part]
  else next[part] = Math.max(MIN_PART_FONT_PX, Math.min(MAX_PART_FONT_PX, Math.round(px)))
  return { [TRACKGEN_PART_FONT_KEY]: next }
}

/** 只改一半的顯示樣式（色塊／虛線） */
export function patchTrackGenPartStyle(
  f: FacilityObject,
  part: TrackGenPart,
  style: TrackGenPartStyle,
): Record<string, unknown> {
  const next = { ...getTrackGenPartStyles(f) }
  if (style === 'fill') delete next[part]
  else next[part] = style
  return { [TRACKGEN_PART_STYLES_KEY]: next }
}

/** 只改一半名字的位置偏移（相對該半幾何中心） */
export function patchTrackGenPartLabelOffset(
  f: FacilityObject,
  part: TrackGenPart,
  offset: { x: number; y: number } | null,
): Record<string, unknown> {
  const next = { ...getTrackGenPartLabelOffsets(f) }
  if (
    offset === null ||
    (Math.abs(offset.x) < 0.5 && Math.abs(offset.y) < 0.5)
  ) {
    delete next[part]
  } else {
    next[part] = {
      x: Math.round(offset.x * 10) / 10,
      y: Math.round(offset.y * 10) / 10,
    }
  }
  return { [TRACKGEN_PART_LABEL_OFFSETS_KEY]: next }
}
