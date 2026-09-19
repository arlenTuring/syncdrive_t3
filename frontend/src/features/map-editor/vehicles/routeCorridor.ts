import type { MapAreaObject } from '../types/area'
import type { MapPlannedRoute } from '../types/mapFile'
import { getDockingPointStationId } from '../utils/dockingPointFacility'
import { getRefFieldPosition } from '../utils/facilityRefFieldPosition'
import { locateByField, type TrackGenIndex } from '../utils/trackGenLocate'
import { pointAlongPath, tangentAlongPath } from '../utils/trackGenPaths'

/**
 * 訂單路線 → 車可能在哪幾塊軌道上。
 *
 * <h3>為什麼要有這個</h3>
 * 位置分不出的時候（上下行只差三公尺、分岔口），方向與上一筆只是旁證。訂單本身還告訴
 * 我們一件事：<strong>這台車正在往哪一站開，從哪一站來</strong>。那兩站之間沿路網走得到
 * 的軌道才是它該在的地方；旁邊不在路線上的軌道，離得再近也只是巧合。
 *
 * <h3>做法</h3>
 * <pre>
 *   站   DockingPoint 的場域座標 → 落在哪一塊軌道
 *   圖   軌道為節點，端點相接為邊；只能順著這一塊的行車方向走（反向車道另一塊，不相連）
 *   路   對地圖上每條路線的每一段（前一站 → 這一站）走最短路，路上的軌道就是走廊
 *   鍵   走廊記在「這一段的終點站」下面——車的 current_leg.target_station_id 就是它
 * </pre>
 * 同一個終點站可能被好幾條路線的不同段抵達，走廊取聯集。
 *
 * <h3>它只是加減分</h3>
 * 走廊外的軌道在挑塊時多扣一點分（見 locateByField 的 corridorFacilityIds），跟方向、
 * 連續性一樣，只在「位置分不出來」的候選之間決定。站沒放在路網上、路線接不起來、
 * 目標不是站（進出場的入口點）時沒有走廊，等於沒有這條旁證，不會讓車無處可去。
 */

export type RouteCorridors = {
  /** 終點站代號 → 走廊上的軌道（設施 id） */
  byTargetStation: Map<string, ReadonlySet<string>>
  /** 有解出座標落在軌道上的站，診斷用 */
  resolvedStations: Map<string, string>
}

/** 兩個端點靠這麼近才算接在一起（公尺），跟軌道相連的判定同一個量級 */
const JOIN_TOL_M = 1.5

/**
 * 圖資上兩段之間可能少了一截軌道（實測 D04/T01 → D05 之間空了約 19 公尺）。車照樣開過去，
 * 走廊不能因此斷在那裡。端點離得不太遠、而且方向接得起來的，當成「橋」接上，走這一截
 * 多算一點路程（GAP_COST），有實際相連的路可走時不會選橋。
 *
 * 方向接得起來＝離開這一段的方向、往對方的連線、進入對方的方向，兩兩夾角都在 50 度內。
 * 這一條擋掉上下行兩條車道在端點附近「掉頭」相接（兩端只差三公尺多，方向相反）。
 */
const BRIDGE_MAX_M = 25
/** 橫向錯開一條車道寬以內：合併、分岔的地方 */
const LANE_SHIFT_M = 4.5
const LANE_SHIFT_FIXED_COST_M = 5
const BRIDGE_ANGLE_RAD = (50 * Math.PI) / 180
const GAP_COST = 1

/** 逆著記錄的行車方向走一段，路程乘這個係數 */
const AGAINST_COST = 4
/** 搭橋的固定代價：有實際相連的軌道就不要選橋 */
const BRIDGE_FIXED_COST_M = 30

type PieceGraph = {
  /** 每一段（span）兩端的場域座標：0＝折線上 f0 那一端、1＝f1 那一端 */
  ends: [number, number][][]
  /** 從哪一端進來，這一段允不允許；目前兩端都行（見 pieceGraph） */
  canEnter: [boolean, boolean][]
  /** 從 0／1 端進來走完這一段，路程要乘的係數：順著記錄的行車方向是 1，逆著是 AGAINST_COST */
  against: [number, number][]
  lengthM: number[]
  /** 端點靠得夠近的（段, 端）配對；bridge＝中間有空隙，cost 是接這一截多算的路程 */
  links: Map<string, { piece: number; end: 0 | 1; extra: number }[]>
}

const graphCache = new WeakMap<TrackGenIndex, PieceGraph>()

/**
 * 以<strong>段</strong>（span）為節點建圖，不是以整塊設施。
 *
 * 一塊設施的折線可以帶好幾段（交叉軌道有四條腿、加岔的 D04/T01 一頭接正線、一頭岔出去），
 * 整條折線的兩端不是每一段的兩端。用整塊的端點接，岔口與交叉的地方就接不起來。
 */
function pieceGraph(index: TrackGenIndex): PieceGraph {
  const hit = graphCache.get(index)
  if (hit) return hit
  const ends: [number, number][][] = []
  const canEnter: [boolean, boolean][] = []
  const against: [number, number][] = []
  const lengthM: number[] = []
  for (const p of index.pieces) {
    const a = pointAlongPath(p.real, p.f0)
    const b = pointAlongPath(p.real, p.f1)
    ends.push([
      [a.x, a.y],
      [b.x, b.y],
    ])
    /*
     * 行車方向不當硬限制，逆向走只是走起來貴很多（AGAINST_COST）。
     *
     * 硬擋的話，圖資裡幾塊記錯方向的（實測 D15 跟前後的 D14／D16 相反）會讓走廊憑空斷掉；
     * 完全不看方向又會在兩條平行車道間隨便挑一條，選到對向車道。逆向貴四倍：有順向的路
     * 就走順向，順向的路真的斷了才勉強逆著走。
     */
    canEnter.push([true, true])
    against.push([p.bidirectional ? 1 : p.againstPath ? AGAINST_COST : 1, p.bidirectional ? 1 : p.againstPath ? 1 : AGAINST_COST])
    lengthM.push((index.lengthM.get(p.facilityId) ?? 0) * Math.abs(p.f1 - p.f0))
  }
  /** 離開第 i 段的 e 端時，往外的行進方向（弧度） */
  const leaving = (i: number, e: 0 | 1): number => {
    const p = index.pieces[i]!
    const t = tangentAlongPath(p.real, e === 1 ? p.f1 : p.f0)
    const rad = Math.atan2(t.y, t.x)
    return e === 1 ? rad : rad + Math.PI
  }
  /** 從第 k 段的 e 端走進去時的行進方向 */
  const entering = (k: number, e: 0 | 1): number => leaving(k, e) + Math.PI
  const gap = (a: number, b: number) => {
    const d = Math.abs(a - b) % (Math.PI * 2)
    return d > Math.PI ? Math.PI * 2 - d : d
  }
  const links = new Map<string, { piece: number; end: 0 | 1; extra: number }[]>()
  for (let i = 0; i < ends.length; i += 1) {
    for (const ei of [0, 1] as const) {
      const [x, y] = ends[i]![ei]!
      const list: { piece: number; end: 0 | 1; extra: number }[] = []
      for (let k = 0; k < ends.length; k += 1) {
        if (k === i) continue
        for (const ek of [0, 1] as const) {
          const [x2, y2] = ends[k]![ek]!
          const d = Math.hypot(x - x2, y - y2)
          if (d <= JOIN_TOL_M) {
            list.push({ piece: k, end: ek, extra: 0 })
          } else if (d <= LANE_SHIFT_M) {
            // 橫向錯開一條車道寬（合併／分岔的地方，例如 D34 → D35/U35 差 3.4 公尺）：
            // 連線幾乎垂直於行車方向，不能用「往前連」的方向檢查；只要求進出方向一致，
            // 這樣掉頭（方向相反）的相接照樣會被擋掉
            if (gap(leaving(i, ei), entering(k, ek)) <= BRIDGE_ANGLE_RAD) {
              list.push({ piece: k, end: ek, extra: d + LANE_SHIFT_FIXED_COST_M })
            }
          } else if (d <= BRIDGE_MAX_M) {
            const bearing = Math.atan2(y2 - y, x2 - x)
            const out = leaving(i, ei)
            const inn = entering(k, ek)
            if (
              gap(bearing, out) <= BRIDGE_ANGLE_RAD &&
              gap(bearing, inn) <= BRIDGE_ANGLE_RAD &&
              gap(out, inn) <= BRIDGE_ANGLE_RAD
            ) {
              list.push({ piece: k, end: ek, extra: d * GAP_COST + BRIDGE_FIXED_COST_M })
            }
          }
        }
      }
      links.set(`${i}|${ei}`, list)
    }
  }
  const graph = { ends, canEnter, against, lengthM, links }
  graphCache.set(index, graph)
  return graph
}

/**
 * from 那一段走到 to 那一段，最短路上經過的設施。
 *
 * 起點那一段從允許的那一端出發（不知道站在這一段的哪個位置，整段都算）。找不到路回 null。
 */
export function shortestCorridor(
  index: TrackGenIndex,
  fromPiece: number,
  toPiece: number,
): Set<string> | null {
  if (fromPiece === toPiece) return new Set([index.pieces[fromPiece]!.facilityId])
  const g = pieceGraph(index)

  // Dijkstra：狀態＝（段，從哪一端進來）。從 entry 進、走完這一段到 1-entry 出，再接下一段。
  const dist = new Map<string, number>()
  const prev = new Map<string, string | null>()
  const queue: { key: string; piece: number; entry: 0 | 1; cost: number }[] = []
  const push = (piece: number, entry: 0 | 1, cost: number, from: string | null) => {
    if (!g.canEnter[piece]![entry]) return
    const key = `${piece}|${entry}`
    if ((dist.get(key) ?? Infinity) <= cost) return
    dist.set(key, cost)
    prev.set(key, from)
    queue.push({ key, piece, entry, cost })
  }
  push(fromPiece, 0, 0, null)
  push(fromPiece, 1, 0, null)

  while (queue.length) {
    queue.sort((m, n) => m.cost - n.cost)
    const { key, piece, entry, cost } = queue.shift()!
    if (cost > (dist.get(key) ?? Infinity)) continue
    if (piece === toPiece) return facilitiesOn(index, prev, key)
    const exitEnd: 0 | 1 = entry === 0 ? 1 : 0
    const through = piece === fromPiece ? 0 : g.lengthM[piece]! * g.against[piece]![entry]!
    for (const l of g.links.get(`${piece}|${exitEnd}`) ?? []) {
      push(l.piece, l.end, cost + through + l.extra, key)
    }
  }
  return null
}

function facilitiesOn(index: TrackGenIndex, prev: Map<string, string | null>, endKey: string): Set<string> {
  const out = new Set<string>()
  let k: string | null = endKey
  while (k) {
    out.add(index.pieces[Number(k.split('|')[0])]!.facilityId)
    k = prev.get(k) ?? null
  }
  return out
}

/**
 * 走廊上兩頭都接著走廊的軌道也算進來。
 *
 * 最短路可能用「橋」跳過中間一塊短的（例如 D02），那一塊車照樣會經過；不補的話它在挑塊時
 * 會被當成「不在路線上」多扣分。
 */
function fillHoles(index: TrackGenIndex, path: ReadonlySet<string>): Set<string> {
  const out = new Set(path)
  for (const [id, joins] of index.joins) {
    if (out.has(id)) continue
    const at = [false, false]
    for (const j of joins) if (path.has(j.to)) at[j.end] = true
    if (at[0] && at[1]) out.add(id)
  }
  return out
}

/** 每個站放在哪一段軌道上（純取最近，站沒有行車方向可比）：站代號 → pieces 的索引 */
export function resolveStationPieces(
  areas: MapAreaObject[],
  index: TrackGenIndex,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const area of areas) {
    for (const facility of area.facilities ?? []) {
      if (facility.type !== 'DockingPoint') continue
      const stationId = getDockingPointStationId(facility)
      if (!stationId) continue
      const { xM, yM } = getRefFieldPosition(facility.parameters)
      if (xM === null || yM === null) continue
      const hit = locateByField(index, xM, yM)
      if (!hit) continue
      // locateByField 只回設施與路網位置，段要用（設施、road、lane、走了幾成）再找回來
      const i = index.pieces.findIndex(
        (p) =>
          p.facilityId === hit.facilityId &&
          p.road === hit.road &&
          p.lane === hit.lane &&
          hit.along >= Math.min(p.f0, p.f1) - 1e-6 &&
          hit.along <= Math.max(p.f0, p.f1) + 1e-6,
      )
      if (i >= 0) out.set(stationId, i)
    }
  }
  return out
}

export function buildRouteCorridors(
  areas: MapAreaObject[],
  routes: readonly Pick<MapPlannedRoute, 'stationIds'>[],
  index: TrackGenIndex | null | undefined,
): RouteCorridors {
  const byTargetStation = new Map<string, Set<string>>()
  if (!index) return { byTargetStation, resolvedStations: new Map() }
  const stationPiece = resolveStationPieces(areas, index)

  for (const route of routes) {
    // 站序裡查不到軌道的（途經點、交叉軌道接口）跳過，前後兩個查得到的站照樣連得起來
    const known = route.stationIds.filter((id) => stationPiece.has(id))
    for (let i = 1; i < known.length; i += 1) {
      const from = stationPiece.get(known[i - 1]!)!
      const to = stationPiece.get(known[i]!)!
      const path = shortestCorridor(index, from, to)
      if (!path) continue
      const key = known[i]!
      const merged = byTargetStation.get(key) ?? new Set<string>()
      for (const id of fillHoles(index, path)) merged.add(id)
      byTargetStation.set(key, merged)
    }
  }
  const resolvedStations = new Map<string, string>()
  for (const [id, i] of stationPiece) resolvedStations.set(id, index.pieces[i]!.facilityId)
  return { byTargetStation, resolvedStations }
}

/** 車現在往哪一站開（operation/update 的 current_leg.target_station_id） */
export function readTargetStationId(payload: Record<string, unknown> | undefined): string | null {
  const leg = payload?.current_leg
  if (!leg || typeof leg !== 'object') return null
  const id = (leg as { target_station_id?: unknown }).target_station_id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}
