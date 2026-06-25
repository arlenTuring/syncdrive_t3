import type { FacilityType } from '../types/facility'
import { defaultSizeMetersForType } from '../constants/facilityDimensions'
import { metersToWorldPx } from '../constants/map'
import { snapDragPosition } from './snapDrag'

export function nodeWorldSizeForFacilityType(type: FacilityType): {
  w: number
  h: number
} {
  const { w, h } = defaultSizeMetersForType(type)
  return { w: metersToWorldPx(w), h: metersToWorldPx(h) }
}

/** 以視窗中心公尺座標放置：設施中心對齊該點 */
export function placementFromViewCenterMeters(
  centerMeters: { x: number; y: number },
  type: FacilityType,
): { x: number; y: number } {
  const { w: nw, h: nh } = nodeWorldSizeForFacilityType(type)
  return snapDragPosition(
    metersToWorldPx(centerMeters.x) - nw / 2,
    metersToWorldPx(centerMeters.y) - nh / 2,
    { w: nw, h: nh },
  )
}

/** 以指標世界座標放置：設施中心對齊該點 */
export function placementCenteredAtWorldPoint(
  worldPoint: { x: number; y: number },
  type: FacilityType,
): { x: number; y: number } {
  const { w: nw, h: nh } = nodeWorldSizeForFacilityType(type)
  return snapDragPosition(
    worldPoint.x - nw / 2,
    worldPoint.y - nh / 2,
    { w: nw, h: nh },
  )
}
