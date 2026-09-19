import type { MapAreaObject } from '../types/area'
import type { PointTopology, PointTopologyEdge } from '../types/pointTopology'
import i18n from '../../../i18n'
import { collectStationsFromAreas } from './dockingPointStationId'
import {
  getFacilityDockingPoint,
  resolveFacilityDockingPointListTitle,
} from './facilityDockingPoint'
import {
  facilityDockingTopologyNodeId,
  parseFacilityIdFromFacilityDockingTopologyNodeId,
} from './pointTopology'
import { stationDisplayLabel } from './routePlanning'
import {
  collectCrossPortalWaypointsFromAreas,
  collectWaypointsFromAreas,
} from './waypointCode'
import { getWaypointCode } from './waypointFacility'
import {
  crossPortalTopologyNodeId,
  parseCrossPortalTopologyNodeId,
} from './crossTrackPortals'

export type TopologyStationLegBreakdown = {
  fromStationId: string
  toStationId: string
  fromNodeId: string | null
  toNodeId: string | null
  /** 路徑上的節點（含起迄與途經點） */
  nodePath: string[]
  edgeIds: string[]
  minTravelTimeSeconds: number | null
  avgTravelTimeSeconds: number | null
  distanceMeters: number | null
  /** 是否找到有向路徑 */
  pathFound: boolean
  /** 路徑上每一段邊的時間／距離都有值 */
  metricsComplete: boolean
  message: string | null
}

export type TopologyRouteTravelBreakdown = {
  legs: TopologyStationLegBreakdown[]
  totalMinTravelTimeSeconds: number | null
  totalAvgTravelTimeSeconds: number | null
  totalDistanceMeters: number | null
  /** 所有相鄰站皆有路徑 */
  pathsComplete: boolean
  /** 所有路徑的時間皆可加總 */
  timesComplete: boolean
  warnings: string[]
}

function buildOutgoingMap(topology: PointTopology): Map<string, PointTopologyEdge[]> {
  const map = new Map<string, PointTopologyEdge[]>()
  for (const edge of topology.edges) {
    const list = map.get(edge.fromNodeId) ?? []
    list.push(edge)
    map.set(edge.fromNodeId, list)
  }
  return map
}

function findFacilityInAreas(areas: MapAreaObject[], facilityId: string) {
  for (const area of areas) {
    const facility = area.facilities.find((f) => f.id === facilityId)
    if (facility) return { area, facility }
  }
  return null
}

function collectFacilityDockingRouteStopsFromAreas(areas: MapAreaObject[]) {
  const stops: Array<{
    stationId: string
    stationName: string
    facilityId: string
    areaId: string
    kind: 'facility-docking'
  }> = []

  for (const area of areas) {
    for (const facility of area.facilities) {
      if (facility.type !== 'Facility') continue
      if (!getFacilityDockingPoint(facility)) continue
      stops.push({
        stationId: facilityDockingTopologyNodeId(facility.id),
        stationName: resolveFacilityDockingPointListTitle(facility),
        facilityId: facility.id,
        areaId: area.id,
        kind: 'facility-docking',
      })
    }
  }
  return stops
}

/**
 * 站點 stationId → 拓撲停靠節點 id（正線停靠＝facility id；設施停靠＝fdock:facilityId）。
 */
export function resolveTopologyDockingNodeId(
  topology: PointTopology,
  areas: MapAreaObject[],
  stationId: string,
): string | null {
  const trimmed = stationId.trim()
  if (!trimmed) return null

  const fdockFacilityId = parseFacilityIdFromFacilityDockingTopologyNodeId(trimmed)
  if (fdockFacilityId) {
    const nodeId = facilityDockingTopologyNodeId(fdockFacilityId)
    const fromTopo = topology.nodes.find(
      (node) => node.kind === 'facility-docking' && node.id === nodeId,
    )
    if (fromTopo) return fromTopo.id

    const hit = findFacilityInAreas(areas, fdockFacilityId)
    if (hit?.facility.type === 'Facility' && getFacilityDockingPoint(hit.facility)) {
      return nodeId
    }
    return null
  }

  const fromTopo = topology.nodes.find(
    (node) => node.kind === 'docking' && node.stationId === trimmed,
  )
  if (fromTopo) return fromTopo.id

  const fromCrossTopo = topology.nodes.find(
    (node) =>
      node.kind === 'cross-waypoint'
      && (node.stationId === trimmed || node.id === trimmed),
  )
  if (fromCrossTopo) return fromCrossTopo.id

  const crossRef = parseCrossPortalTopologyNodeId(trimmed)
  if (crossRef) {
    const nodeId = crossPortalTopologyNodeId(crossRef.facilityId, crossRef.key)
    const exists = topology.nodes.some(
      (node) => node.kind === 'cross-waypoint' && node.id === nodeId,
    )
    if (exists) return nodeId
  }

  const fromCrossAreas = collectCrossPortalWaypointsFromAreas(areas).find(
    (stop) => stop.stationId === trimmed || stop.topologyNodeId === trimmed,
  )
  if (fromCrossAreas) {
    const node = topology.nodes.find(
      (n) => n.kind === 'cross-waypoint' && n.id === fromCrossAreas.topologyNodeId,
    )
    return node?.id ?? fromCrossAreas.topologyNodeId
  }

  const fromAreas = collectStationsFromAreas(areas).find(
    (station) => station.stationId === trimmed,
  )
  if (fromAreas) return fromAreas.facilityId

  const fromWaypointTopo = topology.nodes.find(
    (node) => node.kind === 'waypoint' && node.id === trimmed,
  )
  if (fromWaypointTopo) return fromWaypointTopo.id

  const waypoint = collectWaypointsFromAreas(areas).find(
    (stop) => stop.stationId === trimmed || stop.facilityId === trimmed,
  )
  if (waypoint) {
    const node = topology.nodes.find(
      (n) => n.kind === 'waypoint' && n.id === waypoint.facilityId,
    )
    return node?.id ?? waypoint.facilityId
  }

  // 若呼叫端直接傳 waypointCode，但拓撲尚未載入該節點，仍嘗試用地圖設施 id
  for (const area of areas) {
    for (const facility of area.facilities) {
      if (facility.type !== 'Waypoint') continue
      if (getWaypointCode(facility) === trimmed || facility.id === trimmed) {
        return facility.id
      }
    }
  }

  return null
}

/**
 * 有向圖最短跳數路徑；同跳數時優先「時間資料較完整」再較短平均時間。
 */
export function findDirectedTopologyPath(
  topology: PointTopology,
  fromNodeId: string,
  toNodeId: string,
): { nodeIds: string[]; edgeIds: string[] } | null {
  if (!fromNodeId || !toNodeId) return null
  if (fromNodeId === toNodeId) return { nodeIds: [fromNodeId], edgeIds: [] }

  const outgoing = buildOutgoingMap(topology)
  const queue: string[] = [fromNodeId]
  const prev = new Map<string, { from: string; edgeId: string }>()
  const seen = new Set<string>([fromNodeId])

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of outgoing.get(current) ?? []) {
      if (seen.has(edge.toNodeId)) continue
      seen.add(edge.toNodeId)
      prev.set(edge.toNodeId, { from: current, edgeId: edge.id })
      if (edge.toNodeId === toNodeId) {
        const nodeIds: string[] = [toNodeId]
        const edgeIds: string[] = []
        let cursor = toNodeId
        while (cursor !== fromNodeId) {
          const step = prev.get(cursor)
          if (!step) return null
          edgeIds.unshift(step.edgeId)
          nodeIds.unshift(step.from)
          cursor = step.from
        }
        return { nodeIds, edgeIds }
      }
      queue.push(edge.toNodeId)
    }
  }
  return null
}

function sumEdgeMetrics(
  topology: PointTopology,
  edgeIds: string[],
): {
  minTravelTimeSeconds: number | null
  avgTravelTimeSeconds: number | null
  distanceMeters: number | null
  metricsComplete: boolean
} {
  if (edgeIds.length === 0) {
    return {
      minTravelTimeSeconds: 0,
      avgTravelTimeSeconds: 0,
      distanceMeters: 0,
      metricsComplete: true,
    }
  }
  const byId = new Map(topology.edges.map((edge) => [edge.id, edge] as const))
  let minSum = 0
  let avgSum = 0
  let distSum = 0
  let minOk = true
  let avgOk = true
  let distOk = true
  for (const edgeId of edgeIds) {
    const edge = byId.get(edgeId)
    if (!edge) {
      return {
        minTravelTimeSeconds: null,
        avgTravelTimeSeconds: null,
        distanceMeters: null,
        metricsComplete: false,
      }
    }
    if (edge.minTravelTimeSeconds == null || edge.minTravelTimeSeconds < 0) minOk = false
    else minSum += edge.minTravelTimeSeconds
    if (edge.avgTravelTimeSeconds == null || edge.avgTravelTimeSeconds < 0) avgOk = false
    else avgSum += edge.avgTravelTimeSeconds
    if (edge.distanceMeters == null || edge.distanceMeters < 0) distOk = false
    else distSum += edge.distanceMeters
  }
  return {
    minTravelTimeSeconds: minOk ? Math.round(minSum) : null,
    avgTravelTimeSeconds: avgOk ? Math.round(avgSum) : null,
    distanceMeters: distOk ? Math.round(distSum * 10) / 10 : null,
    metricsComplete: minOk && avgOk,
  }
}

export function buildTopologyStationLegBreakdown(
  topology: PointTopology,
  areas: MapAreaObject[],
  fromStationId: string,
  toStationId: string,
): TopologyStationLegBreakdown {
  const fromNodeId = resolveTopologyDockingNodeId(topology, areas, fromStationId)
  const toNodeId = resolveTopologyDockingNodeId(topology, areas, toStationId)
  const fromLabel = stationDisplayLabel(areas, fromStationId)
  const toLabel = stationDisplayLabel(areas, toStationId)

  if (!fromNodeId || !toNodeId) {
    return {
      fromStationId,
      toStationId,
      fromNodeId,
      toNodeId,
      nodePath: [],
      edgeIds: [],
      minTravelTimeSeconds: null,
      avgTravelTimeSeconds: null,
      distanceMeters: null,
      pathFound: false,
      metricsComplete: false,
      message: i18n.t('mapEditor.routePlanning.legNoNode', {
        from: fromLabel,
        to: toLabel,
      }),
    }
  }

  const path = findDirectedTopologyPath(topology, fromNodeId, toNodeId)
  if (!path) {
    return {
      fromStationId,
      toStationId,
      fromNodeId,
      toNodeId,
      nodePath: [],
      edgeIds: [],
      minTravelTimeSeconds: null,
      avgTravelTimeSeconds: null,
      distanceMeters: null,
      pathFound: false,
      metricsComplete: false,
      message: i18n.t('mapEditor.routePlanning.legNoPath', {
        from: fromLabel,
        to: toLabel,
      }),
    }
  }

  const metrics = sumEdgeMetrics(topology, path.edgeIds)
  return {
    fromStationId,
    toStationId,
    fromNodeId,
    toNodeId,
    nodePath: path.nodeIds,
    edgeIds: path.edgeIds,
    minTravelTimeSeconds: metrics.minTravelTimeSeconds,
    avgTravelTimeSeconds: metrics.avgTravelTimeSeconds,
    distanceMeters: metrics.distanceMeters,
    pathFound: true,
    metricsComplete: metrics.metricsComplete,
    message: metrics.metricsComplete
      ? null
      : i18n.t('mapEditor.routePlanning.legIncompleteTimes', {
          from: fromLabel,
          to: toLabel,
        }),
  }
}

export function buildTopologyRouteTravelBreakdown(
  topology: PointTopology,
  areas: MapAreaObject[],
  stationIds: string[],
): TopologyRouteTravelBreakdown {
  const legs: TopologyStationLegBreakdown[] = []
  const warnings: string[] = []

  for (let i = 0; i < stationIds.length - 1; i += 1) {
    const from = stationIds[i]!
    const to = stationIds[i + 1]!
    const leg = buildTopologyStationLegBreakdown(topology, areas, from, to)
    legs.push(leg)
    if (leg.message) warnings.push(leg.message)
  }

  const pathsComplete = legs.length > 0 && legs.every((leg) => leg.pathFound)
  const timesComplete = pathsComplete && legs.every((leg) => leg.metricsComplete)

  let totalMin: number | null = null
  let totalAvg: number | null = null
  let totalDist: number | null = null
  if (legs.length > 0) {
    if (legs.every((leg) => leg.minTravelTimeSeconds != null)) {
      totalMin = legs.reduce((sum, leg) => sum + (leg.minTravelTimeSeconds ?? 0), 0)
    }
    if (legs.every((leg) => leg.avgTravelTimeSeconds != null)) {
      totalAvg = legs.reduce((sum, leg) => sum + (leg.avgTravelTimeSeconds ?? 0), 0)
    }
    if (legs.every((leg) => leg.distanceMeters != null)) {
      totalDist =
        Math.round(
          legs.reduce((sum, leg) => sum + (leg.distanceMeters ?? 0), 0) * 10,
        ) / 10
    }
  }

  if (stationIds.length >= 2 && topology.nodes.length === 0) {
    warnings.unshift(i18n.t('mapEditor.routePlanning.warnNoTopology'))
  } else if (stationIds.length >= 2 && !pathsComplete) {
    warnings.unshift(i18n.t('mapEditor.routePlanning.warnIncompletePath'))
  } else if (stationIds.length >= 2 && !timesComplete) {
    warnings.unshift(i18n.t('mapEditor.routePlanning.warnIncompleteEdgeTimes'))
  }

  return {
    legs,
    totalMinTravelTimeSeconds: totalMin,
    totalAvgTravelTimeSeconds: totalAvg,
    totalDistanceMeters: totalDist,
    pathsComplete,
    timesComplete,
    warnings,
  }
}

export function formatTopologyLegSummary(leg: TopologyStationLegBreakdown): string {
  if (!leg.pathFound) return i18n.t('mapEditor.routePlanning.legSummaryNoPath')
  const parts: string[] = []
  if (leg.avgTravelTimeSeconds != null) {
    parts.push(
      i18n.t('mapEditor.routePlanning.legSummaryAvg', {
        seconds: leg.avgTravelTimeSeconds,
      }),
    )
  }
  if (leg.minTravelTimeSeconds != null) {
    parts.push(
      i18n.t('mapEditor.routePlanning.legSummaryMin', {
        seconds: leg.minTravelTimeSeconds,
      }),
    )
  }
  if (leg.distanceMeters != null) parts.push(`${leg.distanceMeters} m`)
  if (parts.length === 0) return i18n.t('mapEditor.routePlanning.legSummaryConnectedNoTimes')
  return parts.join(' · ')
}

/**
 * 路線是否依拓撲成立：站序每段皆有有向路徑，且時間可加總。
 * 無此拓撲組合 → 路線不可用。
 */
export function isTopologyRouteCombinationValid(
  topology: PointTopology,
  areas: MapAreaObject[],
  stationIds: string[],
): boolean {
  if (stationIds.length < 2) return false
  const breakdown = buildTopologyRouteTravelBreakdown(topology, areas, stationIds)
  return breakdown.pathsComplete && breakdown.timesComplete
}

/** 僅拓撲路徑存在（時間可未填）— 用於區分「無組合」與「未填時間」 */
export function isTopologyRoutePathConnected(
  topology: PointTopology,
  areas: MapAreaObject[],
  stationIds: string[],
): boolean {
  if (stationIds.length < 2) return false
  return buildTopologyRouteTravelBreakdown(topology, areas, stationIds).pathsComplete
}

export type TopologyRouteAppendOption = {
  stationId: string
  stationName: string
  kind: 'docking' | 'facility-docking' | 'waypoint' | 'cross-waypoint'
  reason?: string
}

export type TopologyRouteAppendPartition = {
  selectable: TopologyRouteAppendOption[]
  disabled: TopologyRouteAppendOption[]
}

/**
 * 路線清單加站：不依上行／下行、道路或拓撲有向連通限制。
 * 僅排除已在站序中的點；特殊案例可自由組站。
 */
export function partitionStationsForTopologyRouteAppend(
  _topology: PointTopology,
  areas: MapAreaObject[],
  currentStationIds: string[],
): TopologyRouteAppendPartition {
  const inRoute = new Set(currentStationIds)
  const selectable: TopologyRouteAppendOption[] = [
    ...collectStationsFromAreas(areas).map((station) => ({
      stationId: station.stationId,
      stationName: station.stationName,
      kind: 'docking' as const,
    })),
    ...collectFacilityDockingRouteStopsFromAreas(areas),
    ...collectWaypointsFromAreas(areas).map((stop) => ({
      stationId: stop.stationId,
      stationName: stop.stationName,
      kind: 'waypoint' as const,
    })),
    ...collectCrossPortalWaypointsFromAreas(areas).map((stop) => ({
      stationId: stop.stationId,
      stationName: stop.stationName,
      kind: 'cross-waypoint' as const,
    })),
  ]
    .filter((candidate) => !inRoute.has(candidate.stationId))
    .sort((a, b) => a.stationName.localeCompare(b.stationName, 'zh-Hant'))

  return { selectable, disabled: [] }
}

export function canAppendStationToTopologyRoute(
  topology: PointTopology,
  areas: MapAreaObject[],
  currentStationIds: string[],
  candidateStationId: string,
): boolean {
  const id = candidateStationId.trim()
  if (!id || currentStationIds.includes(id)) return false
  const { selectable } = partitionStationsForTopologyRouteAppend(
    topology,
    areas,
    currentStationIds,
  )
  return selectable.some((s) => s.stationId === id)
}
