import type { MapAreaObject } from '../types/area'
import { collectStationsFromAreas } from './dockingPointStationId'
import {
  resolveRouteStationPoints,
  stationDisplayLabel,
  type RouteStationPoint,
} from './routePlanning'
import {
  buildContinuousChainPathForTrackIds,
  buildTrackRoutingContext,
  fieldPointToMapPx,
  findClosestIndexOnScanPath,
  sampleTrackSegmentBetweenFieldPoints,
} from './trackConnectivityScan'
import {
  findRefFieldSegmentsAtPoint,
  pickRefFieldSegment,
} from '../vehicles/trackNetwork/locate'
import type { TrackNetworkSegment } from '../vehicles/trackNetwork/types'
import { buildTrackNetwork } from '../vehicles/trackNetwork/scanMap'

const SNAP_MAX_M = 100

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
  /** 可沿軌道行走的連線 */
  pathPx: Array<{ x: number; y: number }>
  /** 無法沿軌道連接的站間段（直線標示問題區） */
  brokenLegs: Array<Array<{ x: number; y: number }>>
  warnings: RouteLegWarning[]
  followsTracks: boolean
}

function projectOntoSegmentCenterline(
  xM: number,
  yM: number,
  seg: TrackNetworkSegment,
): { xM: number; yM: number; dist: number } {
  const b = seg.bounds
  if (seg.horizontal) {
    const cy = (b.yMinM + b.yMaxM) / 2
    const cx = Math.min(b.xMaxM, Math.max(b.xMinM, xM))
    return { xM: cx, yM: cy, dist: Math.hypot(xM - cx, yM - cy) }
  }
  const cx = (b.xMinM + b.xMaxM) / 2
  const cy = Math.min(b.yMaxM, Math.max(b.yMinM, yM))
  return { xM: cx, yM: cy, dist: Math.hypot(xM - cx, yM - cy) }
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
  const network = { segments: [...segmentById.values()] }
  const hit = pickRefFieldSegment(findRefFieldSegmentsAtPoint(network, xM, yM))
  if (hit) {
    const projected = projectOntoSegmentCenterline(xM, yM, hit)
    const mapPx = fieldPointToMapPx(projected.xM, projected.yM, hit)
    if (!mapPx) return null
    return {
      trackId: hit.trackId,
      xM: projected.xM,
      yM: projected.yM,
      mapPx,
    }
  }

  let best: TrackSnap | null = null
  let bestDist = Infinity
  for (const seg of segmentById.values()) {
    const projected = projectOntoSegmentCenterline(xM, yM, seg)
    if (projected.dist > SNAP_MAX_M) continue
    if (projected.dist >= bestDist) continue
    const mapPx = fieldPointToMapPx(projected.xM, projected.yM, seg)
    if (!mapPx) continue
    bestDist = projected.dist
    best = {
      trackId: seg.trackId,
      xM: projected.xM,
      yM: projected.yM,
      mapPx,
    }
  }
  return best
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

function resolveLegPathPx(
  segmentById: Map<string, TrackNetworkSegment>,
  adj: Map<string, Set<string>>,
  from: TrackSnap,
  to: TrackSnap,
): { points: Array<{ x: number; y: number }>; onTrack: boolean } {
  if (from.trackId === to.trackId) {
    const seg = segmentById.get(from.trackId)
    if (!seg) {
      return { points: [from.mapPx, to.mapPx], onTrack: false }
    }
    return {
      points: sampleTrackSegmentBetweenFieldPoints(seg, from, to),
      onTrack: true,
    }
  }

  const trackPath = bfsTrackPath(adj, from.trackId, to.trackId)
  if (!trackPath) {
    return { points: [from.mapPx, to.mapPx], onTrack: false }
  }

  const chain = buildContinuousChainPathForTrackIds(trackPath, segmentById)
  if (chain.length < 2) {
    return { points: [from.mapPx, to.mapPx], onTrack: false }
  }

  const i0 = findClosestIndexOnScanPath(chain, from.xM, from.yM)
  const i1 = findClosestIndexOnScanPath(chain, to.xM, to.yM)
  const lo = Math.min(i0, i1)
  const hi = Math.max(i0, i1)
  const sliced = chain.slice(lo, hi + 1).map((p) => p.mapPx)
  if (sliced.length >= 2) {
    return { points: sliced, onTrack: true }
  }

  const seg = segmentById.get(from.trackId)
  if (seg) {
    return {
      points: sampleTrackSegmentBetweenFieldPoints(seg, from, to),
      onTrack: true,
    }
  }
  return { points: [from.mapPx, to.mapPx], onTrack: false }
}

export function resolveRoutePreviewGeometry(
  areas: MapAreaObject[],
  stationIds: string[],
): RoutePreviewGeometry {
  const stations = resolveRouteStationPoints(areas, stationIds)
  const stationFieldById = new Map(
    collectStationsFromAreas(areas).map((s) => [s.stationId, s]),
  )

  if (stations.length < 2) {
    return { stations, pathPx: [], brokenLegs: [], warnings: [], followsTracks: false }
  }

  const network = buildTrackNetwork(areas)
  const { segmentById, adj } = buildTrackRoutingContext(areas)
  if (uniqueSegments(network.segments).length === 0) {
    return {
      stations,
      pathPx: [],
      brokenLegs: [],
      warnings: [
        {
          fromStationId: stationIds[0] ?? '',
          toStationId: stationIds[1] ?? '',
          message: '地圖尚無有效軌道 refField，無法檢查路線連通',
        },
      ],
      followsTracks: false,
    }
  }

  const snaps: Array<TrackSnap | null> = stationIds.map((stationId) => {
    const station = stationFieldById.get(stationId)
    if (!station) return null
    return snapFieldPointToTrack(station.xM, station.yM, segmentById)
  })

  const pathPx: Array<{ x: number; y: number }> = []
  const brokenLegs: Array<Array<{ x: number; y: number }>> = []
  const warnings: RouteLegWarning[] = []
  let followsTracks = true

  for (let i = 0; i < stations.length - 1; i++) {
    const fromStation = stations[i]!
    const toStation = stations[i + 1]!
    const fromId = fromStation.stationId
    const toId = toStation.stationId
    const fromLabel = stationDisplayLabel(areas, fromId)
    const toLabel = stationDisplayLabel(areas, toId)
    const fromSnap = snaps[i]
    const toSnap = snaps[i + 1]

    if (!fromSnap || !toSnap) {
      followsTracks = false
      brokenLegs.push([
        { x: fromStation.x, y: fromStation.y },
        { x: toStation.x, y: toStation.y },
      ])
      warnings.push({
        fromStationId: fromId,
        toStationId: toId,
        message: `${fromLabel} → ${toLabel}：停靠點無法吸附至軌道（距離超過 ${SNAP_MAX_M} m）`,
      })
      continue
    }

    const leg = resolveLegPathPx(segmentById, adj, fromSnap, toSnap)
    if (!leg.onTrack) {
      followsTracks = false
      brokenLegs.push([
        { x: fromStation.x, y: fromStation.y },
        { x: toStation.x, y: toStation.y },
      ])
      warnings.push({
        fromStationId: fromId,
        toStationId: toId,
        message: `${fromLabel} → ${toLabel}：無連續軌道路徑（路線不可跨越軌道）`,
      })
      continue
    }

    appendPathPoints(pathPx, leg.points)
  }

  return { stations, pathPx, brokenLegs, warnings, followsTracks }
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
): { ok: boolean; reason?: string } {
  const fromResult = stationSnapOrReason(from.xM, from.yM, segmentById)
  const toResult = stationSnapOrReason(to.xM, to.yM, segmentById)
  if (!toResult.snap) {
    return { ok: false, reason: toResult.reason }
  }
  if (!fromResult.snap) {
    return { ok: false, reason: '前一站無法吸附至軌道' }
  }
  const leg = resolveLegPathPx(segmentById, adj, fromResult.snap, toResult.snap)
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

  const { segmentById, adj } = buildTrackRoutingContext(areas)
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
