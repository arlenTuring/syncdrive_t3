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
import { getWaypointCode } from './waypointFacility'

const NODE_RADIUS_PX = 36
const LAYOUT_PADDING = 72
const LAYOUT_GAP = 112

/** 依節點 id 產生穩定 HSL 色相，並微調避免同圖內撞色 */
export function colorForTopologyNodeId(
  nodeId: string,
  occupied: ReadonlySet<string> = new Set(),
): string {
  let hash = 0
  for (let i = 0; i < nodeId.length; i += 1) {
    hash = (hash * 31 + nodeId.charCodeAt(i)) >>> 0
  }
  let hue = hash % 360
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const color = hslToHex(hue, 62, 52)
    if (!occupied.has(color.toLowerCase())) return color
    hue = (hue + 37) % 360
  }
  return hslToHex(hue, 62, 52)
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const light = l / 100
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = light - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const toByte = (v: number) => Math.round((v + m) * 255)
  return `#${[toByte(r), toByte(g), toByte(b)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`
}

function collectTopologyFacilities(areas: MapAreaObject[]): FacilityObject[] {
  const list: FacilityObject[] = []
  for (const area of areas) {
    for (const facility of area.facilities) {
      if (facility.type === 'DockingPoint' || facility.type === 'Waypoint') {
        list.push(facility)
      }
    }
  }
  return list
}

function labelForFacility(facility: FacilityObject): string {
  if (facility.type === 'DockingPoint') {
    const name = getDockingPointStationName(facility)
    const stationId = getDockingPointStationId(facility)
    if (name) return name
    if (stationId) return stationId
    return facility.customName || facility.name || facility.id
  }
  if (facility.type === 'Waypoint') {
    const code = getWaypointCode(facility)
    if (code) return code
    return facility.customName || facility.name || facility.id
  }
  return facility.customName || facility.id
}

function kindForFacility(facility: FacilityObject): PointTopologyNodeKind {
  return facility.type === 'Waypoint' ? 'waypoint' : 'docking'
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

/**
 * 設施指紋：僅停靠點／途經點增刪或 stationId／標籤關鍵欄變更時改變。
 * 用於避免地圖平移等無關 areas 更新反覆改寫拓撲。
 */
export function buildTopologyFacilityFingerprint(areas: MapAreaObject[]): string {
  const parts: string[] = []
  for (const facility of collectTopologyFacilities(areas)) {
    const stationId =
      facility.type === 'DockingPoint' ? getDockingPointStationId(facility) : ''
    parts.push(
      `${facility.id}\0${facility.type}\0${stationId}\0${labelForFacility(facility)}`,
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
  const usedColors = new Set<string>()
  const nodes: PointTopologyNode[] = []

  for (const item of nodesRaw) {
    if (!item || typeof item !== 'object') continue
    const n = item as Record<string, unknown>
    const id = typeof n.id === 'string' ? n.id.trim() : ''
    if (!id) continue
    const kind: PointTopologyNodeKind = n.kind === 'waypoint' ? 'waypoint' : 'docking'
    const label = typeof n.label === 'string' && n.label.trim() ? n.label.trim() : id
    const x = typeof n.x === 'number' && Number.isFinite(n.x) ? n.x : 0
    const y = typeof n.y === 'number' && Number.isFinite(n.y) ? n.y : 0
    const stationId =
      typeof n.stationId === 'string' && n.stationId.trim() ? n.stationId.trim() : undefined
    let color =
      typeof n.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(n.color)
        ? n.color
        : colorForTopologyNodeId(id, usedColors)
    if (usedColors.has(color.toLowerCase())) {
      color = colorForTopologyNodeId(`${id}:alt`, usedColors)
    }
    usedColors.add(color.toLowerCase())
    nodes.push({ id, kind, label, stationId, x, y, color })
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

/**
 * 依目前地圖設施同步拓撲節點：補齊新增、移除已刪、刷新標籤／顏色保留佈局。
 */
export function syncPointTopologyWithAreas(
  topology: PointTopology | null | undefined,
  areas: MapAreaObject[],
): PointTopology {
  const base = topology ?? emptyPointTopology()
  const facilities = collectTopologyFacilities(areas)
  const prevById = new Map(base.nodes.map((node) => [node.id, node] as const))
  const usedColors = new Set<string>()
  const nextNodes: PointTopologyNode[] = []

  facilities.forEach((facility, index) => {
    const prev = prevById.get(facility.id)
    let color = prev?.color
    if (!color || usedColors.has(color.toLowerCase())) {
      color = colorForTopologyNodeId(facility.id, usedColors)
    }
    usedColors.add(color.toLowerCase())
    const layout =
      prev != null
        ? { x: prev.x, y: prev.y }
        : defaultLayoutPosition(index, facilities.length)
    const stationId =
      facility.type === 'DockingPoint' ? getDockingPointStationId(facility) || undefined : undefined
    nextNodes.push({
      id: facility.id,
      kind: kindForFacility(facility),
      label: labelForFacility(facility),
      stationId,
      x: layout.x,
      y: layout.y,
      color,
    })
  })

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
  }
  return { ...topology, edges: [...topology.edges, edge] }
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
      'minTravelTimeSeconds' | 'avgTravelTimeSeconds' | 'distanceMeters'
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

  // 整組一起 clamp，避免子樹拖到邊界時相對位置被個別擠扁
  let adjDx = dx
  let adjDy = dy
  for (const node of topology.nodes) {
    if (!idSet.has(node.id)) continue
    if (node.x + adjDx < NODE_RADIUS_PX) adjDx = NODE_RADIUS_PX - node.x
    if (node.y + adjDy < NODE_RADIUS_PX) adjDy = NODE_RADIUS_PX - node.y
  }
  if (adjDx === 0 && adjDy === 0) return topology

  return {
    ...topology,
    nodes: topology.nodes.map((node) => {
      if (!idSet.has(node.id)) return node
      return {
        ...node,
        x: node.x + adjDx,
        y: node.y + adjDy,
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
