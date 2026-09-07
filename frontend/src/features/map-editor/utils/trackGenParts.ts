import type { FacilityObject } from '../types/facility'
import { CROSS_PARTS, SWITCH_PARTS, type TrackGenPart } from './trackGenGroups'

/**
 * 交叉與分岔<strong>一個元件、兩條軌道</strong>。
 *
 * 交叉是上行一條、下行一條；分岔是橫的那條（主線繼續走）與斜的那條（岔出去）。
 * 圖上它們是一個物件——形狀本來就是連在一起的——但現場的人要分上下行，所以名字與
 * 底色各記各的。
 *
 * 沒有把它們拆成兩個設施，是因為那會讓一個路口變成好幾個疊在一起的物件：移動、
 * 刪除、接合都要同時處理，而交叉的兩條斜線又不屬於其中任何一條。
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
