/**
 * 自地圖模擬路線（pathWaypoints／站序）估算拓樸邊實際距離（公尺）。
 * 優先用已繪製的模擬折線；否則用站序兩點的貼軌預覽路徑長度。
 */

import { worldPxToMeters } from '../constants/map'
import type { MapAreaObject } from '../types/area'
import type { MapPlannedRoute, MapRoutePathWaypoint } from '../types/mapFile'
import type { PointTopology, PointTopologyNode } from '../types/pointTopology'
import { resolveRoutePreviewGeometry } from './routeTrackPath'

export type SimRouteDistanceSource = 'pathWaypoints' | 'trackPreview'

export type SimRouteDistanceEstimate = {
  distanceMeters: number
  source: SimRouteDistanceSource
  routeId: string
  routeDisplayName: string
}

/** 拓樸節點在路線站序／折點上可能出現的代號 */
export function topologyNodeRouteCodes(node: PointTopologyNode): Set<string> {
  const codes = new Set<string>()
  codes.add(node.id)
  const sid = typeof node.stationId === 'string' ? node.stationId.trim() : ''
  if (sid) codes.add(sid)
  return codes
}

function codesMatch(codes: Set<string>, stationId: string | undefined): boolean {
  if (typeof stationId !== 'string') return false
  const id = stationId.trim()
  return id.length > 0 && codes.has(id)
}

function roundDistanceM(m: number): number {
  return Math.round(m * 10) / 10
}

function polylineLengthFromField(
  points: ReadonlyArray<Pick<MapRoutePathWaypoint, 'x' | 'y'>>,
): number | null {
  if (points.length < 2) return null
  let sum = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    if (
      typeof a.x !== 'number'
      || typeof a.y !== 'number'
      || typeof b.x !== 'number'
      || typeof b.y !== 'number'
      || !Number.isFinite(a.x)
      || !Number.isFinite(a.y)
      || !Number.isFinite(b.x)
      || !Number.isFinite(b.y)
    ) {
      return null
    }
    sum += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return sum > 0 ? sum : null
}

function polylineLengthFromPx(
  points: ReadonlyArray<{ x: number; y: number }>,
): number | null {
  if (points.length < 2) return null
  let sum = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      return null
    }
    sum += Math.hypot(b.x - a.x, b.y - a.y)
  }
  if (!(sum > 0)) return null
  return worldPxToMeters(sum)
}

/**
 * 在 pathWaypoints 上找 from→to 的直接區段（中間不可有其他帶 stationId 的站點）。
 */
export function extractDirectSimPathSpan(
  waypoints: readonly MapRoutePathWaypoint[],
  fromCodes: Set<string>,
  toCodes: Set<string>,
): MapRoutePathWaypoint[] | null {
  let fromIdx = -1
  for (let i = 0; i < waypoints.length; i += 1) {
    if (codesMatch(fromCodes, waypoints[i]?.stationId)) {
      fromIdx = i
      break
    }
  }
  if (fromIdx < 0) return null
  let toIdx = -1
  for (let j = fromIdx + 1; j < waypoints.length; j += 1) {
    if (codesMatch(toCodes, waypoints[j]?.stationId)) {
      toIdx = j
      break
    }
  }
  if (toIdx < 0) return null
  for (let k = fromIdx + 1; k < toIdx; k += 1) {
    const sid = waypoints[k]?.stationId
    if (typeof sid === 'string' && sid.trim()) return null
  }
  return waypoints.slice(fromIdx, toIdx + 1)
}

function lengthFromPathWaypointsSpan(
  span: MapRoutePathWaypoint[],
): number | null {
  const field = polylineLengthFromField(span)
  if (field != null) return field
  return polylineLengthFromPx(span.map((w) => ({ x: w.px, y: w.py })))
}

function preferredRouteCode(node: PointTopologyNode): string | null {
  const sid = typeof node.stationId === 'string' ? node.stationId.trim() : ''
  if (sid) return sid
  return node.id.trim() ? node.id : null
}

function lengthFromTrackPreview(
  areas: MapAreaObject[],
  pointTopology: PointTopology | null | undefined,
  fromNode: PointTopologyNode,
  toNode: PointTopologyNode,
): number | null {
  const fromId = preferredRouteCode(fromNode)
  const toId = preferredRouteCode(toNode)
  if (!fromId || !toId || fromId === toId) return null
  const geom = resolveRoutePreviewGeometry(areas, [fromId, toId], pointTopology)
  if (!geom.pathLegs[0] || geom.pathLegs[0].length < 2) return null
  return polylineLengthFromPx(geom.pathLegs[0]!)
}

function routeHasDirectedPair(
  route: MapPlannedRoute,
  fromCodes: Set<string>,
  toCodes: Set<string>,
): boolean {
  const wps = route.pathWaypoints
  if (wps && wps.length >= 2) {
    if (extractDirectSimPathSpan(wps, fromCodes, toCodes)) return true
  }
  const ids = route.stationIds
  for (let i = 0; i < ids.length - 1; i += 1) {
    if (codesMatch(fromCodes, ids[i]) && codesMatch(toCodes, ids[i + 1])) {
      return true
    }
  }
  return false
}

/**
 * 在已繪製／規劃的模擬路線中，找與 from→to 最相關的一段並估算公尺距離。
 * 多條路線命中時取最短正值（較直接的模擬路徑）。
 */
export function estimateTopologyEdgeDistanceFromSimRoutes(
  fromNode: PointTopologyNode,
  toNode: PointTopologyNode,
  routes: readonly MapPlannedRoute[],
  areas: MapAreaObject[],
  pointTopology?: PointTopology | null,
): SimRouteDistanceEstimate | null {
  const fromCodes = topologyNodeRouteCodes(fromNode)
  const toCodes = topologyNodeRouteCodes(toNode)
  if (fromCodes.size === 0 || toCodes.size === 0) return null

  let best: SimRouteDistanceEstimate | null = null

  for (const route of routes) {
    if (!routeHasDirectedPair(route, fromCodes, toCodes)) continue
    const displayName =
      (typeof route.displayName === 'string' && route.displayName.trim())
      || route.routeId

    const wps = route.pathWaypoints
    if (wps && wps.length >= 2) {
      const span = extractDirectSimPathSpan(wps, fromCodes, toCodes)
      if (span) {
        const meters = lengthFromPathWaypointsSpan(span)
        if (meters != null && meters > 0) {
          const candidate: SimRouteDistanceEstimate = {
            distanceMeters: roundDistanceM(meters),
            source: 'pathWaypoints',
            routeId: route.routeId,
            routeDisplayName: displayName,
          }
          if (!best || candidate.distanceMeters < best.distanceMeters) {
            best = candidate
          }
          continue
        }
      }
    }

    const trackM = lengthFromTrackPreview(areas, pointTopology, fromNode, toNode)
    if (trackM != null && trackM > 0) {
      const candidate: SimRouteDistanceEstimate = {
        distanceMeters: roundDistanceM(trackM),
        source: 'trackPreview',
        routeId: route.routeId,
        routeDisplayName: displayName,
      }
      if (!best || candidate.distanceMeters < best.distanceMeters) {
        best = candidate
      }
    }
  }

  return best
}
