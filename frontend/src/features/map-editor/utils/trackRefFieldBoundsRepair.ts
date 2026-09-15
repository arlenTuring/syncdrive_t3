import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  getValidRefFieldBounds,
  patchRefFieldBounds,
  REF_FIELD_X_MAX_M,
  REF_FIELD_X_MIN_M,
  REF_FIELD_Y_MAX_M,
  REF_FIELD_Y_MIN_M,
} from './facilityRefFieldBounds'
import { getTrackGenPaths } from './trackGenPaths'
import { LANE_HALF_W_M, realBounds } from './trackGenApply'

/**
 * 場域範圍對不上自己的真實路徑時，照路徑重算。
 *
 * <h3>為什麼會對不上</h3>
 * 一塊軌道身上有兩份現場資訊：<code>trackGenRealPath</code>（這一段實際走過的座標）
 * 與<code>場域範圍</code>（這一塊蓋到的方框）。方框本來就是從路徑算出來的——
 * {@link realBounds} 取路徑外框再往兩側撐半個車道。
 *
 * 但方框是<strong>算完就存下來</strong>的。路徑後來被重新生成、方塊被重畫，
 * 而方框沒跟著重算，兩者就分家了。分家不會報錯，因為每一塊自己的換算仍然自洽；
 * 壞的是<strong>別人</strong>：方框畫得太大的那一塊，會把鄰居範圍內的點也吸過去。
 *
 * T3 實測：D17 的方框往南多出 72.6 公尺，整個蓋住 D18。於是停在 D18 的車、
 * D18 上的取樣點，九個有九個被判給 D17——健檢報的是 D18 有問題，真正錯的是 D17。
 *
 * <h3>為什麼要留容差</h3>
 * 半個車道的撐開量是後來才加的。早一版存下來的方框沒有這一段，跟現在重算的結果
 * 剛好差一個 {@link LANE_HALF_W_M}。那種差距是版本差異不是錯誤，重寫只會讓 31 塊
 * 軌道無謂地變動。容差取一個完整車道寬——撐開量最多只能解釋到這裡，超過就不是
 * 版本差異了。
 */
const TOLERANCE_M = LANE_HALF_W_M * 2

export type TrackRefFieldBoundsRepair = {
  name: string
  id: string
  worstM: number
  fromM: string
  toM: string
}

function boundsFromRealPath(
  facility: FacilityObject,
): Record<string, number> | null {
  const paths = getTrackGenPaths(facility.parameters)
  if (!paths || paths.real.length === 0) return null
  const next = realBounds(paths.real.map(([x, y]) => ({ x, y })))
  return Object.keys(next).length === 4 ? (next as Record<string, number>) : null
}

/** 這一塊的方框與它自己的路徑差多少（公尺，取四邊最大） */
export function refFieldBoundsDriftM(facility: FacilityObject): number | null {
  const current = getValidRefFieldBounds(facility.parameters)
  if (!current) return null
  const next = boundsFromRealPath(facility)
  if (!next) return null
  return Math.max(
    Math.abs(current.xMinM - next[REF_FIELD_X_MIN_M]),
    Math.abs(current.xMaxM - next[REF_FIELD_X_MAX_M]),
    Math.abs(current.yMinM - next[REF_FIELD_Y_MIN_M]),
    Math.abs(current.yMaxM - next[REF_FIELD_Y_MAX_M]),
  )
}

/**
 * 照真實路徑重算場域範圍。差距在一個車道寬以內的不動——那是撐開量的版本差異。
 */
export function repairTrackRefFieldBoundsInAreas(areas: MapAreaObject[]): {
  areas: MapAreaObject[]
  repaired: TrackRefFieldBoundsRepair[]
} {
  const repaired: TrackRefFieldBoundsRepair[] = []
  let changed = false

  const next = areas.map((area) => {
    let areaChanged = false
    const facilities = area.facilities.map((facility) => {
      const drift = refFieldBoundsDriftM(facility)
      if (drift === null || drift <= TOLERANCE_M) return facility
      const bounds = boundsFromRealPath(facility)
      if (!bounds) return facility
      const before = getValidRefFieldBounds(facility.parameters)
      if (!before) return facility

      repaired.push({
        name: facility.customName?.trim() || facility.id,
        id: facility.id,
        worstM: Math.round(drift * 100) / 100,
        fromM: `x ${before.xMinM.toFixed(1)}~${before.xMaxM.toFixed(1)} y ${before.yMinM.toFixed(1)}~${before.yMaxM.toFixed(1)}`,
        toM: `x ${bounds[REF_FIELD_X_MIN_M].toFixed(1)}~${bounds[REF_FIELD_X_MAX_M].toFixed(1)} y ${bounds[REF_FIELD_Y_MIN_M].toFixed(1)}~${bounds[REF_FIELD_Y_MAX_M].toFixed(1)}`,
      })
      areaChanged = true
      return {
        ...facility,
        parameters: patchRefFieldBounds(facility.parameters, {
          xMinM: bounds[REF_FIELD_X_MIN_M],
          xMaxM: bounds[REF_FIELD_X_MAX_M],
          yMinM: bounds[REF_FIELD_Y_MIN_M],
          yMaxM: bounds[REF_FIELD_Y_MAX_M],
        }),
      }
    })
    if (!areaChanged) return area
    changed = true
    return { ...area, facilities }
  })

  return { areas: changed ? next : areas, repaired }
}

export { TOLERANCE_M as TRACK_REF_FIELD_BOUNDS_TOLERANCE_M }
