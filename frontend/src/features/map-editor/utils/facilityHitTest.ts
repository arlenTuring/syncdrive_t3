import { facilityNodeWorldSize } from '../constants/facilityDimensions'
import { metersToWorldPx } from '../constants/map'
import type { MapAreaLayout, MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { areaPxPerMeter } from './areaCoords'
import { resolveFacilitySnapRectCss } from './facilityAreaCoords'
import { sortFacilitiesForPaint } from './facilityLayerOrder'
import {
  bboxWorldPx,
  geofenceContainsWorldPoint,
  getGeofenceParams,
  isGeofenceFacility,
  verticesToWorldPx,
} from './geofence'

/** 視窗裁切／碰撞用世界座標 AABB */
export function facilityWorldCullBounds(
  f: FacilityObject,
  pos: { x: number; y: number },
): { fx: number; fy: number; fr: number; fb: number } {
  if (isGeofenceFacility(f)) {
    const box = bboxWorldPx(
      verticesToWorldPx(getGeofenceParams(f).verticesMeters),
    )
    return { fx: box.minX, fy: box.minY, fr: box.maxX, fb: box.maxY }
  }
  const { w, h } = facilityNodeWorldSize(f)
  return { fx: pos.x, fy: pos.y, fr: pos.x + w, fb: pos.y + h }
}

/** 點擊／拖曳時最小可互動邊長（公尺），視覺尺寸可更小 */
export const MIN_FACILITY_HIT_METERS = 1.5
/** 軌道（Track）較窄，加大命中範圍 */
export const MIN_TRACK_HIT_METERS = 3

export function facilityHitPadMeters(f: FacilityObject): number {
  return f.type === 'Track' ? MIN_TRACK_HIT_METERS : MIN_FACILITY_HIT_METERS
}

export function facilityHitPadWorld(f: FacilityObject): {
  padX: number
  padY: number
} {
  const { w: nw, h: nh } = facilityNodeWorldSize(f)
  const minHit = metersToWorldPx(facilityHitPadMeters(f))
  return {
    padX: Math.max(0, (minHit - nw) / 2),
    padY: Math.max(0, (minHit - nh) / 2),
  }
}

function facilitySnapHitPadPx(
  f: FacilityObject,
  pxPerMeterX: number,
  pxPerMeterY: number,
  snap: { width: number; height: number },
): { padX: number; padY: number } {
  const minHitM = facilityHitPadMeters(f)
  return {
    padX: Math.max(0, (minHitM * pxPerMeterX - snap.width) / 2),
    padY: Math.max(0, (minHitM * pxPerMeterY - snap.height) / 2),
  }
}

/** Area 本地像素座標：回傳最上層（繪製順序）命中的設施 id */
export function findFacilityAtAreaLocalPx(
  localX: number,
  localY: number,
  facilities: FacilityObject[],
  domain: MapAreaObject['domain'],
  layout: MapAreaLayout,
  domainSpan: { w: number; h: number },
): string | null {
  const { pxPerMeterX, pxPerMeterY } = areaPxPerMeter(layout, domain)
  const sorted = sortFacilitiesForPaint(
    facilities.filter(
      (f) =>
        f.type !== 'Geofence'
        && f.type !== 'RoadLine',
    ),
  )
  for (let i = sorted.length - 1; i >= 0; i--) {
    const f = sorted[i]
    if (!f) continue
    const snap = resolveFacilitySnapRectCss(f, domain, layout, domainSpan)
    const { padX, padY } = facilitySnapHitPadPx(
      f,
      pxPerMeterX,
      pxPerMeterY,
      snap,
    )
    if (
      localX >= snap.left - padX &&
      localX <= snap.left + snap.width + padX &&
      localY >= snap.top - padY &&
      localY <= snap.top + snap.height + padY
    ) {
      return f.id
    }
  }
  return null
}

/** 世界座標點是否落在設施（含互動外擴）範圍內 */
export function facilityContainsWorldPoint(
  f: FacilityObject,
  pos: { x: number; y: number },
  worldX: number,
  worldY: number,
): boolean {
  if (isGeofenceFacility(f)) {
    return geofenceContainsWorldPoint(f, worldX, worldY)
  }
  const { w, h } = facilityNodeWorldSize(f)
  const { padX, padY } = facilityHitPadWorld(f)
  const x0 = pos.x - padX
  const y0 = pos.y - padY
  return (
    worldX >= x0 &&
    worldX <= x0 + w + padX * 2 &&
    worldY >= y0 &&
    worldY <= y0 + h + padY * 2
  )
}

export function findFacilityAtWorldPoint(
  facilities: FacilityObject[],
  getPosition: (f: FacilityObject) => { x: number; y: number },
  worldX: number,
  worldY: number,
): FacilityObject | null {
  for (let i = facilities.length - 1; i >= 0; i--) {
    const f = facilities[i]
    if (!f) continue
    if (facilityContainsWorldPoint(f, getPosition(f), worldX, worldY)) {
      return f
    }
  }
  return null
}
