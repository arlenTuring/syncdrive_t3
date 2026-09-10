import type { FacilityObject } from '../types/facility'
import { CROSS_PARTS, SWITCH_PARTS, type TrackGenPart } from './trackGenGroups'
import { TRACK_DEFAULT_LABEL_FONT_PX } from './facilityLabelStyle'

/**
 * 交叉與分岔<strong>一個元件、兩條軌道</strong>。
 */

export const TRACKGEN_PART_NAMES_KEY = 'trackGenPartNames'
export const TRACKGEN_PART_COLORS_KEY = 'trackGenPartColors'
export const TRACKGEN_PART_FONT_KEY = 'trackGenPartFontPx'

/**
 * 兩半名字的預設字級——與一般軌道 {@link TRACK_DEFAULT_LABEL_FONT_PX} 一致。
 * 軌道生成套用時也寫入同一值，避免主線／岔線看起來比直軌小一截。
 */
export const DEFAULT_PART_FONT_PX = TRACK_DEFAULT_LABEL_FONT_PX
export const MIN_PART_FONT_PX = 6
export const MAX_PART_FONT_PX = 48

/** 這個設施分不分成兩半，分的話是哪兩半 */
export function facilityParts(f: FacilityObject): readonly TrackGenPart[] | null {
  if (f.name === 'RailCross') return CROSS_PARTS
  if (f.name === 'RailSwitch') return SWITCH_PARTS
  return null
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
