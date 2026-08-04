import type { FacilityObject } from '../types/facility'

export const FACILITY_PIN_TO_TOP_KEY = 'pinToTop'

/** 一般設施圖層 */
const BASE_FACILITY_Z = 10
/** 道路線為標線疊加層，預設高於設施區塊（如 D17） */
export const ROAD_LINE_Z_BASE = 2000
/** Area 內道路線容器（高於 Track／Facility 填色） */
export const ROAD_LINE_LAYER_Z = 2500
/** 手動置頂（高於道路線） */
export const PINNED_FACILITY_Z_BASE = 4000

export function isFacilityPinToTop(f: FacilityObject): boolean {
  return f.parameters?.[FACILITY_PIN_TO_TOP_KEY] === true
}

function facilityPaintTier(f: FacilityObject): 'pinned' | 'roadLine' | 'normal' {
  if (isFacilityPinToTop(f)) return 'pinned'
  if (f.type === 'RoadLine' || f.type === 'TrackCrossover') return 'roadLine'
  return 'normal'
}

export function resolveFacilityStackZ(
  f: FacilityObject,
  orderIndex: number,
  selected: boolean,
  opts?: { roadLineLayer?: boolean },
): number {
  const sel = selected ? 100 : 0
  const tier = facilityPaintTier(f)
  if (tier === 'pinned') return PINNED_FACILITY_Z_BASE + orderIndex + sel
  if (tier === 'roadLine') {
    return opts?.roadLineLayer
      ? ROAD_LINE_LAYER_Z + orderIndex + sel
      : ROAD_LINE_Z_BASE + orderIndex + sel
  }
  return BASE_FACILITY_Z + orderIndex + sel
}

/**
 * 繪製順序（主圖層）：一般設施 → 手動置頂。
 * 道路線／虛擬渡線改由 AreaNode 內獨立疊加層繪製，不參與此排序。
 */
export function sortFacilitiesForPaint<T extends FacilityObject>(
  facilities: T[],
): T[] {
  const normal: T[] = []
  const pinned: T[] = []
  for (const f of facilities) {
    if (f.type === 'RoadLine' || f.type === 'TrackCrossover') continue
    if (isFacilityPinToTop(f)) pinned.push(f)
    else normal.push(f)
  }
  return [...normal, ...pinned]
}

export function listRoadLinesForPaint<T extends FacilityObject>(
  facilities: T[],
): T[] {
  return facilities.filter(
    (f) => f.type === 'RoadLine' || f.type === 'TrackCrossover',
  )
}
