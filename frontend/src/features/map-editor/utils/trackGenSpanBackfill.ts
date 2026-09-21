import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  getTrackGenPaths,
  getTrackGenSpans,
  pointAlongPath,
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

/** 從某一端往本體方向走一小段的單位向量（判斷兩塊接起來是不是走直線） */
function bodyDirection(path: PathXY, atHead: boolean): { x: number; y: number } | null {
  const len = pathLengthOf(path)
  if (!(len > 0.5)) return null
  const f = Math.min(0.5, 6 / len)
  const a = atHead ? pointAlongPath(path, 0) : pointAlongPath(path, 1)
  const b = atHead ? pointAlongPath(path, f) : pointAlongPath(path, 1 - f)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const n = Math.hypot(dx, dy)
  return n > 1e-6 ? { x: dx / n, y: dy / n } : null
}

type Neighbour = {
  /** 鄰居本體從接點往哪走（單位向量） */
  dir: { x: number; y: number } | null
  road: string
  lane: number
  sM: number
  /** 鄰居在接點那一段的<strong>另一頭</strong>里程：兩者相減就是里程離開接點時往哪個方向增加 */
  sOther: number
}

/** 這個鄰居的中心線有沒有一端接在 point 上；有的話回報它在那一端的里程 */
function neighbourAt(
  facility: FacilityObject,
  point: Endpoint,
  /** 自己另一端的位置：鄰居的本體必須在接點的<strong>另一側</strong>，同一側的是疊在一起的兄弟 */
  ownFar: Endpoint,
): Neighbour | null {
  // 交叉軌道有四條並排的分支、好幾組 road／lane，看不出接的是哪一條，不當接續的依據
  if (facility.name === 'RailCross') return null
  const paths = getTrackGenPaths(facility.parameters)
  if (!paths) return null
  const spans = getTrackGenSpans(facility.parameters)
  if (spans.length === 0) return null
  const ends = endpointsOf(paths.real)
  if (!ends) return null

  /*
   * 同一處還有另一塊「往同一邊走」的（例如新拉的替換軌道疊在舊的上面），它不是接續，
   * 是重疊；拿它的里程當接續會把里程往反方向延伸（D20 因此得到 50→124，與 D18 重疊）。
   */
  const otherEnd = near(ends.head, point) ? ends.tail : near(ends.tail, point) ? ends.head : null
  if (!otherEnd) return null
  const sameSide =
    (otherEnd.x - point.x) * (ownFar.x - point.x) + (otherEnd.y - point.y) * (ownFar.y - point.y) > 0
  if (sameSide) return null

  // f=0 那一端對應第一段的 s0，f=1 那一端對應最後一段的 s1
  if (near(ends.head, point)) {
    const first = spans[0]!
    return { dir: bodyDirection(paths.real, true), road: first.road, lane: first.lane, sM: first.s0, sOther: first.s1 }
  }
  if (near(ends.tail, point)) {
    const last = spans[spans.length - 1]!
    return { dir: bodyDirection(paths.real, false), road: last.road, lane: last.lane, sM: last.s1, sOther: last.s0 }
  }
  return null
}

function findNeighbour(
  facilities: readonly FacilityObject[],
  selfId: string,
  point: Endpoint,
  ownFar: Endpoint,
): Neighbour | null {
  for (const f of facilities) {
    if (f.id === selfId) continue
    const hit = neighbourAt(f, point, ownFar)
    if (hit) return hit
  }
  return null
}

function idOrder(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  return Number.isFinite(na) && Number.isFinite(nb) && na !== nb ? na - nb : a.localeCompare(b)
}

/**
 * 里程自相矛盾的軌道：把里程拿掉，讓下面照鄰居重補。
 *
 * 軌道是接起來的，同一條車道上兩塊接在一起，接點的里程必須相同，而且各自往<strong>遠離接點</strong>
 * 的方向走時，一塊增加、一塊減少。不成立（例如接點差了幾十公尺，或兩塊都往同一個方向增加）就是有一塊
 * 的里程錯了——常見於複製、重拉之後里程被延伸到反方向。看不出誰對誰錯時，拿掉<strong>較新</strong>那塊
 * （編號較大）的，因為舊的是生成器給的、新的是重接時補的。
 * 只比 road 與 lane 都相同的鄰居；本體與自己在接點同一側的（疊在一起的兄弟、分岔）不是接續，不比。
 */
export function resetContradictingSpans(facilities: readonly FacilityObject[]): {
  facilities: FacilityObject[]
  reset: string[]
} {
  const tracks = facilities.filter((f) => {
    const p = getTrackGenPaths(f.parameters)
    return f.type === 'Track' && p && getTrackGenSpans(f.parameters).length > 0
  })
  const doomed = new Set<string>()
  for (const x of tracks) {
    const px = getTrackGenPaths(x.parameters)!
    const sx = getTrackGenSpans(x.parameters)
    const ends = endpointsOf(px.real)
    if (!ends) continue
    for (const atHead of [true, false]) {
      const point = atHead ? ends.head : ends.tail
      const far = atHead ? ends.tail : ends.head
      const mine = atHead
        ? { road: sx[0]!.road, lane: sx[0]!.lane, s: sx[0]!.s0, other: sx[0]!.s1 }
        : { road: sx[sx.length - 1]!.road, lane: sx[sx.length - 1]!.lane, s: sx[sx.length - 1]!.s1, other: sx[sx.length - 1]!.s0 }
      for (const y of tracks) {
        if (y.id === x.id || idOrder(y.id, x.id) > 0) continue // 每一對只從較新的那塊出發看一次
        const nb = neighbourAt(y, point, far)
        if (!nb || nb.road !== mine.road || nb.lane !== mine.lane) continue
        const dx = Math.sign(mine.other - mine.s)
        const dn = Math.sign(nb.sOther - nb.sM)
        if (Math.abs(mine.s - nb.sM) > 2 || (dx !== 0 && dx === dn)) doomed.add(x.id)
      }
    }
  }
  if (doomed.size === 0) return { facilities: [...facilities], reset: [] }
  const reset: string[] = []
  const next = facilities.map((f) => {
    if (!doomed.has(f.id)) return f
    const params = { ...(f.parameters ?? {}) } as Record<string, unknown>
    delete params[TRACKGEN_SPANS_KEY]
    reset.push(f.customName?.trim() || f.id)
    return { ...f, parameters: params } as FacilityObject
  })
  return { facilities: next, reset }
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
  /** 里程自相矛盾、已拿掉重補的軌道 */
  reset: string[]
} {
  const filled: TrackGenSpanBackfill[] = []
  const skipped: string[] = []
  const resetLabels: string[] = []
  let changed = false

  const next = areas.map((area) => {
    const cleared = resetContradictingSpans(area.facilities)
    const facilities = cleared.facilities
    resetLabels.push(...cleared.reset)
    let areaChanged = cleared.reset.length > 0
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

      const head = findNeighbour(facilities, facility.id, ends.head, ends.tail)
      const tail = findNeighbour(facilities, facility.id, ends.tail, ends.head)
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
        let nb = (head ?? tail)!
        /*
         * 兩端各接一條不同的 road（一頭接直線的原車道，一頭接轉角的另一條 road）：
         * 這一塊屬於<strong>接起來走直線</strong>的那一條——轉角是另一條 road 的開頭。
         */
        if (head && tail) {
          const own = (atHead: boolean) => bodyDirection(paths.real, atHead)
          const straight = (n: Neighbour, atHead: boolean) => {
            const d = own(atHead)
            return d && n.dir ? -(d.x * n.dir.x + d.y * n.dir.y) : -2
          }
          nb = straight(head, true) >= straight(tail, false) ? head : tail
        }
        const useHead = nb === head
        const outward = Math.sign(nb.sOther - nb.sM) === 0 ? 1 : -Math.sign(nb.sOther - nb.sM)
        const len = pathLengthOf(paths.real)
        const sMatched = nb.sM
        const sFar = Number((sMatched + outward * len).toFixed(2))
        span = useHead
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

  return { areas: changed ? next : areas, filled, skipped, reset: resetLabels }
}
