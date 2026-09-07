import type { FacilityObject } from '../types/facility'
import { CROSS_PARTS, SWITCH_PARTS, type TrackGenPart } from './trackGenGroups'

/**
 * 交叉與分岔<strong>一個元件、兩條軌道</strong>。
 */

export const TRACKGEN_PART_NAMES_KEY = 'trackGenPartNames'
export const TRACKGEN_PART_COLORS_KEY = 'trackGenPartColors'

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
