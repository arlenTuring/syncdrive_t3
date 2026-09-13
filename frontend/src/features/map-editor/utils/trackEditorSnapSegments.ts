import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  areaLocalPxToMeter,
  domainHeightM,
  domainWidthM,
} from './areaCoords'
import {
  resolveFacilityAreaPosition,
  resolveFacilityAreaSize,
} from './facilityAreaCoords'
import type { TrackNetworkSegment } from '../vehicles/trackNetwork/types'

/**
 * 虛擬渡線吸附／勾子：只對軌道「畫面上的實體外框」做碰撞（areaPosition + areaSize）。
 * 與元件參數「場域範圍」(refField*) 無關；refField 僅供車輛定位／導通等邏輯使用。
 */
export function trackVisualFieldBounds(
  track: FacilityObject,
  area: MapAreaObject,
): {
  xMinM: number
  xMaxM: number
  yMinM: number
  yMaxM: number
} | null {
  if (track.type !== 'Track') return null
  const domainSpan = {
    w: domainWidthM(area.domain),
    h: domainHeightM(area.domain),
  }
  const areaPos = resolveFacilityAreaPosition(track, area.domain, area.layout)
  const areaSize = resolveFacilityAreaSize(
    track,
    area.domain,
    area.layout,
    domainSpan,
  )
  const bl = areaLocalPxToMeter(
    areaPos.x,
    areaPos.y,
    area.domain,
    area.layout,
  )
  const tr = areaLocalPxToMeter(
    areaPos.x + areaSize.w,
    areaPos.y + areaSize.h,
    area.domain,
    area.layout,
  )
  const xMinM = Math.min(bl.x, tr.x)
  const xMaxM = Math.max(bl.x, tr.x)
  const yMinM = Math.min(bl.y, tr.y)
  const yMaxM = Math.max(bl.y, tr.y)
  if (!(xMaxM > xMinM) || !(yMaxM > yMinM)) return null
  return { xMinM, xMaxM, yMinM, yMaxM }
}

/**
 * 建立虛擬渡線編輯用的軌道碰撞段（實體外框，非 refField）。
 */
export function buildEditorTrackSnapSegments(
  area: MapAreaObject,
): Map<string, TrackNetworkSegment> {
  const map = new Map<string, TrackNetworkSegment>()
  for (const track of area.facilities ?? []) {
    if (track.type !== 'Track') continue
    const bounds = trackVisualFieldBounds(track, area)
    if (!bounds) continue
    const spanW = bounds.xMaxM - bounds.xMinM
    const spanH = bounds.yMaxM - bounds.yMinM
    map.set(track.id, {
      trackId: track.id,
      trackCode: track.customName?.trim() || null,
      bounds,
      horizontal: spanW >= spanH,
      track,
      renderArea: area,
    })
  }
  return map
}
