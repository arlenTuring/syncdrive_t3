import type { MapAreaObject } from '../types/area'
import { collectStationsFromAreas } from './dockingPointStationId'
import {
  resolveCrossoverPortalRouteStopMapPx,
  resolveCrossPortalRouteStopMapPx,
  resolveDockingPointNodeMapPx,
  resolveFacilityDockingRouteStopMapPx,
  resolveRouteStationPoints,
  stationDisplayLabel,
  type RouteStationPoint,
} from './routePlanning'
import {
  collectCrossoverPortalWaypointsFromAreas,
  collectCrossPortalWaypointsFromAreas,
  collectWaypointsFromAreas,
} from './waypointCode'
import {
  getCrossoverPortals,
  parseCrossoverPortalTopologyNodeId,
} from './trackCrossoverFacility'
import {
  areaPositionToCssTopLeft,
  meterToAreaLocalPx,
} from './areaCoords'
import {
  buildContinuousChainPathForTrackIds,
  buildTrackRoutingContext,
  fieldPointToMapPx,
  sampleTrackSegmentBetweenFieldPoints,
} from './trackConnectivityScan'
import {
  adjWithCrossoverBridges,
  buildMapPathBetweenTrackSnaps,
  collectCrossoverBridges,
  indexCrossoverBridges,
  type CrossoverBridge,
} from './trackCrossoverRouting'
import {
  findRefFieldSegmentsAtPoint,
  pickRefFieldSegment,
} from '../vehicles/trackNetwork/locate'
import { buildTrackNetwork } from '../vehicles/trackNetwork/scanMap'
import type { TrackNetworkSegment } from '../vehicles/trackNetwork/types'
import type { PointTopology } from '../types/pointTopology'
import {
  buildTopologyStationLegBreakdown,
} from './topologyRouteTravel'

const SNAP_MAX_M = 12
/** 點在軌道中心線延長線上、僅超出端點時允許的縱向懸伸（臨停格超出軌道端） */
const SNAP_MAX_ALONG_OVERHANG_M = 55
/** 懸伸吸附時離中心線的最大橫向偏差（須小於上下行走廊間距，避免吸到對向股） */
/** 站標離軌道中心線多遠就算「不在軌道上」（圖面像素） */
const MAP_PX_SNAP_MAX = 60

const SNAP_MAX_LATERAL_M = 1.75
/**
 * 路線站序續吸同股時可略放寬橫向（停靠點常貼邊界）；
 * 仍須明顯小於上下行間距，避免真的跨到對向股。
 */
const SNAP_CONTINUITY_MAX_LATERAL_M = 2.6
/** 站標接到軌道路徑的允許 stub 長度（px）；超過視為吸錯股／跨走廊，改標斷線 */
const MAX_STITCH_STUB_PX = 48

type TrackSnap = {
  trackId: string
  xM: number
  yM: number
  mapPx: { x: number; y: number }
}

export type RouteLegWarning = {
  fromStationId: string
  toStationId: string
  message: string
}

export type RoutePreviewGeometry = {
  stations: RouteStationPoint[]
  /** 各站間成功段的拼接（供時間標籤中點等）；繪製請用 pathLegs */
  pathPx: Array<{ x: number; y: number }>
  /** 依站序每一段的軌道折線（分段繪製，避免失敗段造成跨空白跳線） */
  pathLegs: Array<Array<{ x: number; y: number }>>
  /** 無法沿軌道連接的站間段（直線標示問題區） */
  brokenLegs: Array<Array<{ x: number; y: number }>>
  warnings: RouteLegWarning[]
  followsTracks: boolean
}

function projectOntoSegmentCenterline(
  xM: number,
  yM: number,
  seg: TrackNetworkSegment,
): {
  xM: number
  yM: number
  dist: number
  lateral: number
  alongOverhang: number
} {
  const b = seg.bounds
  if (seg.horizontal) {
    const cy = (b.yMinM + b.yMaxM) / 2
    const cx = Math.min(b.xMaxM, Math.max(b.xMinM, xM))
    const lateral = Math.abs(yM - cy)
    const alongOverhang =
      xM < b.xMinM ? b.xMinM - xM : xM > b.xMaxM ? xM - b.xMaxM : 0
    return {
      xM: cx,
      yM: cy,
      dist: Math.hypot(xM - cx, yM - cy),
      lateral,
      alongOverhang,
    }
  }
  const cx = (b.xMinM + b.xMaxM) / 2
  const cy = Math.min(b.yMaxM, Math.max(b.yMinM, yM))
  const lateral = Math.abs(xM - cx)
  const alongOverhang =
    yM < b.yMinM ? b.yMinM - yM : yM > b.yMaxM ? yM - b.yMaxM : 0
  return {
    xM: cx,
    yM: cy,
    dist: Math.hypot(xM - cx, yM - cy),
    lateral,
    alongOverhang,
  }
}

function isWithinSnapDistance(projected: {
  dist: number
  lateral: number
  alongOverhang: number
}): boolean {
  // 上下行走廊中心約差 3.5m：橫向超限一律不吸，避免站在 U 卻接到 D
  if (projected.lateral > SNAP_MAX_LATERAL_M) return false
  if (projected.alongOverhang <= 0 && projected.dist <= SNAP_MAX_M) return true
  // 臨停格：貼中心線但略超出軌道端點
  return (
    projected.alongOverhang > 0
    && projected.alongOverhang <= SNAP_MAX_ALONG_OVERHANG_M
  )
}

function isWithinContinuitySnapDistance(projected: {
  dist: number
  lateral: number
  alongOverhang: number
}): boolean {
  if (projected.lateral > SNAP_CONTINUITY_MAX_LATERAL_M) return false
  if (projected.alongOverhang <= 0 && projected.dist <= SNAP_MAX_M) return true
  return (
    projected.alongOverhang > 0
    && projected.alongOverhang <= SNAP_MAX_ALONG_OVERHANG_M
  )
}

function uniqueSegments(
  segments: TrackNetworkSegment[],
): TrackNetworkSegment[] {
  const byId = new Map<string, TrackNetworkSegment>()
  for (const seg of segments) {
    if (!byId.has(seg.trackId)) byId.set(seg.trackId, seg)
  }
  return [...byId.values()]
}

function snapFieldPointToTrack(
  xM: number,
  yM: number,
  segmentById: Map<string, TrackNetworkSegment>,
): TrackSnap | null {
  const candidates = listSnapCandidates(xM, yM, segmentById)
  return candidates[0] ?? null
}

/** 距離由近到遠的吸附候選（同一軌道只留最近投影；優先橫向最近＝同走廊） */
function listSnapCandidates(
  xM: number,
  yM: number,
  segmentById: Map<string, TrackNetworkSegment>,
): Array<TrackSnap & { dist: number; lateral: number }> {
  const byTrack = new Map<string, TrackSnap & { dist: number; lateral: number }>()

  const network = { segments: [...segmentById.values()] }
  const atPoint = pickRefFieldSegment(findRefFieldSegmentsAtPoint(network, xM, yM))
  const consider = (seg: TrackNetworkSegment) => {
    const projected = projectOntoSegmentCenterline(xM, yM, seg)
    if (!isWithinSnapDistance(projected)) return
    const mapPx = fieldPointToMapPx(projected.xM, projected.yM, seg)
    if (!mapPx) return
    const prev = byTrack.get(seg.trackId)
    if (prev && prev.dist <= projected.dist) return
    byTrack.set(seg.trackId, {
      trackId: seg.trackId,
      xM: projected.xM,
      yM: projected.yM,
      mapPx,
      dist: projected.dist,
      lateral: projected.lateral,
    })
  }

  if (atPoint) consider(atPoint)
  for (const seg of segmentById.values()) consider(seg)

  return [...byTrack.values()].sort((a, b) => {
    if (a.lateral !== b.lateral) return a.lateral - b.lateral
    return a.dist - b.dist
  })
}

function bfsTrackPath(
  adj: Map<string, Set<string>>,
  fromId: string,
  toId: string,
): string[] | null {
  if (fromId === toId) return [fromId]
  const queue: string[] = [fromId]
  const prev = new Map<string, string | null>([[fromId, null]])
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur === toId) {
      const path: string[] = []
      let n: string | null = toId
      while (n) {
        path.unshift(n)
        n = prev.get(n) ?? null
      }
      return path
    }
    for (const next of adj.get(cur) ?? []) {
      if (prev.has(next)) continue
      prev.set(next, cur)
      queue.push(next)
    }
  }
  return null
}

function segmentLengthM(seg: TrackNetworkSegment): number {
  const b = seg.bounds
  if (seg.horizontal) return Math.max(0.01, b.xMaxM - b.xMinM)
  return Math.max(0.01, b.yMaxM - b.yMinM)
}

/** 以軌道長度加權找最短軌道路徑（避免跳數最短卻繞出空白區） */
function shortestTrackPath(
  adj: Map<string, Set<string>>,
  segmentById: Map<string, TrackNetworkSegment>,
  fromId: string,
  toId: string,
): string[] | null {
  if (fromId === toId) return [fromId]
  const dist = new Map<string, number>([[fromId, 0]])
  const prev = new Map<string, string | null>([[fromId, null]])
  const pending = new Set<string>([fromId])

  while (pending.size > 0) {
    let cur: string | null = null
    let best = Infinity
    for (const id of pending) {
      const d = dist.get(id) ?? Infinity
      if (d < best) {
        best = d
        cur = id
      }
    }
    if (cur == null) break
    pending.delete(cur)
    if (cur === toId) break

    const curSeg = segmentById.get(cur)
    for (const next of adj.get(cur) ?? []) {
      const nextSeg = segmentById.get(next)
      if (!nextSeg) continue
      // 進入下一段時加上該段長度；同向銜接較自然
      const step =
        segmentLengthM(nextSeg) * 0.5 + (curSeg ? segmentLengthM(curSeg) * 0.5 : 0)
      const nd = best + step
      if (nd >= (dist.get(next) ?? Infinity)) continue
      dist.set(next, nd)
      prev.set(next, cur)
      pending.add(next)
    }
  }

  if (!prev.has(toId) && fromId !== toId) {
    // 加權失敗時退回跳數 BFS（仍只走軌道）
    return bfsTrackPath(adj, fromId, toId)
  }

  const path: string[] = []
  let n: string | null = toId
  while (n) {
    path.unshift(n)
    n = prev.get(n) ?? null
  }
  return path.length > 0 ? path : null
}

function appendPathPoints(
  target: Array<{ x: number; y: number }>,
  segment: Array<{ x: number; y: number }>,
) {
  for (const p of segment) {
    const last = target[target.length - 1]
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.5) continue
    target.push(p)
  }
}

const ORTHO_EPS_PX = 0.75
/** 畫面站標幾乎共線水平：視為同一走廊站序，可補直連 */
const BADGE_CORRIDOR_ALIGN_MAX_DY_PX = 28
const BADGE_CORRIDOR_ALIGN_MIN_DX_PX = 6
const BADGE_CORRIDOR_ALIGN_MAX_DX_PX = 520

/**
 * 兩點之間改成直角折線（先水平再垂直，或先垂直再水平）。
 * 不參考拓撲；只用站位／吸附點座標。
 */
export function rightAngleConnectPx(
  from: { x: number; y: number },
  to: { x: number; y: number },
  prefer: 'horizontal-first' | 'vertical-first' | 'auto' = 'auto',
): Array<{ x: number; y: number }> {
  const dx = Math.abs(to.x - from.x)
  const dy = Math.abs(to.y - from.y)
  if (dx < ORTHO_EPS_PX && dy < ORTHO_EPS_PX) return [{ ...from }]
  if (dx < ORTHO_EPS_PX || dy < ORTHO_EPS_PX) return [{ ...from }, { ...to }]

  let verticalFirst = prefer === 'vertical-first'
  if (prefer === 'auto') {
    // 較長的一軸先走，轉角比較貼近「沿軌道走到拐彎處再折」
    verticalFirst = dy >= dx
  }
  if (verticalFirst) {
    return [{ ...from }, { x: from.x, y: to.y }, { ...to }]
  }
  return [{ ...from }, { x: to.x, y: from.y }, { ...to }]
}

function areBadgesSameHorizontalCorridor(
  fromPx: { x: number; y: number },
  toPx: { x: number; y: number },
): boolean {
  const dx = Math.abs(toPx.x - fromPx.x)
  const dy = Math.abs(toPx.y - fromPx.y)
  return (
    dy <= BADGE_CORRIDOR_ALIGN_MAX_DY_PX
    && dx >= BADGE_CORRIDOR_ALIGN_MIN_DX_PX
    && dx <= BADGE_CORRIDOR_ALIGN_MAX_DX_PX
  )
}

/** 同廊站標直連（水平優先直角） */
function badgeCorridorConnectPx(
  fromPx: { x: number; y: number },
  toPx: { x: number; y: number },
): Array<{ x: number; y: number }> {
  return ensureRightAnglePathPx(
    rightAngleConnectPx(fromPx, toPx, 'horizontal-first'),
  )
}

/** 去掉共線中間點，只留端點與轉角 */
export function collapseColinearPathPx(
  points: Array<{ x: number; y: number }>,
  eps = ORTHO_EPS_PX,
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points.map((p) => ({ ...p }))
  const out: Array<{ x: number; y: number }> = [{ ...points[0]! }]
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1]!
    const b = points[i]!
    const c = points[i + 1]!
    const abx = b.x - a.x
    const aby = b.y - a.y
    const bcx = c.x - b.x
    const bcy = c.y - b.y
    const colinear =
      Math.abs(abx * bcy - aby * bcx) < eps * eps
      && (Math.abs(abx) < eps || Math.abs(aby) < eps)
      && (Math.abs(bcx) < eps || Math.abs(bcy) < eps)
    if (colinear) continue
    out.push({ ...b })
  }
  out.push({ ...points[points.length - 1]! })
  return out
}

/**
 * 確保折線只有水平／垂直段；若出現斜線則在轉角插入直角拐點。
 */
export function ensureRightAnglePathPx(
  points: Array<{ x: number; y: number }>,
  prefer: 'horizontal-first' | 'vertical-first' | 'auto' = 'auto',
): Array<{ x: number; y: number }> {
  if (points.length < 2) return points.map((p) => ({ ...p }))
  const expanded: Array<{ x: number; y: number }> = [{ ...points[0]! }]
  for (let i = 1; i < points.length; i++) {
    const prev = expanded[expanded.length - 1]!
    const cur = points[i]!
    const dx = Math.abs(cur.x - prev.x)
    const dy = Math.abs(cur.y - prev.y)
    if (dx < ORTHO_EPS_PX && dy < ORTHO_EPS_PX) continue
    if (dx < ORTHO_EPS_PX || dy < ORTHO_EPS_PX) {
      expanded.push({ ...cur })
      continue
    }
    const elbow = rightAngleConnectPx(prev, cur, prefer)
    for (let j = 1; j < elbow.length; j++) expanded.push(elbow[j]!)
  }
  return collapseColinearPathPx(expanded)
}

/**
 * 兩站連線（順序＝路線站序／畫面編號）：
 * - 沿實體軌道鄰接尋路
 * - 已接合的虛擬渡線可作為軌道圖橋（只認 attachedTrackId，不發明上下行）
 * - 虛擬渡線站序明示 A/B 另段處理
 */
function resolveOnTrackLegPoints(
  segmentById: Map<string, TrackNetworkSegment>,
  adj: Map<string, Set<string>>,
  from: TrackSnap,
  to: TrackSnap,
  bridgesByKey: Map<string, CrossoverBridge[]> = new Map(),
): Array<{ x: number; y: number }> | null {
  if (from.trackId === to.trackId) {
    const seg = segmentById.get(from.trackId)
    if (!seg) return null
    const points = collapseColinearPathPx(
      sampleTrackSegmentBetweenFieldPoints(seg, from, to),
    )
    return points.length >= 2 ? points : null
  }

  const trackPath = shortestTrackPath(adj, segmentById, from.trackId, to.trackId)
  if (!trackPath) return null

  const points = buildMapPathBetweenTrackSnaps(
    trackPath,
    segmentById,
    bridgesByKey,
    from,
    to,
    buildContinuousChainPathForTrackIds,
  )
  return points && points.length >= 2 ? collapseColinearPathPx(points) : null
}

/** 拓撲節點 → 場域公尺（用地圖真實座標，不用拓撲畫布 x/y） */
function resolveTopologyNodeFieldMeters(
  areas: MapAreaObject[],
  nodeId: string,
  topology: PointTopology,
): { xM: number; yM: number } | null {
  const node = topology.nodes.find((n) => n.id === nodeId)
  if (node?.stationId) {
    const viaStation = resolveStationFieldMeters(areas, node.stationId)
    if (viaStation) return viaStation
  }
  const viaId = resolveStationFieldMeters(areas, nodeId)
  if (viaId) return viaId

  // docking 拓撲節點 id 常為 facilityId
  for (const area of areas) {
    for (const f of area.facilities) {
      if (f.id !== nodeId) continue
      if (f.type === 'DockingPoint') {
        const params = f.parameters ?? {}
        const xM =
          typeof params.refFieldXM === 'number' && Number.isFinite(params.refFieldXM)
            ? params.refFieldXM
            : f.position.x
        const yM =
          typeof params.refFieldYM === 'number' && Number.isFinite(params.refFieldYM)
            ? params.refFieldYM
            : f.position.y
        if (Number.isFinite(xM) && Number.isFinite(yM)) return { xM, yM }
      }
      if (f.type === 'Waypoint') {
        const params = f.parameters ?? {}
        const xM =
          typeof params.refFieldXM === 'number' && Number.isFinite(params.refFieldXM)
            ? params.refFieldXM
            : f.position.x
        const yM =
          typeof params.refFieldYM === 'number' && Number.isFinite(params.refFieldYM)
            ? params.refFieldYM
            : f.position.y
        if (Number.isFinite(xM) && Number.isFinite(yM)) return { xM, yM }
      }
    }
  }
  return null
}

/**
 * 拓樸路徑上的途經點依序吸軌並串接；補直連兩端找不到軌道時的空白。
 */
function resolveTopologyAssistedTrackLegPx(
  areas: MapAreaObject[],
  topology: PointTopology,
  fromStationId: string,
  toStationId: string,
  segmentById: Map<string, TrackNetworkSegment>,
  adj: Map<string, Set<string>>,
  bridgesByKey: Map<string, CrossoverBridge[]>,
): Array<{ x: number; y: number }> | null {
  const breakdown = buildTopologyStationLegBreakdown(
    topology,
    areas,
    fromStationId,
    toStationId,
  )
  if (!breakdown.pathFound || breakdown.nodePath.length < 2) return null

  const snaps: TrackSnap[] = []
  let continuityTrackId: string | null = null
  for (const nodeId of breakdown.nodePath) {
    const field = resolveTopologyNodeFieldMeters(areas, nodeId, topology)
    if (!field) continue
    const prefer = resolvePreferTrackIdForStation(areas, nodeId)
      ?? resolvePreferTrackIdForStation(
        areas,
        topology.nodes.find((n) => n.id === nodeId)?.stationId ?? '',
      )
    const snap = snapFieldPointToTrackForStop(
      field.xM,
      field.yM,
      segmentById,
      prefer,
      continuityTrackId,
    )
    if (snap) {
      snaps.push(snap)
      continuityTrackId = snap.trackId
    }
  }
  if (snaps.length < 2) return null

  const out: Array<{ x: number; y: number }> = []
  let okHops = 0
  for (let i = 0; i < snaps.length - 1; i++) {
    const hop = resolveOnTrackLegPoints(
      segmentById,
      adj,
      snaps[i]!,
      snaps[i + 1]!,
      bridgesByKey,
    )
    if (!hop || hop.length < 2) continue
    appendPathPoints(out, hop)
    okHops += 1
  }
  if (okHops === 0 || out.length < 2) return null
  return collapseColinearPathPx(out)
}

/**
 * 依已接合軌道／最近軌道吸附。不做上下行等語意偏好（泛用圖台只認幾何）。
 * 有 preferTrackId（渡線 attachedTrackId）時以接合為準，不因偏離中心線而放棄。
 * continuityTrackId：路線上一站已吸附的軌道；兩站同走廊（如 U02 的 2→3）優先續吸同股，
 * 避免第二點因橫向微偏被吸到對向股而畫出垂直跳線。
 */
function snapFieldPointToTrackForStop(
  xM: number,
  yM: number,
  segmentById: Map<string, TrackNetworkSegment>,
  preferTrackId: string | null = null,
  continuityTrackId: string | null = null,
): TrackSnap | null {
  if (preferTrackId) {
    const seg = segmentById.get(preferTrackId)
    if (seg) {
      const projected = projectOntoSegmentCenterline(xM, yM, seg)
      // 偏好軌道若已跨到對向股，忽略偏好改走幾何最近
      if (isWithinSnapDistance(projected)) {
        const mapPx = fieldPointToMapPx(projected.xM, projected.yM, seg)
        if (mapPx) {
          return {
            trackId: preferTrackId,
            xM: projected.xM,
            yM: projected.yM,
            mapPx,
          }
        }
      }
    }
  }

  const candidates = listSnapCandidates(xM, yM, segmentById)

  const nearest = candidates[0] ?? null

  if (continuityTrackId) {
    const continued = candidates.find((c) => c.trackId === continuityTrackId)
    if (continued) {
      // 幾何最近若已明顯更貼另一股（常見：上一站 D、本站 U），不可續吸對向股
      if (
        nearest
        && nearest.trackId !== continued.trackId
        && nearest.lateral + 0.35 < continued.lateral
      ) {
        return {
          trackId: nearest.trackId,
          xM: nearest.xM,
          yM: nearest.yM,
          mapPx: nearest.mapPx,
        }
      }
      return {
        trackId: continued.trackId,
        xM: continued.xM,
        yM: continued.yM,
        mapPx: continued.mapPx,
      }
    }
    const contSeg = segmentById.get(continuityTrackId)
    if (contSeg) {
      const projected = projectOntoSegmentCenterline(xM, yM, contSeg)
      // 同股續吸：略放寬橫向，避免邊界點被吸到對向股
      if (isWithinContinuitySnapDistance(projected)) {
        if (
          nearest
          && nearest.trackId !== continuityTrackId
          && nearest.lateral + 0.35 < projected.lateral
        ) {
          return {
            trackId: nearest.trackId,
            xM: nearest.xM,
            yM: nearest.yM,
            mapPx: nearest.mapPx,
          }
        }
        const mapPx = fieldPointToMapPx(projected.xM, projected.yM, contSeg)
        if (mapPx) {
          return {
            trackId: continuityTrackId,
            xM: projected.xM,
            yM: projected.yM,
            mapPx,
          }
        }
      }
    }
  }

  return nearest
}

function resolvePreferTrackIdForStation(
  areas: MapAreaObject[],
  stationId: string,
): string | null {
  const crossover = collectCrossoverPortalWaypointsFromAreas(areas).find(
    (s) => s.stationId === stationId || s.topologyNodeId === stationId,
  )
  if (crossover) {
    for (const area of areas) {
      const facility = area.facilities.find((f) => f.id === crossover.facilityId)
      if (facility?.type !== 'TrackCrossover') continue
      const portals = getCrossoverPortals(facility)
      const portal = portals?.[crossover.portalKey]
      const attached = portal?.attachedTrackId?.trim()
      if (attached) return attached
    }
  }
  const topo = parseCrossoverPortalTopologyNodeId(stationId)
  if (topo) {
    for (const area of areas) {
      const facility = area.facilities.find((f) => f.id === topo.facilityId)
      if (facility?.type !== 'TrackCrossover') continue
      const portals = getCrossoverPortals(facility)
      const attached = portals?.[topo.key]?.attachedTrackId?.trim()
      if (attached) return attached
    }
  }
  return null
}

function pathLengthPx(points: Array<{ x: number; y: number }>): number {
  let len = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    len += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return len
}

/**
 * 圖面像素 → 場域公尺座標。
 *
 * 找出這個像素壓在哪一條軌道上（比對每條軌道中心線的像素投影），再依它在那條軌道上
 * 的比例，換算進該軌道的 refField 範圍。<strong>逐軌道換算</strong>是必要的：
 * 圖面座標與場域座標不是單一線性關係，每條軌道各自對應現場的一段。
 *
 * 都構不上就回 null，讓呼叫端退回 refField 原值——寧可用可能偏一股的座標，
 * 也不要編一個不存在的位置出來。
 */
function mapPxToRefFieldMeters(
  areas: MapAreaObject[],
  px: { x: number; y: number },
): { xM: number; yM: number } | null {
  const { segments } = buildTrackNetwork(areas)
  let best: { xM: number; yM: number; lateral: number } | null = null

  for (const seg of segments) {
    const b = seg.bounds
    const startM = seg.horizontal
      ? { xM: b.xMinM, yM: (b.yMinM + b.yMaxM) / 2 }
      : { xM: (b.xMinM + b.xMaxM) / 2, yM: b.yMinM }
    const endM = seg.horizontal
      ? { xM: b.xMaxM, yM: (b.yMinM + b.yMaxM) / 2 }
      : { xM: (b.xMinM + b.xMaxM) / 2, yM: b.yMaxM }

    const a = fieldPointToMapPx(startM.xM, startM.yM, seg)
    const c = fieldPointToMapPx(endM.xM, endM.yM, seg)
    if (!a || !c) continue

    const dx = c.x - a.x
    const dy = c.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq <= 0) continue

    const raw = ((px.x - a.x) * dx + (px.y - a.y) * dy) / lenSq
    const t = Math.max(0, Math.min(1, raw))
    const lateral = Math.hypot(px.x - (a.x + dx * t), px.y - (a.y + dy * t))
    if (best && lateral >= best.lateral) continue

    best = {
      xM: startM.xM + (endM.xM - startM.xM) * t,
      yM: startM.yM + (endM.yM - startM.yM) * t,
      lateral,
    }
  }

  // 站標離最近的軌道超過半個畫面區塊時，多半根本不在軌道上，別硬吸
  if (!best || best.lateral > MAP_PX_SNAP_MAX) return null
  return { xM: best.xM, yM: best.yM }
}

/**
 * 站序相鄰兩點是否為同一虛擬渡線的 A／B 端點；若是則回傳渡線道路折線（圖台 px）。
 * 方向依路線站序（from → to），不自動幫其他站間段走渡線。
 */
export function resolveExplicitCrossoverPortalLegPathPx(
  areas: MapAreaObject[],
  fromStationId: string,
  toStationId: string,
): Array<{ x: number; y: number }> | null {
  const portals = collectCrossoverPortalWaypointsFromAreas(areas)
  const from = portals.find(
    (s) => s.stationId === fromStationId || s.topologyNodeId === fromStationId,
  )
  const to = portals.find(
    (s) => s.stationId === toStationId || s.topologyNodeId === toStationId,
  )
  if (!from || !to) return null
  if (from.facilityId !== to.facilityId) return null
  if (from.portalKey === to.portalKey) return null

  const mapPxForPortal = (
    stop: (typeof portals)[number],
  ): { x: number; y: number } | null => {
    const viaStop = resolveCrossoverPortalRouteStopMapPx(areas, stop.stationId)
    if (viaStop) return { x: viaStop.x, y: viaStop.y }
    const area = areas.find((a) => a.id === stop.areaId)
    if (!area) return null
    const local = meterToAreaLocalPx(stop.xM, stop.yM, area.domain, area.layout)
    const css = areaPositionToCssTopLeft(local, { w: 0, h: 0 }, area.layout.hPx)
    return {
      x: area.layout.xPx + css.left,
      y: area.layout.yPx + css.top,
    }
  }

  const fromStop = mapPxForPortal(from)
  const toStop = mapPxForPortal(to)
  if (!fromStop || !toStop) return null

  const steps = 10
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    out.push({
      x: fromStop.x + (toStop.x - fromStop.x) * t,
      y: fromStop.y + (toStop.y - fromStop.y) * t,
    })
  }
  return out.length >= 2 ? collapseColinearPathPx(out) : null
}

function stitchBadgeToTrackPath(
  fromPx: { x: number; y: number },
  trackPoints: Array<{ x: number; y: number }>,
  toPx: { x: number; y: number },
  options?: { allowLongStub?: boolean },
): Array<{ x: number; y: number }> | null {
  // 中段保留軌道路徑（含明示渡線對角）；不可整段強制直角，否則會把交叉道折成 L
  const mid = collapseColinearPathPx(trackPoints)
  if (mid.length < 1) {
    if (options?.allowLongStub) {
      return ensureRightAnglePathPx(
        rightAngleConnectPx(fromPx, toPx, 'horizontal-first'),
      )
    }
    return null
  }
  const head = ensureRightAnglePathPx(
    rightAngleConnectPx(fromPx, mid[0]!, 'horizontal-first'),
  )
  const tail = ensureRightAnglePathPx(
    rightAngleConnectPx(mid[mid.length - 1]!, toPx, 'horizontal-first'),
  )
  if (!options?.allowLongStub) {
    // 站標離軌道路徑太遠＝吸到另一走廊／錯股，禁止畫出跨空白垂線
    if (
      pathLengthPx(head) > MAX_STITCH_STUB_PX
      || pathLengthPx(tail) > MAX_STITCH_STUB_PX
    ) {
      return null
    }
  }
  // allowLongStub：允許臨停懸伸；對向股跳線改由站序續吸同股避免
  const out: Array<{ x: number; y: number }> = []
  appendPathPoints(out, head)
  appendPathPoints(out, mid)
  appendPathPoints(out, tail)
  return collapseColinearPathPx(out)
}

function resolveLegPathPx(
  segmentById: Map<string, TrackNetworkSegment>,
  adj: Map<string, Set<string>>,
  from: TrackSnap,
  to: TrackSnap,
  bridgesByKey: Map<string, CrossoverBridge[]> = new Map(),
): { points: Array<{ x: number; y: number }>; onTrack: boolean } {
  // 供 canConnectStationsViaTrack 使用：僅實體軌道（可含渡線橋）
  const points = resolveOnTrackLegPoints(
    segmentById,
    adj,
    from,
    to,
    bridgesByKey,
  )
  if (!points) {
    return {
      points: [],
      onTrack: false,
    }
  }
  return {
    points: ensureRightAnglePathPx(points),
    onTrack: true,
  }
}

function resolveStationFieldMeters(
  areas: MapAreaObject[],
  stationId: string,
): { xM: number; yM: number } | null {
  const docking = collectStationsFromAreas(areas).find((s) => s.stationId === stationId)
  if (docking) {
    // 吸附與畫面站標同源：有放置 areaPosition 時用站標中心，避免 refField 偏 D、圖標在 U
    const area = areas.find((a) => a.id === docking.areaId)
    const facility = area?.facilities.find((f) => f.id === docking.facilityId)
    const ap = facility?.areaPosition
    const placedOffOrigin =
      !!ap
      && Number.isFinite(ap.x)
      && Number.isFinite(ap.y)
      && (Math.abs(ap.x) > 1 || Math.abs(ap.y) > 1)
    if (area && placedOffOrigin) {
      const mapPx = resolveDockingPointNodeMapPx(
        areas,
        docking.areaId,
        docking.facilityId,
      )
      /*
       * 站標像素要換成<strong>場域</strong>公尺座標，不能用區塊 domain 換。
       *
       * 這裡以前走 areaLocalPxToMeter(…, area.domain, …)，回的是「區塊自己那把尺」
       * 的公尺；但呼叫端拿它去和軌道的 refField 比對，而軌道量的是「現場那把尺」。
       * 兩把尺不是同一條線性關係，實測 N2W下行出發 refField 是 (840, 101.75)，
       * 用 domain 換出來卻是 (889, 394)——y 差了 290 公尺。
       *
       * 差這麼多的結果是：對圖上<strong>每一條</strong>軌道都超出吸附容許距離，
       * 於是回報「兩端皆無法吸附至軌道」，整條路線退回站點直線。車照著那條斜線走，
       * 圖台上就是一台歪斜的車。
       *
       * 正解是照站標壓在哪條軌道上，換進<strong>那條軌道自己的 refField 範圍</strong>。
       */
      const fromPx = mapPx ? mapPxToRefFieldMeters(areas, mapPx) : null
      if (fromPx) return fromPx
    }
    return { xM: docking.xM, yM: docking.yM }
  }

  const waypoint = collectWaypointsFromAreas(areas).find(
    (s) => s.stationId === stationId || s.facilityId === stationId,
  )
  if (waypoint) return { xM: waypoint.xM, yM: waypoint.yM }

  const crossover = collectCrossoverPortalWaypointsFromAreas(areas).find(
    (s) => s.stationId === stationId || s.topologyNodeId === stationId,
  )
  if (crossover) return { xM: crossover.xM, yM: crossover.yM }

  const crossoverPx = resolveCrossoverPortalRouteStopMapPx(areas, stationId)
  if (crossoverPx) return { xM: crossoverPx.xM, yM: crossoverPx.yM }

  const cross = collectCrossPortalWaypointsFromAreas(areas).find(
    (s) => s.stationId === stationId || s.topologyNodeId === stationId,
  )
  if (cross) return { xM: cross.xM, yM: cross.yM }

  const crossPx = resolveCrossPortalRouteStopMapPx(areas, stationId)
  if (crossPx) return { xM: crossPx.xM, yM: crossPx.yM }

  const fdock = resolveFacilityDockingRouteStopMapPx(areas, stationId)
  if (fdock) return { xM: fdock.xM, yM: fdock.yM }

  return null
}

function stationMapPxAtIndex(
  stations: RouteStationPoint[],
  index: number,
): { x: number; y: number } | null {
  const hit = stations[index]
  if (!hit) return null
  if (!Number.isFinite(hit.x) || !Number.isFinite(hit.y)) return null
  return { x: hit.x, y: hit.y }
}

/**
 * 路線預覽連線（順序＝使用者加入的站序＝畫面 1,2,3,4…）：
 *
 * - 軌道連軌道：沿實體軌道鄰接；已接合渡線可橋接
 * - 渡線連渡線：站序連續經過同一虛擬渡線 A／B
 * - 拓樸有途經點時：沿途經點串接貼軌
 * - 仍不相通 → 紅虛線斷線標示
 */
export function resolveRoutePreviewGeometry(
  areas: MapAreaObject[],
  stationIds: string[],
  pointTopology?: PointTopology | null,
): RoutePreviewGeometry {
  const stations = resolveRouteStationPoints(areas, stationIds)

  if (stationIds.length < 2) {
    return {
      stations,
      pathPx: [],
      pathLegs: [],
      brokenLegs: [],
      warnings: [],
      followsTracks: false,
    }
  }

  const network = buildTrackNetwork(areas)
  const hasTracks = uniqueSegments(network.segments).length > 0
  const { segmentById, adj: adjPhysical } = hasTracks
    ? buildTrackRoutingContext(areas)
    : {
        segmentById: new Map<string, TrackNetworkSegment>(),
        adj: new Map<string, Set<string>>(),
      }

  const bridges = hasTracks
    ? collectCrossoverBridges(areas, segmentById)
    : []
  const bridgesByKey = indexCrossoverBridges(bridges)
  const adj = hasTracks
    ? adjWithCrossoverBridges(adjPhysical, bridges)
    : adjPhysical

  const fields = stationIds.map((stationId) =>
    hasTracks ? resolveStationFieldMeters(areas, stationId) : null,
  )

  const snaps: Array<TrackSnap | null> = []
  let continuityTrackId: string | null = null
  for (let i = 0; i < stationIds.length; i++) {
    const stationId = stationIds[i]!
    if (!hasTracks) {
      snaps.push(null)
      continue
    }
    const field = fields[i]
    if (!field) {
      snaps.push(null)
      continuityTrackId = null
      continue
    }
    const preferTrackId = resolvePreferTrackIdForStation(areas, stationId)
    const snap = snapFieldPointToTrackForStop(
      field.xM,
      field.yM,
      segmentById,
      preferTrackId,
      continuityTrackId,
    )
    snaps.push(snap)
    continuityTrackId = snap?.trackId ?? null
  }

  const pathPx: Array<{ x: number; y: number }> = []
  const pathLegs: Array<Array<{ x: number; y: number }>> = []
  const brokenLegs: Array<Array<{ x: number; y: number }>> = []
  const warnings: RouteLegWarning[] = []
  let followsTracks = true

  for (let i = 0; i < stationIds.length - 1; i++) {
    const fromId = stationIds[i]!
    const toId = stationIds[i + 1]!
    // 必須用站序索引，不可 find(id)：重複 stationId 或解析失敗占位時會對錯點／整段略過
    const fromPx = stationMapPxAtIndex(stations, i)
    const toPx = stationMapPxAtIndex(stations, i + 1)
    const fromSnap = snaps[i]
    const toSnap = snaps[i + 1]

    if (!fromPx || !toPx) {
      followsTracks = false
      warnings.push({
        fromStationId: fromId,
        toStationId: toId,
        message: `${stationDisplayLabel(areas, fromId)} → ${stationDisplayLabel(areas, toId)}：找不到畫面站位，略過此段`,
      })
      continue
    }

    let points: Array<{ x: number; y: number }> | null = null
    let onTrack = false

    // 1) 站序明示：同一虛擬渡線 A↔B
    const xoLeg = resolveExplicitCrossoverPortalLegPathPx(areas, fromId, toId)
    if (xoLeg && xoLeg.length >= 2) {
      points = stitchBadgeToTrackPath(fromPx, xoLeg, toPx, {
        allowLongStub: true,
      })
      onTrack = points != null && points.length >= 2
    }

    // 2) 實體軌道（含已接合渡線橋）
    if (!onTrack && fromSnap && toSnap) {
      const physical = resolveOnTrackLegPoints(
        segmentById,
        adj,
        fromSnap,
        toSnap,
        bridgesByKey,
      )
      if (physical && physical.length >= 2) {
        const strict = stitchBadgeToTrackPath(fromPx, physical, toPx)
        const stitched =
          strict && strict.length >= 2
            ? strict
            : stitchBadgeToTrackPath(fromPx, physical, toPx, {
                allowLongStub: true,
              })
        if (stitched && stitched.length >= 2) {
          points = stitched
          onTrack = true
        }
      }
    }

    // 3) 拓樸途經點串接貼軌（直連兩端失敗時補上）
    if (!onTrack && pointTopology && hasTracks) {
      const assisted = resolveTopologyAssistedTrackLegPx(
        areas,
        pointTopology,
        fromId,
        toId,
        segmentById,
        adj,
        bridgesByKey,
      )
      if (assisted && assisted.length >= 2) {
        const stitched = stitchBadgeToTrackPath(fromPx, assisted, toPx, {
          allowLongStub: true,
        })
        points = stitched && stitched.length >= 2 ? stitched : assisted
        onTrack = points != null && points.length >= 2
      }
    }

    /**
     * 同廊強制直連（必須在軌道／拓樸之後覆蓋）：
     * 站標已在同一水平廊（如 U02 的 2→3）時，預覽必須跟站標水平連，
     * 不可沿用異股吸附「成功」的長段 D 騎行 + 短垂直落地——
     * 那種路徑 totalDx 很大，舊的 verticalJump 判定會失效。
     */
    if (areBadgesSameHorizontalCorridor(fromPx, toPx)) {
      points = badgeCorridorConnectPx(fromPx, toPx)
      onTrack = true
    }

    if (!onTrack || !points) {
      followsTracks = false
      // 斷線：直虛線提示，不要直角折線看起來像「有軌道」
      brokenLegs.push([fromPx, toPx])
      const snapHint =
        !fromSnap && !toSnap
          ? '兩端皆無法吸附至軌道'
          : !fromSnap
            ? '起點無法吸附至軌道'
            : !toSnap
              ? '終點無法吸附至軌道'
              : '無連續軌道路徑（請確認中間軌道銜接，或將渡線兩端加入站序）'
      warnings.push({
        fromStationId: fromId,
        toStationId: toId,
        message: `${stationDisplayLabel(areas, fromId)} → ${stationDisplayLabel(areas, toId)}：${snapHint}`,
      })
      continue
    }

    pathLegs.push(points)
    appendPathPoints(pathPx, points)
  }

  return { stations, pathPx, pathLegs, brokenLegs, warnings, followsTracks }
}

export type RouteStationAppendOption = {
  stationId: string
  stationName: string
  reason?: string
}

export type RouteStationAppendPartition = {
  selectable: RouteStationAppendOption[]
  disabled: RouteStationAppendOption[]
}

function stationSnapOrReason(
  xM: number,
  yM: number,
  segmentById: Map<string, TrackNetworkSegment>,
): { snap: TrackSnap | null; reason?: string } {
  const snap = snapFieldPointToTrack(xM, yM, segmentById)
  if (!snap) {
    return { snap: null, reason: `無法吸附至軌道（>${SNAP_MAX_M} m）` }
  }
  return { snap }
}

function canConnectStationsViaTrack(
  segmentById: Map<string, TrackNetworkSegment>,
  adj: Map<string, Set<string>>,
  from: { xM: number; yM: number },
  to: { xM: number; yM: number },
  bridgesByKey: Map<string, CrossoverBridge[]> = new Map(),
): { ok: boolean; reason?: string } {
  const fromResult = stationSnapOrReason(from.xM, from.yM, segmentById)
  const toResult = stationSnapOrReason(to.xM, to.yM, segmentById)
  if (!toResult.snap) {
    return { ok: false, reason: toResult.reason }
  }
  if (!fromResult.snap) {
    return { ok: false, reason: '前一站無法吸附至軌道' }
  }
  const leg = resolveLegPathPx(
    segmentById,
    adj,
    fromResult.snap,
    toResult.snap,
    bridgesByKey,
  )
  if (!leg.onTrack) {
    return { ok: false, reason: '無連續軌道路徑' }
  }
  return { ok: true }
}

/** 依目前站序，分出可加入與不可加入的停靠點 */
export function partitionStationsForRouteAppend(
  areas: MapAreaObject[],
  currentStationIds: string[],
): RouteStationAppendPartition {
  const all = collectStationsFromAreas(areas)
  const inRoute = new Set(currentStationIds)
  const candidates = all
    .filter((s) => !inRoute.has(s.stationId))
    .sort((a, b) => a.stationName.localeCompare(b.stationName, 'zh-Hant'))

  const network = buildTrackNetwork(areas)
  if (uniqueSegments(network.segments).length === 0) {
    return {
      selectable: [],
      disabled: candidates.map((s) => ({
        stationId: s.stationId,
        stationName: s.stationName,
        reason: '地圖尚無有效軌道',
      })),
    }
  }

  const { segmentById, adj: adjPhysical } = buildTrackRoutingContext(areas)
  const bridges = collectCrossoverBridges(areas, segmentById)
  const bridgesByKey = indexCrossoverBridges(bridges)
  const adj = adjWithCrossoverBridges(adjPhysical, bridges)
  const byId = new Map(all.map((s) => [s.stationId, s]))
  const selectable: RouteStationAppendOption[] = []
  const disabled: RouteStationAppendOption[] = []

  const lastId = currentStationIds[currentStationIds.length - 1]
  const lastStation = lastId ? byId.get(lastId) : null

  for (const candidate of candidates) {
    if (!lastStation) {
      const snapResult = stationSnapOrReason(
        candidate.xM,
        candidate.yM,
        segmentById,
      )
      if (snapResult.snap) {
        selectable.push({
          stationId: candidate.stationId,
          stationName: candidate.stationName,
        })
      } else {
        disabled.push({
          stationId: candidate.stationId,
          stationName: candidate.stationName,
          reason: snapResult.reason,
        })
      }
      continue
    }

    const result = canConnectStationsViaTrack(
      segmentById,
      adj,
      { xM: lastStation.xM, yM: lastStation.yM },
      { xM: candidate.xM, yM: candidate.yM },
      bridgesByKey,
    )
    if (result.ok) {
      selectable.push({
        stationId: candidate.stationId,
        stationName: candidate.stationName,
      })
    } else {
      disabled.push({
        stationId: candidate.stationId,
        stationName: candidate.stationName,
        reason: result.reason,
      })
    }
  }

  return { selectable, disabled }
}

export function canAppendStationToRoute(
  areas: MapAreaObject[],
  currentStationIds: string[],
  candidateStationId: string,
): boolean {
  const { selectable } = partitionStationsForRouteAppend(areas, currentStationIds)
  return selectable.some((s) => s.stationId === candidateStationId)
}
