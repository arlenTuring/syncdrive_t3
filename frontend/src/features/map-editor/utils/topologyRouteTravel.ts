import type { MapAreaObject } from '../types/area'
import type { PointTopology, PointTopologyEdge } from '../types/pointTopology'
import { collectStationsFromAreas } from './dockingPointStationId'
import { stationDisplayLabel } from './routePlanning'

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

/**
 * 站點 stationId → 拓撲停靠節點 facility id。
 */
export function resolveTopologyDockingNodeId(
  topology: PointTopology,
  areas: MapAreaObject[],
  stationId: string,
): string | null {
  const trimmed = stationId.trim()
  if (!trimmed) return null
  const fromTopo = topology.nodes.find(
    (node) => node.kind === 'docking' && node.stationId === trimmed,
  )
  if (fromTopo) return fromTopo.id

  const fromAreas = collectStationsFromAreas(areas).find(
    (station) => station.stationId === trimmed,
  )
  return fromAreas?.facilityId ?? null
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
      message: `無法對應拓撲節點：${fromLabel} → ${toLabel}`,
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
      message: `點位拓撲缺少有向路徑：${fromLabel} → ${toLabel}`,
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
      : `路徑已連通，但尚有邊未填完整時間：${fromLabel} → ${toLabel}`,
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
    warnings.unshift('此地圖尚未建立點位拓撲，無法由拓撲加總行駛時間')
  } else if (stationIds.length >= 2 && !pathsComplete) {
    warnings.unshift('站序無法完全依拓撲連通，請至「編輯點位拓撲」補齊有向連線')
  } else if (stationIds.length >= 2 && !timesComplete) {
    warnings.unshift('拓撲路徑已連通，請為每一條邊填寫最快／平均時間')
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
  if (!leg.pathFound) return '無拓撲路徑'
  const parts: string[] = []
  if (leg.avgTravelTimeSeconds != null) parts.push(`均 ${leg.avgTravelTimeSeconds}s`)
  if (leg.minTravelTimeSeconds != null) parts.push(`快 ${leg.minTravelTimeSeconds}s`)
  if (leg.distanceMeters != null) parts.push(`${leg.distanceMeters} m`)
  if (parts.length === 0) return '路徑已連 · 未填時間'
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
  reason?: string
}

export type TopologyRouteAppendPartition = {
  selectable: TopologyRouteAppendOption[]
  disabled: TopologyRouteAppendOption[]
}

/**
 * 依拓撲有向連通性，決定下一個可加入的停靠點（不再用軌道幾何）。
 * 空站序：凡拓撲中有對應停靠節點者可選。
 */
export function partitionStationsForTopologyRouteAppend(
  topology: PointTopology,
  areas: MapAreaObject[],
  currentStationIds: string[],
): TopologyRouteAppendPartition {
  const all = collectStationsFromAreas(areas)
  const inRoute = new Set(currentStationIds)
  const candidates = all
    .filter((s) => !inRoute.has(s.stationId))
    .sort((a, b) => a.stationName.localeCompare(b.stationName, 'zh-Hant'))

  const selectable: TopologyRouteAppendOption[] = []
  const disabled: TopologyRouteAppendOption[] = []

  if (topology.nodes.filter((n) => n.kind === 'docking').length === 0) {
    return {
      selectable: [],
      disabled: candidates.map((s) => ({
        stationId: s.stationId,
        stationName: s.stationName,
        reason: '尚未建立點位拓撲',
      })),
    }
  }

  const lastId = currentStationIds[currentStationIds.length - 1]

  for (const candidate of candidates) {
    const candNode = resolveTopologyDockingNodeId(
      topology,
      areas,
      candidate.stationId,
    )
    if (!candNode) {
      disabled.push({
        stationId: candidate.stationId,
        stationName: candidate.stationName,
        reason: '不在點位拓撲中',
      })
      continue
    }

    if (!lastId) {
      selectable.push({
        stationId: candidate.stationId,
        stationName: candidate.stationName,
      })
      continue
    }

    const lastNode = resolveTopologyDockingNodeId(topology, areas, lastId)
    if (!lastNode) {
      disabled.push({
        stationId: candidate.stationId,
        stationName: candidate.stationName,
        reason: '路線末端不在拓撲中',
      })
      continue
    }

    const path = findDirectedTopologyPath(topology, lastNode, candNode)
    if (path) {
      selectable.push({
        stationId: candidate.stationId,
        stationName: candidate.stationName,
      })
    } else {
      disabled.push({
        stationId: candidate.stationId,
        stationName: candidate.stationName,
        reason: '拓撲無有向路徑',
      })
    }
  }

  return { selectable, disabled }
}

export function canAppendStationToTopologyRoute(
  topology: PointTopology,
  areas: MapAreaObject[],
  currentStationIds: string[],
  candidateStationId: string,
): boolean {
  const { selectable } = partitionStationsForTopologyRouteAppend(
    topology,
    areas,
    currentStationIds,
  )
  return selectable.some((s) => s.stationId === candidateStationId)
}
