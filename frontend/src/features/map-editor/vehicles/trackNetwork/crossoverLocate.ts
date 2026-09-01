import type { MapAreaObject } from '../../types/area'
import { meterToAreaLocalPx } from '../../utils/areaCoords'
import {
  crossoverPortalFieldMeters,
  getCrossoverPortals,
} from '../../utils/trackCrossoverFacility'
import type { VehiclePlacementAcrossAreas } from '../resolveVehicleTrackPlacement'

type CrossoverFieldSegment = {
  facilityId: string
  area: MapAreaObject
  aField: { xM: number; yM: number }
  bField: { xM: number; yM: number }
  aLocal: { x: number; y: number }
  bLocal: { x: number; y: number }
}

function projectOnSegment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { t: number; distance: number } {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq <= 0) return { t: 0, distance: Math.hypot(x - ax, y - ay) }
  let t = ((x - ax) * dx + (y - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return {
    t,
    distance: Math.hypot(x - (ax + dx * t), y - (ay + dy * t)),
  }
}

function collectCrossoverFieldSegments(areas: MapAreaObject[]): CrossoverFieldSegment[] {
  const out: CrossoverFieldSegment[] = []
  for (const area of areas) {
    for (const facility of area.facilities ?? []) {
      if (facility.type !== 'TrackCrossover') continue
      const portals = getCrossoverPortals(facility)
      if (!portals) continue
      const aField = crossoverPortalFieldMeters(portals.a)
      const bField = crossoverPortalFieldMeters(portals.b)
      if (
        ![aField.xM, aField.yM, bField.xM, bField.yM].every((v) => Number.isFinite(v))
      ) {
        continue
      }
      /*
       * 圖面位置用 portal.xM／yM（區塊 domain）換算——與路線站位同一套。
       * 現場位置用 refField：車輛 MQTT 報的是場域公尺，投影必須對準現場連線。
       */
      const aLocal = meterToAreaLocalPx(
        portals.a.xM,
        portals.a.yM,
        area.domain,
        area.layout,
      )
      const bLocal = meterToAreaLocalPx(
        portals.b.xM,
        portals.b.yM,
        area.domain,
        area.layout,
      )
      out.push({
        facilityId: facility.id,
        area,
        aField,
        bField,
        aLocal,
        bLocal,
      })
    }
  }
  return out
}

/**
 * 場域座標若落在橫渡線附近，沿 portal 連線畫在圖上——不要吸到旁邊軌道中心線。
 *
 * <h3>為什麼一定要優先於 Track refField</h3>
 * 橫渡線是斜的，一定會穿過上下行軌道帶。同一個點兩種答案都算得出來：吸到帶上會
 * 得到該帶中心線，沿橫渡線才是轉線途中的位置。車在這裡是<strong>正在轉線</strong>，
 * 圖台若先判給軌道帶，視覺上就會在平行線之間來回跳／「飄」過去——模擬器路徑編輯
 * 已用橫渡線優先修過同一類問題（見 syncdrive_t3_simulator mapGeometry.js）。
 */
export function locateOnCrossover(
  areas: MapAreaObject[],
  xM: number,
  yM: number,
  toleranceM = 2,
): VehiclePlacementAcrossAreas | null {
  let best: { segment: CrossoverFieldSegment; t: number; distance: number } | null =
    null

  for (const segment of collectCrossoverFieldSegments(areas)) {
    const hit = projectOnSegment(
      xM,
      yM,
      segment.aField.xM,
      segment.aField.yM,
      segment.bField.xM,
      segment.bField.yM,
    )
    if (hit.distance > toleranceM) continue
    if (!best || hit.distance < best.distance) {
      best = { segment, t: hit.t, distance: hit.distance }
    }
  }

  if (!best) return null

  const { segment, t } = best
  return {
    area: segment.area,
    placement: {
      areaLocalX: segment.aLocal.x + (segment.bLocal.x - segment.aLocal.x) * t,
      areaLocalY: segment.aLocal.y + (segment.bLocal.y - segment.aLocal.y) * t,
      trackId: segment.facilityId,
      score: 1,
    },
  }
}
