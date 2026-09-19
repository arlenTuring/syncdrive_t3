import type { FacilityObject } from '../types/facility'
import { isZonePartition } from './zonePartition'

export const FACILITY_PIN_TO_TOP_KEY = 'pinToTop'

/** Area 內底圖容器（最底層；可載入本機圖片） */
export const BASEMAP_LAYER_Z = 1

/**
 * 分區區塊：永遠在一般設施之下、底圖之上，方便上方擺放設施。
 * 選取時也不抬升，避免蓋住分區內設施。
 */
export const ZONE_PARTITION_Z_BASE = 5

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

function facilityPaintTier(
  f: FacilityObject,
): 'pinned' | 'roadLine' | 'basemap' | 'zonePartition' | 'normal' {
  if (f.type === 'Basemap') return 'basemap'
  /** 分區固定置底，忽略置頂旗標 */
  if (isZonePartition(f)) return 'zonePartition'
  if (isFacilityPinToTop(f)) return 'pinned'
  if (f.type === 'RoadLine') return 'roadLine'
  return 'normal'
}

export function resolveFacilityStackZ(
  f: FacilityObject,
  orderIndex: number,
  selected: boolean,
  opts?: { roadLineLayer?: boolean; basemapLayer?: boolean },
): number {
  const sel = selected ? 100 : 0
  const tier = facilityPaintTier(f)
  if (tier === 'basemap') return BASEMAP_LAYER_Z + orderIndex + sel
  if (tier === 'zonePartition') return ZONE_PARTITION_Z_BASE + orderIndex
  if (tier === 'pinned') return PINNED_FACILITY_Z_BASE + orderIndex + sel
  if (tier === 'roadLine') {
    return opts?.roadLineLayer
      ? ROAD_LINE_LAYER_Z + orderIndex + sel
      : ROAD_LINE_Z_BASE + orderIndex + sel
  }
  return BASE_FACILITY_Z + orderIndex + sel
}

/**
 * 繪製順序（主圖層）：分區（底）→ 一般設施 → 手動置頂。
 * 底圖／道路線改由 AreaNode 內獨立疊加層繪製，不參與此排序。
 */
export function sortFacilitiesForPaint<T extends FacilityObject>(
  facilities: T[],
): T[] {
  const zones: T[] = []
  const normal: T[] = []
  const pinned: T[] = []
  for (const f of facilities) {
    if (f.type === 'RoadLine' || f.type === 'Basemap')
      continue
    if (isZonePartition(f)) {
      zones.push(f)
      continue
    }
    if (isFacilityPinToTop(f)) pinned.push(f)
    else normal.push(f)
  }
  return [...zones, ...normal, ...pinned]
}

export function listBasemapsForPaint<T extends FacilityObject>(
  facilities: T[],
): T[] {
  return facilities.filter((f) => f.type === 'Basemap')
}

export function listRoadLinesForPaint<T extends FacilityObject>(
  facilities: T[],
): T[] {
  return facilities.filter(
    (f) => f.type === 'RoadLine',
  )
}
