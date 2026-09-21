import type { MapAreaObject } from '../types/area'
import type { MapPlannedRoute } from '../types/mapFile'
import { getDockingPointStationId } from '../utils/dockingPointFacility'
import { getWaypointCode } from '../utils/waypointFacility'
import { getRefFieldPosition } from '../utils/facilityRefFieldPosition'
import { locateByField, type TrackGenIndex } from '../utils/trackGenLocate'
import { pointAlongPath } from '../utils/trackGenPaths'

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
 *   圖   軌道為節點，端點相接為邊；只看相連，沒有方向
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

/** 兩個端點靠這麼近才算接在一起（公尺）。相接的軌道共用接點，端點座標一致，這個量只是浮點餘裕。 */
const JOIN_TOL_M = 1.5

type PieceGraph = {
  /** 每一段（span）兩端的場域座標：0＝折線上 f0 那一端、1＝f1 那一端 */
  ends: [number, number][][]
  lengthM: number[]
  /** 端點接在一起的（段, 端）配對 */
  links: Map<string, { piece: number; end: 0 | 1 }[]>
}

const graphCache = new WeakMap<TrackGenIndex, PieceGraph>()

/**
 * 以<strong>段</strong>（span）為節點建圖，不是以整塊設施。
 *
 * 一塊設施的折線可以帶好幾段（交叉軌道有四條腿），整條折線的兩端不是每一段的兩端。
 *
 * <h3>只看軌道相連，沒有方向</h3>
 * 端點接在一起就是相連，走的時候沒有「順向／逆向」，也不會因為方向不同就擋掉。軌道是色塊，
 * 相接由接點保證（見 utils/trackJoints），所以不再用距離猜「差一條車道寬算不算接上」、
 * 「空了一截要不要搭橋」——那些都要靠行進方向才分得出是接續還是掉頭。
 */
function pieceGraph(index: TrackGenIndex): PieceGraph {
  const hit = graphCache.get(index)
  if (hit) return hit
  const ends: [number, number][][] = []
  const lengthM: number[] = []
  for (const p of index.pieces) {
    const a = pointAlongPath(p.real, p.f0)
    const b = pointAlongPath(p.real, p.f1)
    ends.push([
      [a.x, a.y],
      [b.x, b.y],
    ])
    lengthM.push((index.lengthM.get(p.facilityId) ?? 0) * Math.abs(p.f1 - p.f0))
  }
  const links = new Map<string, { piece: number; end: 0 | 1 }[]>()
  for (let i = 0; i < ends.length; i += 1) {
    for (const ei of [0, 1] as const) {
      const [x, y] = ends[i]![ei]!
      const list: { piece: number; end: 0 | 1 }[] = []
      for (let k = 0; k < ends.length; k += 1) {
        if (k === i) continue
        for (const ek of [0, 1] as const) {
          const [x2, y2] = ends[k]![ek]!
          if (Math.hypot(x - x2, y - y2) <= JOIN_TOL_M) list.push({ piece: k, end: ek })
        }
      }
      links.set(`${i}|${ei}`, list)
    }
  }
  const graph = { ends, lengthM, links }
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
    const through = piece === fromPiece ? 0 : g.lengthM[piece]!
    for (const l of g.links.get(`${piece}|${exitEnd}`) ?? []) {
      push(l.piece, l.end, cost + through, key)
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
      /*
       * 停靠點與途經點都算「站」：進出分區的路線，起訖是分區入口的途經點。它落在軌道的端點上
       * （T02／T03 共用的那個接點），少了它走廊就找不到，只剩車頭朝向決定判給哪一塊，
       * 車在 T03、D20、T02 之間來回換。
       */
      if (facility.type !== 'DockingPoint' && facility.type !== 'Waypoint') continue
      const stationId =
        facility.type === 'DockingPoint' ? getDockingPointStationId(facility) : getWaypointCode(facility)
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
