import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  getTrackGenPaths,
  getTrackGenSpans,
  TRACKGEN_SPANS_KEY,
  type PathXY,
  type TrackGenSpan,
} from './trackGenPaths'

/**
 * 有中心線卻沒有里程對應的方塊，照鄰居把里程接回來。
 *
 * <h3>沒有里程會怎樣</h3>
 * 車輛定位的主索引 {@link buildTrackGenIndex} 開頭就寫著
 * <code>if (!spans.length) continue</code>——沒有里程對應的方塊<strong>根本不會成為
 * 候選</strong>。它照樣畫在圖上、照樣出現在路網清單裡，只是永遠不會被選中。
 *
 * 落在它上面的點於是被判給附近<strong>別的</strong>方塊。T3 實測：D18 自己中心線上
 * 的九個取樣點，七個被判給對向的 U18／U19——下行的車畫到上行的軌道上。健檢報的是
 * D18 往返誤差 18 公尺，看起來像座標算錯，其實是這一塊從來沒進過索引。
 *
 * <h3>里程怎麼接回來</h3>
 * 兩端各找一個中心線端點重合、而且身上有里程的鄰居，取它在那一端的里程值。
 * 兩邊的 road 與 lane 必須一致，否則接的不是同一條車道，寧可不補。
 *
 * <code>h</code>（行車方向）不補：它是選填的，索引沒有時會退回這一塊自己的路徑方向。
 * 憑空算一個反而可能跟鄰居打架——D18 退回算出 1.6035，與 D19 的 1.5691、U18 的
 * 1.6145 本來就一致。
 */

/** 兩條中心線的端點差多少算同一點（公尺） */
const JOINT_TOLERANCE_M = 1.5

type Endpoint = { x: number; y: number }

function endpointsOf(path: PathXY): { head: Endpoint; tail: Endpoint } | null {
  if (path.length < 2) return null
  const a = path[0]!
  const b = path[path.length - 1]!
  return { head: { x: a[0], y: a[1] }, tail: { x: b[0], y: b[1] } }
}

function pathLengthOf(path: PathXY): number {
  let total = 0
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1])
  }
  return total
}

function near(a: Endpoint, b: Endpoint): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= JOINT_TOLERANCE_M
}

type Neighbour = {
  road: string
  lane: number
  sM: number
  /** 鄰居在它<strong>另一端</strong>的里程：兩者相減就是里程往哪個方向增加 */
  sOther: number
}

/** 這個鄰居的中心線有沒有一端接在 point 上；有的話回報它在那一端的里程 */
function neighbourAt(
  facility: FacilityObject,
  point: Endpoint,
): Neighbour | null {
  const paths = getTrackGenPaths(facility.parameters)
  if (!paths) return null
  const spans = getTrackGenSpans(facility.parameters)
  if (spans.length === 0) return null
  const ends = endpointsOf(paths.real)
  if (!ends) return null

  // f=0 那一端對應第一段的 s0，f=1 那一端對應最後一段的 s1
  if (near(ends.head, point)) {
    const first = spans[0]!
    return { road: first.road, lane: first.lane, sM: first.s0, sOther: spans[spans.length - 1]!.s1 }
  }
  if (near(ends.tail, point)) {
    const last = spans[spans.length - 1]!
    return { road: last.road, lane: last.lane, sM: last.s1, sOther: spans[0]!.s0 }
  }
  return null
}

function findNeighbour(
  facilities: readonly FacilityObject[],
  selfId: string,
  point: Endpoint,
): Neighbour | null {
  for (const f of facilities) {
    if (f.id === selfId) continue
    const hit = neighbourAt(f, point)
    if (hit) return hit
  }
  return null
}

export type TrackGenSpanBackfill = {
  name: string
  id: string
  road: string
  lane: number
  s0: number
  s1: number
}

export function backfillTrackGenSpansInAreas(areas: MapAreaObject[]): {
  areas: MapAreaObject[]
  filled: TrackGenSpanBackfill[]
  skipped: string[]
} {
  const filled: TrackGenSpanBackfill[] = []
  const skipped: string[] = []
  let changed = false

  const next = areas.map((area) => {
    const facilities = area.facilities
    let areaChanged = false
    const nextFacilities = facilities.map((facility) => {
      const paths = getTrackGenPaths(facility.parameters)
      if (!paths) return facility
      if (getTrackGenSpans(facility.parameters).length > 0) return facility

      const label = facility.customName?.trim() || facility.id
      const ends = endpointsOf(paths.real)
      if (!ends) {
        skipped.push(label)
        return facility
      }

      const head = findNeighbour(facilities, facility.id, ends.head)
      const tail = findNeighbour(facilities, facility.id, ends.tail)
      let span: TrackGenSpan
      if (head && tail && head.road === tail.road && head.lane === tail.lane) {
        // 兩端接的是同一條車道：里程取兩端鄰居的值
        span = { road: head.road, lane: head.lane, s0: head.sM, s1: tail.sM, h: null, f0: 0, f1: 1 }
      } else if (head || tail) {
        /*
         * 只有一端接得上同一條車道（另一端接到別條 road，例如換掉分岔的一般軌道，一頭是原車道、一頭
         * 已經是轉角的另一條 road）：從接得上的那一端延伸，長度取自己的中心線，往哪個方向增加則
         * 接續鄰居——鄰居的里程往它內側增加，往外就是減少。憑空編一個里程不行，接續是有依據的。
         */
        const nb = (head ?? tail)!
        const outward = Math.sign(nb.sOther - nb.sM) === 0 ? 1 : -Math.sign(nb.sOther - nb.sM)
        const len = pathLengthOf(paths.real)
        const sMatched = nb.sM
        const sFar = Number((sMatched + outward * len).toFixed(2))
        span = head
          ? { road: nb.road, lane: nb.lane, s0: sMatched, s1: sFar, h: null, f0: 0, f1: 1 }
          : { road: nb.road, lane: nb.lane, s0: sFar, s1: sMatched, h: null, f0: 0, f1: 1 }
      } else {
        skipped.push(label)
        return facility
      }
      filled.push({
        name: label,
        id: facility.id,
        road: span.road,
        lane: span.lane,
        s0: span.s0,
        s1: span.s1,
      })
      areaChanged = true
      return {
        ...facility,
        parameters: {
          ...(facility.parameters ?? {}),
          [TRACKGEN_SPANS_KEY]: [span],
        },
      }
    })
    if (!areaChanged) return area
    changed = true
    return { ...area, facilities: nextFacilities }
  })

  return { areas: changed ? next : areas, filled, skipped }
}
