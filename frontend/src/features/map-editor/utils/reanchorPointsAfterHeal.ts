import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { buildTrackNetwork, resolveVehiclePlacementAcrossAreas } from '../vehicles/resolveVehicleTrackPlacement'
import { resolveFacilityAreaPosition, resolveFacilityAreaSize } from './facilityAreaCoords'
import { fieldMetersAtAreaLocal } from './fieldFromArea'
import { getRefFieldPosition } from './facilityRefFieldPosition'

/**
 * 軌道被修正之後，停靠點／途經點<strong>留在它的現場座標上</strong>，圖上的位置跟著搬。
 *
 * 載入時停靠點的場域座標是照圖上位置重算的（圖上放在哪裡就是哪裡）。軌道圖面路徑上下顛倒被翻回
 * 來之後，同一個圖面位置底下的現場座標換了：T3 的停靠點原本是照反的對應放的，翻正後座標與位置差
 * 四十幾公尺。這時若照位置重算，停靠點的座標會被悄悄改到別處——而座標是班表與車輛對得上的依據
 * （T3上行 的目錄座標是 −179.8）。
 *
 * 所以修軌道的當下先確認：這個點在修之前座標與圖上位置是對得上的（那是使用者當初認可的樣子），
 * 修完之後對不上了，就把圖上的位置搬到座標現在對應的地方。原本就對不上的不動。
 */

const CONSISTENT_M = 5
/** 搬到的位置離軌道中心線不能太遠（站台在軌道旁邊，允許幾公尺），太遠就不是這一塊的站 */
const ON_TRACK_M = 8

/** 有單點場域座標的非軌道元件：停靠點、途經點、月台門、號誌… */
function isFieldPoint(f: FacilityObject): boolean {
  return f.type !== 'Track'
}

export function reanchorFieldPointsAfterTrackHeal(
  before: MapAreaObject[],
  after: MapAreaObject[],
): { areas: MapAreaObject[]; moved: string[] } {
  if (before === after) return { areas: after, moved: [] }
  const moved: string[] = []
  const network = buildTrackNetwork(after)
  const next = after.map((area, i) => {
    const prevArea = before[i]
    if (!prevArea || prevArea === area) return area
    let touched = false
    const facilities = area.facilities.map((f) => {
      if (!isFieldPoint(f)) return f
      const { xM, yM } = getRefFieldPosition(f.parameters)
      if (xM === null || yM === null) return f
      const size = resolveFacilityAreaSize(f, area.domain, area.layout)
      const pos = resolveFacilityAreaPosition(f, area.domain, area.layout)
      const cx = pos.x + size.w / 2
      const cy = pos.y + size.h / 2
      const was = fieldMetersAtAreaLocal(prevArea, cx, cy)
      if (was.source !== 'track' || Math.hypot(was.xM - xM, was.yM - yM) > CONSISTENT_M) return f
      const now = fieldMetersAtAreaLocal(area, cx, cy)
      if (now.source === 'track' && Math.hypot(now.xM - xM, now.yM - yM) <= CONSISTENT_M) return f
      const hit = resolveVehiclePlacementAcrossAreas(after, xM, yM, network, {})
      const fix = hit?.placement.network
      if (!hit || hit.area.id !== area.id || !fix || fix.distanceM === undefined || fix.distanceM > ON_TRACK_M) return f
      touched = true
      moved.push(f.customName?.trim() || f.id)
      return {
        ...f,
        areaPosition: {
          x: hit.placement.areaLocalX - size.w / 2,
          y: hit.placement.areaLocalY - size.h / 2,
        },
      } as FacilityObject
    })
    return touched ? { ...area, facilities } : area
  })
  return { areas: moved.length > 0 ? next : after, moved }
}
