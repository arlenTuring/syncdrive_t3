import type { MapAreaLayout, MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { resolveFacilityRenderPlacement } from './facilityAreaCoords'

export type MarqueeRect = { x: number; y: number; w: number; h: number }

function normalizeMarqueeRect(rect: MarqueeRect): {
  x1: number
  y1: number
  x2: number
  y2: number
} {
  const x1 = Math.min(rect.x, rect.x + rect.w)
  const x2 = Math.max(rect.x, rect.x + rect.w)
  const y1 = Math.min(rect.y, rect.y + rect.h)
  const y2 = Math.max(rect.y, rect.y + rect.h)
  return { x1, y1, x2, y2 }
}

/** 框選矩形與設施 hit 區相交者（略過 Geofence） */
export function facilityIdsInMarqueeRect(
  facilities: FacilityObject[],
  rect: MarqueeRect,
  domain: MapAreaObject['domain'],
  layout: MapAreaLayout,
  domainSpan: { w: number; h: number },
): string[] {
  const { x1, y1, x2, y2 } = normalizeMarqueeRect(rect)
  const ids: string[] = []

  for (const f of facilities) {
    if (f.type === 'Geofence') continue
    const { css, areaSize } = resolveFacilityRenderPlacement(
      f,
      domain,
      layout,
      domainSpan,
    )
    const fw = areaSize.w
    const fh = areaSize.h
    const fx1 = css.left
    const fy1 = css.top
    const fx2 = css.left + fw
    const fy2 = css.top + fh
    if (fx2 >= x1 && fx1 <= x2 && fy2 >= y1 && fy1 <= y2) {
      ids.push(f.id)
    }
  }

  return ids
}
