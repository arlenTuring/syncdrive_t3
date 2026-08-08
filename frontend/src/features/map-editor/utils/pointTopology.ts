import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  emptyPointTopology,
  POINT_TOPOLOGY_VERSION,
  type PointTopology,
  type PointTopologyEdge,
  type PointTopologyNode,
  type PointTopologyNodeKind,
} from '../types/pointTopology'
import {
  getDockingPointStationId,
  getDockingPointStationName,
} from './dockingPointFacility'
import {
  getFacilityDockingPoint,
  resolveFacilityDockingPointTopologyLabel,
} from './facilityDockingPoint'
import {
  crossoverPortalTopologyNodeId,
  getCrossoverPortals,
  parseCrossoverPortalTopologyNodeId,
  resolveCrossoverPortalDisplayName,
  CROSSOVER_PORTAL_KEYS,
} from './trackCrossoverFacility'
import { resolveWaypointDisplayName } from './waypointFacility'
import { collectCrossoverPortalWaypointsFromAreas } from './waypointCode'

const NODE_RADIUS_PX = 36
const LAYOUT_PADDING = 72
const LAYOUT_GAP = 112

/** 設施停靠點拓撲節點 id 前綴（本體仍掛在 Facility 上） */
export const FACILITY_DOCKING_TOPOLOGY_ID_PREFIX = 'fdock:'

export function facilityDockingTopologyNodeId(facilityId: string): string {
  return `${FACILITY_DOCKING_TOPOLOGY_ID_PREFIX}${facilityId}`
}

export function parseFacilityIdFromFacilityDockingTopologyNodeId(
  nodeId: string,
): string | null {
  if (!nodeId.startsWith(FACILITY_DOCKING_TOPOLOGY_ID_PREFIX)) return null
  const id = nodeId.slice(FACILITY_DOCKING_TOPOLOGY_ID_PREFIX.length).trim()
  return id || null
}

/** 路網拓撲依地圖物件類型固定套色 — 中彩度，避免霓虹過亮 */
export const TOPOLOGY_KIND_COLORS: Record<PointTopologyNodeKind, string> = {
  docking: '#5b5fc7',
  waypoint: '#3b8fb8',
  facility: '#4a9e6e',
  /** 與設施綠拉開：暖琥珀 */
  'facility-docking': '#e59a2d',
  /** 虛擬渡線端點途經點 */
  'crossover-waypoint': '#8b7ec8',
}

export function colorForTopologyNodeKind(kind: PointTopologyNodeKind): string {
  return TOPOLOGY_KIND_COLORS[kind]
}

/** 可載入路網拓撲的地圖物件：停靠點、途經點、大型設施（虛擬渡線端點另以 xowp 節點載入） */
export function isTopologyLoadableFacility(facility: FacilityObject): boolean {
  return (
    facility.type === 'DockingPoint'
    || facility.type === 'Waypoint'
    || facility.type === 'Facility'
  )
}

function findFacilityInAreasById(
  areas: MapAreaObject[],
  facilityId: string,
): FacilityObject | null {
  for (const area of areas) {
    const facility = area.facilities.find((item) => item.id === facilityId)
    if (facility) return facility
  }
  return null
}

function collectTopologyFacilities(areas: MapAreaObject[]): FacilityObject[] {
  const list: FacilityObject[] = []
  for (const area of areas) {
    for (const facility of area.facilities) {
      if (isTopologyLoadableFacility(facility)) {
        list.push(facility)
      }
    }
  }
  return list
}

export function labelForTopologyFacility(facility: FacilityObject): string {
  if (facility.type === 'DockingPoint') {
    const custom = facility.customName.trim()
    if (custom) return custom
    const legacy = getDockingPointStationName(facility)
    if (legacy) return legacy
    const stationId = getDockingPointStationId(facility)
    if (stationId) return stationId
    return facility.name
  }
  if (facility.type === 'Waypoint') {
    return resolveWaypointDisplayName(facility) || facility.name
  }
  return facility.customName || facility.name
}

export function kindForTopologyFacility(facility: FacilityObject): PointTopologyNodeKind {
  if (facility.type === 'Waypoint') return 'waypoint'
  if (facility.type === 'Facility') return 'facility'
  return 'docking'
}

export type TopologyLoadCandidate = {
  /** 拓撲節點 id（設施本體＝facility.id；設施停靠點＝fdock:facilityId） */
  nodeId: string
  facilityId: string
  areaId: string
  areaName: string
  kind: PointTopologyNodeKind
  label: string
  alreadyInTopology: boolean
}

/** 地圖上可載入路網的候選（含是否已在拓撲中） */
export function listTopologyLoadCandidates(
  areas: MapAreaObject[],
  topology: PointTopology | null | undefined,
): TopologyLoadCandidate[] {
  const inTopology = new Set((topology?.nodes ?? []).map((node) => node.id))
  const list: TopologyLoadCandidate[] = []
  for (const area of areas) {
    for (const facility of area.facilities) {
      if (facility.type === 'TrackCrossover') {
        const portals = getCrossoverPortals(facility)
        if (!portals) continue
        for (const key of CROSSOVER_PORTAL_KEYS) {
          const portal = portals[key]
          const code = portal.waypointCode?.trim()
          if (!code) continue
          const nodeId = crossoverPortalTopologyNodeId(facility.id, key)
          list.push({
            nodeId,
            facilityId: facility.id,
            areaId: area.id,
            areaName: area.customName || area.id,
            kind: 'crossover-waypoint',
            label: resolveCrossoverPortalDisplayName(portal),
            alreadyInTopology: inTopology.has(nodeId),
          })
        }
        continue
      }
      if (!isTopologyLoadableFacility(facility)) continue
      list.push({
        nodeId: facility.id,
        facilityId: facility.id,
        areaId: area.id,
        areaName: area.customName || area.id,
        kind: kindForTopologyFacility(facility),
        label: labelForTopologyFacility(facility),
        alreadyInTopology: inTopology.has(facility.id),
      })
      if (facility.type === 'Facility' && getFacilityDockingPoint(facility)) {
        const nodeId = facilityDockingTopologyNodeId(facility.id)
        list.push({
          nodeId,
          facilityId: facility.id,
          areaId: area.id,
          areaName: area.customName || area.id,
          kind: 'facility-docking',
          label: resolveFacilityDockingPointTopologyLabel(facility),
          alreadyInTopology: inTopology.has(nodeId),
        })
      }
    }
  }
  list.sort((a, b) => {
    const kindOrder: Record<PointTopologyNodeKind, number> = {
      docking: 0,
      'facility-docking': 1,
      waypoint: 2,
      'crossover-waypoint': 3,
      facility: 4,
    }
    const kd = kindOrder[a.kind] - kindOrder[b.kind]
    if (kd !== 0) return kd
    return a.label.localeCompare(b.label, 'zh-Hant')
  })
  return list
}

function defaultLayoutPosition(index: number, total: number): { x: number; y: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(total, 1))))
  const col = index % cols
  const row = Math.floor(index / cols)
  return {
    x: LAYOUT_PADDING + col * LAYOUT_GAP,
    y: LAYOUT_PADDING + row * LAYOUT_GAP,
  }
}

export function createPointTopologyEdgeId(fromNodeId: string, toNodeId: string): string {
  return `e:${fromNodeId}->${toNodeId}`
}

export function hasCustomEdgeBend(edge: Pick<PointTopologyEdge, 'curveOffsetX' | 'curveOffsetY'>): boolean {
  return (
    (edge.curveOffsetX != null && Number.isFinite(edge.curveOffsetX))
    || (edge.curveOffsetY != null && Number.isFinite(edge.curveOffsetY))
  )
}

export type PointTopologyEdgePathGeometry = {
  x1: number
  y1: number
  x2: number
  y2: number
  cx: number
  cy: number
  midX: number
  midY: number
  nx: number
  ny: number
  pathD: string
  hasCustomBend: boolean
}

/**
 * 計算有向邊在拓撲畫布上的路徑（二次貝塞爾）。
 * 有自訂 bend 時優先；否則整備線依 fan 分扇，其餘為直線（控制點落在弦中）。
 */
export function resolvePointTopologyEdgePath(
  from: Pick<PointTopologyNode, 'x' | 'y'>,
  to: Pick<PointTopologyNode, 'x' | 'y'>,
  options: {
    parallelIndex?: 0 | 1
    fanIndex?: number
    fanCount?: number
    isDispatch?: boolean
    curveOffsetX?: number | null
    curveOffsetY?: number | null
  } = {},
): PointTopologyEdgePathGeometry {
  const parallelIndex = options.parallelIndex ?? 0
  const fanIndex = options.fanIndex ?? 0
  const fanCount = Math.max(options.fanCount ?? 1, 1)
  const isDispatch = options.isDispatch ?? false
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const inset = NODE_RADIUS_PX + 2
  const shift = !isDispatch && parallelIndex === 1 ? 7 : 0
  const x1 = from.x + ux * inset + nx * shift
  const y1 = from.y + uy * inset + ny * shift
  const x2 = to.x - ux * inset + nx * shift
  const y2 = to.y - uy * inset + ny * shift
  const midBaseX = (x1 + x2) / 2
  const midBaseY = (y1 + y2) / 2

  const customX =
    typeof options.curveOffsetX === 'number' && Number.isFinite(options.curveOffsetX)
      ? options.curveOffsetX
      : null
  const customY =
    typeof options.curveOffsetY === 'number' && Number.isFinite(options.curveOffsetY)
      ? options.curveOffsetY
      : null
  const hasCustomBend = customX != null || customY != null

  let cx = midBaseX
  let cy = midBaseY
  if (hasCustomBend) {
    cx = midBaseX + (customX ?? 0)
    cy = midBaseY + (customY ?? 0)
  } else if (isDispatch) {
    const centered = fanIndex - (fanCount - 1) / 2
    const bulge = Math.min(56, 14 + fanCount * 3) * centered
    cx = midBaseX + nx * bulge
    cy = midBaseY + ny * bulge
  }

  const midX = 0.25 * x1 + 0.5 * cx + 0.25 * x2
  const midY = 0.25 * y1 + 0.5 * cy + 0.25 * y2
  return {
    x1,
    y1,
    x2,
    y2,
    cx,
    cy,
    midX,
    midY,
    nx,
    ny,
    pathD: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`,
    hasCustomBend,
  }
}

/**
 * 讓二次貝塞爾的中點（t=0.5）落在目標位置，回傳相對弦中點的控制點偏移。
 */
export function curveOffsetFromDesiredMidpoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  midX: number,
  midY: number,
): { curveOffsetX: number; curveOffsetY: number } {
  const midBaseX = (x1 + x2) / 2
  const midBaseY = (y1 + y2) / 2
  // mid = 0.5 * (midBase + control) → control = 2*mid - midBase
  const cx = 2 * midX - midBaseX
  const cy = 2 * midY - midBaseY
  return {
    curveOffsetX: cx - midBaseX,
    curveOffsetY: cy - midBaseY,
  }
}

/** 兩點之間是否已有該方向邊 */
export function hasDirectedEdge(
  topology: PointTopology,
  fromNodeId: string,
  toNodeId: string,
): boolean {
  return topology.edges.some(
    (edge) => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId,
  )
}

/**
 * 可否新增 A→B：不可自連、不可重複同向；反向可另建一條。
 */
export function canAddDirectedEdge(
  topology: PointTopology,
  fromNodeId: string,
  toNodeId: string,
): boolean {
  if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return false
  if (hasDirectedEdge(topology, fromNodeId, toNodeId)) return false
  return true
}

/**
 * 可否把既有邊的一端改接到 newNodeId（略過該邊自身的重複檢查）。
 */
export function canReconnectDirectedEdge(
  topology: PointTopology,
  edgeId: string,
  end: 'from' | 'to',
  newNodeId: string,
): boolean {
  const edge = topology.edges.find((item) => item.id === edgeId)
  if (!edge || !newNodeId) return false
  const fromNodeId = end === 'from' ? newNodeId : edge.fromNodeId
  const toNodeId = end === 'to' ? newNodeId : edge.toNodeId
  if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return false
  if (fromNodeId === edge.fromNodeId && toNodeId === edge.toNodeId) return true
  return !topology.edges.some(
    (item) =>
      item.id !== edgeId
      && item.fromNodeId === fromNodeId
      && item.toNodeId === toNodeId,
  )
}

/**
 * 將有向邊的一端改接到其他節點；保留時間／距離／彎折。
 * 回傳新 edge id（失敗為 null）。
 */
export function reconnectPointTopologyEdge(
  topology: PointTopology,
  edgeId: string,
  end: 'from' | 'to',
  newNodeId: string,
): { topology: PointTopology; newEdgeId: string | null } {
  const edge = topology.edges.find((item) => item.id === edgeId)
  if (!edge) return { topology, newEdgeId: null }
  if (!canReconnectDirectedEdge(topology, edgeId, end, newNodeId)) {
    return { topology, newEdgeId: null }
  }
  const fromNodeId = end === 'from' ? newNodeId : edge.fromNodeId
  const toNodeId = end === 'to' ? newNodeId : edge.toNodeId
  if (fromNodeId === edge.fromNodeId && toNodeId === edge.toNodeId) {
    return { topology, newEdgeId: edge.id }
  }
  const newEdgeId = createPointTopologyEdgeId(fromNodeId, toNodeId)
  return {
    topology: {
      ...topology,
      edges: topology.edges.map((item) =>
        item.id === edgeId
          ? { ...item, id: newEdgeId, fromNodeId, toNodeId }
          : item,
      ),
    },
    newEdgeId,
  }
}

/** 邊的最快時間不可大於平均時間 */
export function isPointTopologyEdgeTravelInvalid(edge: PointTopologyEdge): boolean {
  return (
    edge.minTravelTimeSeconds != null
    && edge.avgTravelTimeSeconds != null
    && edge.minTravelTimeSeconds > edge.avgTravelTimeSeconds
  )
}

export function listInvalidTravelEdges(topology: PointTopology): PointTopologyEdge[] {
  return topology.edges.filter(isPointTopologyEdgeTravelInvalid)
}

function parsePointTopologyNodeKind(raw: unknown): PointTopologyNodeKind {
  if (raw === 'waypoint') return 'waypoint'
  if (raw === 'facility') return 'facility'
  if (raw === 'facility-docking') return 'facility-docking'
  if (raw === 'crossover-waypoint') return 'crossover-waypoint'
  return 'docking'
}

/**
 * 設施指紋：停靠點／途經點／大型設施／設施停靠點增刪或標籤關鍵欄變更時改變。
 * 用於避免地圖平移等無關 areas 更新反覆改寫拓撲。
 */
export function buildTopologyFacilityFingerprint(areas: MapAreaObject[]): string {
  const parts: string[] = []
  for (const facility of collectTopologyFacilities(areas)) {
    const stationId =
      facility.type === 'DockingPoint' ? getDockingPointStationId(facility) : ''
    parts.push(
      `${facility.id}\0${facility.type}\0${stationId}\0${labelForTopologyFacility(facility)}`,
    )
    if (facility.type === 'Facility') {
      const dock = getFacilityDockingPoint(facility)
      if (dock) {
        parts.push(
          `${facilityDockingTopologyNodeId(facility.id)}\0facility-docking\0${dock.xM}\0${dock.yM}\0${resolveFacilityDockingPointTopologyLabel(facility)}`,
        )
      }
    }
  }
  for (const portal of collectCrossoverPortalWaypointsFromAreas(areas)) {
    parts.push(
      `${portal.topologyNodeId}\0crossover-waypoint\0${portal.stationId}\0${portal.stationName}\0${portal.xM}\0${portal.yM}`,
    )
  }
  parts.sort()
  return parts.join('\n')
}

export function parsePointTopology(raw: unknown): PointTopology {
  if (!raw || typeof raw !== 'object') return emptyPointTopology()
  const o = raw as Record<string, unknown>
  const nodesRaw = Array.isArray(o.nodes) ? o.nodes : []
  const edgesRaw = Array.isArray(o.edges) ? o.edges : []
  const nodes: PointTopologyNode[] = []

  for (const item of nodesRaw) {
    if (!item || typeof item !== 'object') continue
    const n = item as Record<string, unknown>
    const id = typeof n.id === 'string' ? n.id.trim() : ''
    if (!id) continue
    const kind = parsePointTopologyNodeKind(n.kind)
    const label = typeof n.label === 'string' && n.label.trim() ? n.label.trim() : id
    const x = typeof n.x === 'number' && Number.isFinite(n.x) ? n.x : 0
    const y = typeof n.y === 'number' && Number.isFinite(n.y) ? n.y : 0
    const stationId =
      typeof n.stationId === 'string' && n.stationId.trim() ? n.stationId.trim() : undefined
    nodes.push({
      id,
      kind,
      label,
      stationId:
        kind === 'docking' || kind === 'crossover-waypoint' ? stationId : undefined,
      x,
      y,
      color: colorForTopologyNodeKind(kind),
    })
  }

  const nodeIds = new Set(nodes.map((node) => node.id))
  const edgeKeys = new Set<string>()
  const edges: PointTopologyEdge[] = []

  for (const item of edgesRaw) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    const fromNodeId = typeof e.fromNodeId === 'string' ? e.fromNodeId.trim() : ''
    const toNodeId = typeof e.toNodeId === 'string' ? e.toNodeId.trim() : ''
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) continue
    if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) continue
    const key = `${fromNodeId}->${toNodeId}`
    if (edgeKeys.has(key)) continue
    edgeKeys.add(key)
    const id =
      typeof e.id === 'string' && e.id.trim()
        ? e.id.trim()
        : createPointTopologyEdgeId(fromNodeId, toNodeId)
    edges.push({
      id,
      fromNodeId,
      toNodeId,
      minTravelTimeSeconds: parseOptionalPositiveNumber(e.minTravelTimeSeconds),
      avgTravelTimeSeconds: parseOptionalPositiveNumber(e.avgTravelTimeSeconds),
      distanceMeters: parseOptionalPositiveNumber(e.distanceMeters),
      curveOffsetX: parseOptionalFiniteNumber(e.curveOffsetX),
      curveOffsetY: parseOptionalFiniteNumber(e.curveOffsetY),
    })
  }

  return {
    version: POINT_TOPOLOGY_VERSION,
    nodes,
    edges,
  }
}

function parseOptionalPositiveNumber(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  return raw
}

function parseOptionalFiniteNumber(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return raw
}

/**
 * 與地圖設施對帳：只保留仍存在的節點並刷新標籤／種類；
 * **不會**自動把地圖上新點位加入拓撲（需使用者「載入」）。
 * 設施停靠點若父設施刪除或取消設定，對應 `fdock:` 節點一併移除。
 */
export function syncPointTopologyWithAreas(
  topology: PointTopology | null | undefined,
  areas: MapAreaObject[],
): PointTopology {
  const base = topology ?? emptyPointTopology()
  const facilities = collectTopologyFacilities(areas)
  const facilityById = new Map(facilities.map((facility) => [facility.id, facility] as const))
  const nextNodes: PointTopologyNode[] = []

  for (const prev of base.nodes) {
    const parentFacilityId = parseFacilityIdFromFacilityDockingTopologyNodeId(prev.id)
    if (parentFacilityId) {
      const facility = facilityById.get(parentFacilityId)
      if (!facility || facility.type !== 'Facility') continue
      if (!getFacilityDockingPoint(facility)) continue
      const kind: PointTopologyNodeKind = 'facility-docking'
      nextNodes.push({
        id: prev.id,
        kind,
        label: resolveFacilityDockingPointTopologyLabel(facility),
        x: prev.x,
        y: prev.y,
        color: colorForTopologyNodeKind(kind),
      })
      continue
    }

    const crossoverRef = parseCrossoverPortalTopologyNodeId(prev.id)
    if (crossoverRef) {
      const facility = findFacilityInAreasById(areas, crossoverRef.facilityId)
      if (!facility || facility.type !== 'TrackCrossover') continue
      const portals = getCrossoverPortals(facility)
      const portal = portals?.[crossoverRef.key]
      const code = portal?.waypointCode?.trim()
      if (!portal || !code) continue
      const kind: PointTopologyNodeKind = 'crossover-waypoint'
      nextNodes.push({
        id: prev.id,
        kind,
        label: resolveCrossoverPortalDisplayName(portal),
        stationId: code,
        x: prev.x,
        y: prev.y,
        color: colorForTopologyNodeKind(kind),
      })
      continue
    }

    const facility = facilityById.get(prev.id)
    if (!facility) continue
    const kind = kindForTopologyFacility(facility)
    const stationId =
      facility.type === 'DockingPoint' ? getDockingPointStationId(facility) || undefined : undefined
    nextNodes.push({
      id: prev.id,
      kind,
      label: labelForTopologyFacility(facility),
      stationId,
      x: prev.x,
      y: prev.y,
      color: colorForTopologyNodeKind(kind),
    })
  }

  const alive = new Set(nextNodes.map((node) => node.id))
  const edges = base.edges.filter(
    (edge) => alive.has(edge.fromNodeId) && alive.has(edge.toNodeId),
  )

  return {
    version: POINT_TOPOLOGY_VERSION,
    nodes: nextNodes,
    edges,
  }
}

/**
 * 將選定的地圖點位／設施／設施停靠點／虛擬渡線途經點加入路網拓撲（已存在者略過）。
 * `nodeIds` 可為 facility.id、`fdock:${facilityId}`，或 `xowp:${facilityId}:a|b`。
 */
export function addFacilitiesToPointTopology(
  topology: PointTopology,
  areas: MapAreaObject[],
  nodeIds: readonly string[],
): PointTopology {
  if (nodeIds.length === 0) return topology
  const facilityById = new Map<string, FacilityObject>()
  for (const area of areas) {
    for (const facility of area.facilities) {
      if (isTopologyLoadableFacility(facility) || facility.type === 'TrackCrossover') {
        facilityById.set(facility.id, facility)
      }
    }
  }
  const existing = new Set(topology.nodes.map((node) => node.id))
  const nextNodes = [...topology.nodes]
  let addIndex = 0
  for (const nodeId of nodeIds) {
    if (existing.has(nodeId)) continue

    const parentFacilityId = parseFacilityIdFromFacilityDockingTopologyNodeId(nodeId)
    if (parentFacilityId) {
      const facility = facilityById.get(parentFacilityId)
      if (!facility || facility.type !== 'Facility') continue
      if (!getFacilityDockingPoint(facility)) continue
      const kind: PointTopologyNodeKind = 'facility-docking'
      const layout = defaultLayoutPosition(
        topology.nodes.length + addIndex,
        topology.nodes.length + nodeIds.length,
      )
      addIndex += 1
      nextNodes.push({
        id: nodeId,
        kind,
        label: resolveFacilityDockingPointTopologyLabel(facility),
        x: layout.x,
        y: layout.y,
        color: colorForTopologyNodeKind(kind),
      })
      existing.add(nodeId)
      continue
    }

    const crossoverRef = parseCrossoverPortalTopologyNodeId(nodeId)
    if (crossoverRef) {
      const facility = facilityById.get(crossoverRef.facilityId)
      if (!facility || facility.type !== 'TrackCrossover') continue
      const portals = getCrossoverPortals(facility)
      const portal = portals?.[crossoverRef.key]
      const code = portal?.waypointCode?.trim()
      if (!portal || !code) continue
      const kind: PointTopologyNodeKind = 'crossover-waypoint'
      const layout = defaultLayoutPosition(
        topology.nodes.length + addIndex,
        topology.nodes.length + nodeIds.length,
      )
      addIndex += 1
      nextNodes.push({
        id: nodeId,
        kind,
        label: resolveCrossoverPortalDisplayName(portal),
        stationId: code,
        x: layout.x,
        y: layout.y,
        color: colorForTopologyNodeKind(kind),
      })
      existing.add(nodeId)
      continue
    }

    const facility = facilityById.get(nodeId)
    if (!facility || !isTopologyLoadableFacility(facility)) continue
    const kind = kindForTopologyFacility(facility)
    const layout = defaultLayoutPosition(
      topology.nodes.length + addIndex,
      topology.nodes.length + nodeIds.length,
    )
    addIndex += 1
    const stationId =
      facility.type === 'DockingPoint' ? getDockingPointStationId(facility) || undefined : undefined
    nextNodes.push({
      id: facility.id,
      kind,
      label: labelForTopologyFacility(facility),
      stationId,
      x: layout.x,
      y: layout.y,
      color: colorForTopologyNodeKind(kind),
    })
    existing.add(facility.id)
  }
  if (nextNodes.length === topology.nodes.length) return topology
  return {
    ...topology,
    version: POINT_TOPOLOGY_VERSION,
    nodes: nextNodes,
  }
}

/** 自路網拓撲移除節點（並刪除相關邊） */
export function removeNodesFromPointTopology(
  topology: PointTopology,
  nodeIds: readonly string[],
): PointTopology {
  if (nodeIds.length === 0) return topology
  const drop = new Set(nodeIds)
  return {
    ...topology,
    nodes: topology.nodes.filter((node) => !drop.has(node.id)),
    edges: topology.edges.filter(
      (edge) => !drop.has(edge.fromNodeId) && !drop.has(edge.toNodeId),
    ),
  }
}

export function updatePointTopologyNodePosition(
  topology: PointTopology,
  nodeId: string,
  x: number,
  y: number,
): PointTopology {
  return {
    ...topology,
    nodes: topology.nodes.map((node) =>
      node.id === nodeId ? { ...node, x, y } : node,
    ),
  }
}

export function addDirectedEdge(
  topology: PointTopology,
  fromNodeId: string,
  toNodeId: string,
): PointTopology {
  if (!canAddDirectedEdge(topology, fromNodeId, toNodeId)) return topology
  const edge: PointTopologyEdge = {
    id: createPointTopologyEdgeId(fromNodeId, toNodeId),
    fromNodeId,
    toNodeId,
    minTravelTimeSeconds: null,
    avgTravelTimeSeconds: null,
    distanceMeters: null,
    curveOffsetX: null,
    curveOffsetY: null,
  }
  return { ...topology, edges: [...topology.edges, edge] }
}

/** 設施 → 停靠：整備結束後去哪發車（介面語意，非依 id 雜湊） */
export function isDispatchAfterServiceEdge(
  from: PointTopologyNode | undefined,
  to: PointTopologyNode | undefined,
): boolean {
  return from?.kind === 'facility' && to?.kind === 'docking'
}

/** 正線停靠點與設施停靠點：同屬可停靠點語意 */
export function isDockingLikeTopologyKind(
  kind: PointTopologyNodeKind | undefined,
): boolean {
  return kind === 'docking' || kind === 'facility-docking'
}

/**
 * 設施本體 ↔ 停靠類（正線停靠／設施停靠）：整備相關連線，圖上畫虛線。
 * 正線停靠 ↔ 設施停靠 為實線（同停靠語意）。
 */
export function isServiceFacilityLinkEdge(
  from: PointTopologyNode | undefined,
  to: PointTopologyNode | undefined,
): boolean {
  if (!from || !to) return false
  if (from.kind === 'facility' && isDockingLikeTopologyKind(to.kind)) return true
  if (to.kind === 'facility' && isDockingLikeTopologyKind(from.kind)) return true
  return false
}

/** 取得設施目前指定的發車停靠點（若有多條，取第一條） */
export function findFacilityDispatchDockingId(
  topology: PointTopology,
  facilityNodeId: string,
): string | null {
  const nodeById = new Map(topology.nodes.map((node) => [node.id, node] as const))
  for (const edge of topology.edges) {
    if (edge.fromNodeId !== facilityNodeId) continue
    const to = nodeById.get(edge.toNodeId)
    if (to?.kind === 'docking') return to.id
  }
  return null
}

/**
 * 設定設施整備後的發車停靠點：
 * 清除該設施既有「→ 停靠」連線，再視需要建立一條新的。
 */
export function setFacilityDispatchDocking(
  topology: PointTopology,
  facilityNodeId: string,
  dockingNodeId: string | null,
): PointTopology {
  const nodeById = new Map(topology.nodes.map((node) => [node.id, node] as const))
  const facility = nodeById.get(facilityNodeId)
  if (!facility || facility.kind !== 'facility') return topology

  const nextEdges = topology.edges.filter((edge) => {
    if (edge.fromNodeId !== facilityNodeId) return true
    const to = nodeById.get(edge.toNodeId)
    return to?.kind !== 'docking'
  })
  let next: PointTopology = { ...topology, edges: nextEdges }
  if (!dockingNodeId) return next
  const docking = nodeById.get(dockingNodeId)
  if (!docking || docking.kind !== 'docking') return next
  return addDirectedEdge(next, facilityNodeId, dockingNodeId)
}

export function removePointTopologyEdge(
  topology: PointTopology,
  edgeId: string,
): PointTopology {
  return {
    ...topology,
    edges: topology.edges.filter((edge) => edge.id !== edgeId),
  }
}

export function updatePointTopologyEdge(
  topology: PointTopology,
  edgeId: string,
  patch: Partial<
    Pick<
      PointTopologyEdge,
      | 'minTravelTimeSeconds'
      | 'avgTravelTimeSeconds'
      | 'distanceMeters'
      | 'curveOffsetX'
      | 'curveOffsetY'
    >
  >,
): PointTopology {
  return {
    ...topology,
    edges: topology.edges.map((edge) =>
      edge.id === edgeId ? { ...edge, ...patch } : edge,
    ),
  }
}

/** 對向邊是否已存在（存在則無法直接反轉，否則會撞 id） */
export function canReversePointTopologyEdge(
  topology: PointTopology,
  edgeId: string,
): boolean {
  const edge = topology.edges.find((item) => item.id === edgeId)
  if (!edge) return false
  return !hasDirectedEdge(topology, edge.toNodeId, edge.fromNodeId)
}

/**
 * 反轉有向邊 from→to 為 to→from，保留時間／距離。
 * 若對向已存在則不變（請先刪對向或改編輯對向邊）。
 * 回傳新 edge id（失敗為 null）。
 */
export function reversePointTopologyEdge(
  topology: PointTopology,
  edgeId: string,
): { topology: PointTopology; newEdgeId: string | null } {
  const edge = topology.edges.find((item) => item.id === edgeId)
  if (!edge) return { topology, newEdgeId: null }
  if (!canReversePointTopologyEdge(topology, edgeId)) {
    return { topology, newEdgeId: null }
  }
  const fromNodeId = edge.toNodeId
  const toNodeId = edge.fromNodeId
  const newEdgeId = createPointTopologyEdgeId(fromNodeId, toNodeId)
  return {
    topology: {
      ...topology,
      edges: topology.edges.map((item) =>
        item.id === edgeId
          ? { ...item, id: newEdgeId, fromNodeId, toNodeId }
          : item,
      ),
    },
    newEdgeId,
  }
}

/**
 * 設為雙向：在 from→to 之外自動補一條 to→from，時間與距離沿用原邊。
 *
 * 資料模型本來就是有向邊、且「兩節點之間最多兩條邊」，所以雙向不另立旗標，
 * 就是把反向那一條補齊——這樣所有讀拓樸的地方（整備後發車、站間行駛、
 * 路徑搜尋）都不必為了雙向改任何一行；一條反向有向邊本來就走得通。
 *
 * 對向已存在時不動作（已經是雙向了）。回傳新邊 id（沒建立則為 null）。
 */
export function makePointTopologyEdgeBidirectional(
  topology: PointTopology,
  edgeId: string,
): { topology: PointTopology; newEdgeId: string | null } {
  const edge = topology.edges.find((item) => item.id === edgeId)
  if (!edge) return { topology, newEdgeId: null }
  if (hasDirectedEdge(topology, edge.toNodeId, edge.fromNodeId)) {
    return { topology, newEdgeId: null }
  }
  const fromNodeId = edge.toNodeId
  const toNodeId = edge.fromNodeId
  const newEdgeId = createPointTopologyEdgeId(fromNodeId, toNodeId)
  const reverse: PointTopologyEdge = {
    ...edge,
    id: newEdgeId,
    fromNodeId,
    toNodeId,
    // 線徑彎折不沿用：兩條線同弦反向，套同一組偏移會疊在一起看不出是兩條
    curveOffsetX: null,
    curveOffsetY: null,
  }
  return {
    topology: { ...topology, edges: [...topology.edges, reverse] },
    newEdgeId,
  }
}

/** 這條邊的對向是否已存在（＝這一對節點已經是雙向） */
export function isPointTopologyEdgeBidirectional(
  topology: PointTopology,
  edgeId: string,
): boolean {
  const edge = topology.edges.find((item) => item.id === edgeId)
  if (!edge) return false
  return hasDirectedEdge(topology, edge.toNodeId, edge.fromNodeId)
}

/** 找這條邊的對向邊 id；沒有回 null */
export function findOppositePointTopologyEdgeId(
  topology: PointTopology,
  edgeId: string,
): string | null {
  const edge = topology.edges.find((item) => item.id === edgeId)
  if (!edge) return null
  return (
    topology.edges.find(
      (item) =>
        item.fromNodeId === edge.toNodeId && item.toNodeId === edge.fromNodeId,
    )?.id ?? null
  )
}

/**
 * 以 from→to 方向展開子樹（含起點）：跟隨向外邊，不走回已訪節點。
 */
export function collectSubtreeNodeIds(
  topology: PointTopology,
  rootNodeId: string,
): string[] {
  const outgoing = new Map<string, string[]>()
  for (const edge of topology.edges) {
    const list = outgoing.get(edge.fromNodeId) ?? []
    list.push(edge.toNodeId)
    outgoing.set(edge.fromNodeId, list)
  }
  const result: string[] = []
  const queue = [rootNodeId]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
    for (const next of outgoing.get(id) ?? []) {
      if (!seen.has(next)) queue.push(next)
    }
  }
  return result
}

export function movePointTopologyNodesByDelta(
  topology: PointTopology,
  nodeIds: ReadonlySet<string> | readonly string[],
  dx: number,
  dy: number,
): PointTopology {
  const idSet = nodeIds instanceof Set ? nodeIds : new Set(nodeIds)
  if (idSet.size === 0 || (dx === 0 && dy === 0)) return topology

  // 允許負座標：畫布四周有大留白，不應把節點卡在 (r,r) 邊界
  return {
    ...topology,
    nodes: topology.nodes.map((node) => {
      if (!idSet.has(node.id)) return node
      return {
        ...node,
        x: node.x + dx,
        y: node.y + dy,
      }
    }),
  }
}

export function findPointTopologyEdge(
  topology: PointTopology,
  edgeId: string,
): PointTopologyEdge | null {
  return topology.edges.find((edge) => edge.id === edgeId) ?? null
}

export function labelForTopologyNode(
  topology: PointTopology,
  nodeId: string,
): string {
  return topology.nodes.find((node) => node.id === nodeId)?.label ?? nodeId
}

/** pointer 事件是否按住子樹拖曳修飾鍵（Mac Option／其他 Alt） */
export function isSubtreeDragModifierPressed(event: {
  altKey: boolean
}): boolean {
  return event.altKey
}

export function topologySubtreeDragModifierLabel(platform: string = navigator.platform): string {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform)
  return isMac
    ? '拖曳圓點移動佈局；按住 Option（⌥）可連同向外連線的子節點一起拖。點選圓點後從小錨點拉線建立有向邊。'
    : '拖曳圓點移動佈局；按住 Alt 可連同向外連線的子節點一起拖。點選圓點後從小錨點拉線建立有向邊。'
}

export { NODE_RADIUS_PX }
