import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { getValidRefFieldBounds } from './facilityRefFieldBounds'
import {
  getTrackGenPaths,
  pointAlongPath,
  TRACKGEN_LOCAL_PATH_KEY,
  type PathXY,
} from './trackGenPaths'

/**
 * 圖面中心線與真實中心線的<strong>順序</strong>要一致。
 *
 * 方塊有兩條中心線：真實的（現場公尺）與圖面的（外框內 0–1 比例）。車輛定位靠
 * 「走了幾成」把兩條對起來：真實路徑 40% 處，圖面路徑也取 40% 處。這個對法有個前提——
 * 兩條走的方向一樣。
 *
 * <h3>怎麼判斷誰反了</h3>
 * 方塊<strong>自己</strong>就帶著答案：它的外框（圖面）與場域範圍（refField）是一對一的——外框
 * 左緣就是場域範圍的西緣、上緣是北緣。真實路徑從東走到西，圖面路徑就該從外框右邊走到
 * 左邊；圖面路徑卻是從左走到右，那頭尾就是反的。
 *
 * 只判斷沒有旋轉（0°／180°）的方塊：旋轉過的方塊，外框軸與場域軸的對應要再換算一次，
 * 這裡不猜。<strong>判不準就不動</strong>——倒過來會改變車畫在哪裡，證據不夠寧可維持原狀
 * （實測 U19、U18 是旋轉 90° 的，圖面上與鄰居的接續看起來像反的，但站點圖釘是照現在的對法
 * 放的，倒過來會讓車停在圖釘的另一端）。
 *
 * <h3>反了會怎樣</h3>
 * 車被畫在方塊裡<strong>鏡像的位置</strong>（真實路徑的東端畫在方塊西端）、側向偏移左右相反、
 * 車頭照圖面切線畫等於朝反方向。實測 D03/U03、RailSwitch 120 與 121 是這樣。
 *
 * 判斷是冪等的：倒過來之後再判一次得到「不反」。
 */

/** 頭尾在外框上至少要差這麼多（占外框比例）才有把握 */
const MIN_SPAN = 0.15

function rotationDegOf(f: FacilityObject): number {
  const deg = f.rotation ?? 0
  return Number.isFinite(deg) ? ((deg % 360) + 360) % 360 : 0
}

/** true＝反了、false＝正確、null＝判不準 */
export function isTrackGenLocalReversed(facility: FacilityObject): boolean | null {
  const rot = rotationDegOf(facility)
  if (rot !== 0 && rot !== 180) return null
  const paths = getTrackGenPaths(facility.parameters)
  const bounds = getValidRefFieldBounds(facility.parameters)
  if (!paths || !bounds) return null

  const head = pointAlongPath(paths.real, 0)
  const tail = pointAlongPath(paths.real, 1)
  const w = bounds.xMaxM - bounds.xMinM
  const h = bounds.yMaxM - bounds.yMinM
  if (!(w > 0) || !(h > 0)) return null
  // 場域座標換成外框比例：u 由西往東、v 由北往南（圖面 v 向下、場域 y 向上）
  const expect = (p: { x: number; y: number }) => {
    let u = (p.x - bounds.xMinM) / w
    let v = (bounds.yMaxM - p.y) / h
    if (rot === 180) {
      u = 1 - u
      v = 1 - v
    }
    return { u, v }
  }
  const e0 = expect(head)
  const e1 = expect(tail)
  const du = e1.u - e0.u
  const dv = e1.v - e0.v
  // 看預期位移比較大的那一軸：另一軸的位移可能只是彎道或量測雜訊
  const useU = Math.abs(du) >= Math.abs(dv)
  const span = useU ? du : dv
  if (Math.abs(span) < MIN_SPAN) return null

  const l0 = pointAlongPath(paths.local, 0)
  const l1 = pointAlongPath(paths.local, 1)
  const localSpan = useU ? l1.x - l0.x : l1.y - l0.y
  if (Math.abs(localSpan) < MIN_SPAN) return null
  return span * localSpan < 0
}

/** 需要倒過來的方塊 id（診斷用） */
export function findReversedTrackGenFacilities(areas: MapAreaObject[]): string[] {
  const out: string[] = []
  for (const area of areas) {
    for (const facility of area.facilities ?? []) {
      if (isTrackGenLocalReversed(facility) === true) out.push(facility.id)
    }
  }
  return out
}

/** 把順序反了的方塊圖面路徑倒過來。沒有要改的就原樣回傳同一個陣列。 */
export function normalizeTrackGenOrientation(areas: MapAreaObject[]): MapAreaObject[] {
  const reversed = new Set(findReversedTrackGenFacilities(areas))
  if (reversed.size === 0) return areas
  return areas.map((area) => {
    if (!area.facilities?.some((f) => reversed.has(f.id))) return area
    return {
      ...area,
      facilities: area.facilities.map((facility) => {
        if (!reversed.has(facility.id)) return facility
        const local = facility.parameters?.[TRACKGEN_LOCAL_PATH_KEY] as PathXY | undefined
        if (!Array.isArray(local)) return facility
        return {
          ...facility,
          parameters: { ...facility.parameters, [TRACKGEN_LOCAL_PATH_KEY]: [...local].reverse() },
        }
      }),
    }
  })
}
