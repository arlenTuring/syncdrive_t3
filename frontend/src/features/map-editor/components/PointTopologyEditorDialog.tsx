import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { MapAreaObject } from '../types/area'
import type {
  PointTopology,
  PointTopologyEdge,
  PointTopologyNode,
  PointTopologyNodeKind,
} from '../types/pointTopology'
import { getFacilityDockingPoint } from '../utils/facilityDockingPoint'
import { resolveFacilityFieldMeters } from '../utils/facilityListEntries'
import {
  addDirectedEdge,
  addFacilitiesToPointTopology,
  canAddDirectedEdge,
  canReconnectDirectedEdge,
  canReversePointTopologyEdge,
  findOppositePointTopologyEdgeId,
  isPointTopologyEdgeBidirectional,
  makePointTopologyEdgeBidirectional,
  collectSubtreeNodeIds,
  createPointTopologyEdgeId,
  curveOffsetFromDesiredMidpoint,
  facilityDockingTopologyNodeId,
  findFacilityDispatchDockingId,
  hasCustomEdgeBend,
  isDispatchAfterServiceEdge,
  isServiceFacilityLinkEdge,
  isSubtreeDragModifierPressed,
  labelForTopologyNode,
  listInvalidTravelEdges,
  listTopologyLoadCandidates,
  movePointTopologyNodesByDelta,
  NODE_RADIUS_PX,
  reconnectPointTopologyEdge,
  removeNodesFromPointTopology,
  removePointTopologyEdge,
  resolvePointTopologyEdgePath,
  reversePointTopologyEdge,
  setFacilityDispatchDocking,
  syncPointTopologyWithAreas,
  TOPOLOGY_KIND_COLORS,
  updatePointTopologyEdge,
} from '../utils/pointTopology'

/** 拓撲畫布四周留白，便於平移，並讓任意點位可捲到畫面正中心 */
const CANVAS_PAN_PAD_PX = 2400

type PointTopologyEditorDialogProps = {
  open: boolean
  areas: MapAreaObject[]
  topology: PointTopology
  onClose: () => void
  onApply: (topology: PointTopology) => void
}

type LinkDraft = {
  fromNodeId: string
  /** 連線起點（錨點位置） */
  startX: number
  startY: number
  pointerX: number
  pointerY: number
  /** 磁吸中的目標節點 */
  hoverTargetId: string | null
}

/** 拖曳既有邊的一端，改接到其他節點 */
type ReconnectDraft = {
  edgeId: string
  end: 'from' | 'to'
  fixedNodeId: string
  startX: number
  startY: number
  pointerX: number
  pointerY: number
  hoverTargetId: string | null
}

const ANCHOR_OFFSET = NODE_RADIUS_PX + 10
const ANCHOR_SIZE = 10
const RECONNECT_HANDLE_SIZE = 14
const DRAG_CLICK_THRESHOLD_PX = 4
/** 連線磁吸半徑（含圓外圍） */
const LINK_MAGNET_RADIUS_PX = NODE_RADIUS_PX + 36
/** 自由拖曳時對齊水平／垂直的磁吸閾值 */
const AXIS_SNAP_PX = 14
/** 拖曳節點時對齊其他節點座標軸的磁吸閾值 */
const NODE_ALIGN_SNAP_PX = 10

function cloneTopology(topology: PointTopology): PointTopology {
  return structuredClone(topology)
}

function contrastText(hex: string): string {
  const raw = hex.replace('#', '')
  if (raw.length !== 6) return '#fff'
  const r = Number.parseInt(raw.slice(0, 2), 16)
  const g = Number.parseInt(raw.slice(2, 4), 16)
  const b = Number.parseInt(raw.slice(4, 6), 16)
  // 綠／黃系在相同明度下感知亮度偏高，門檻過低會讓同組節點有的黑字、有的白字
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luma > 0.78 ? '#18181b' : '#fafafa'
}

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return null
  return value
}

/** 連線預覽／放開時的磁吸：吸到目標圓緣，否則對齊來源水平／垂直 */
function resolveLinkMagnet(args: {
  from: PointTopologyNode
  pointerX: number
  pointerY: number
  nodes: PointTopologyNode[]
  topology: PointTopology
}): {
  pointerX: number
  pointerY: number
  hoverTargetId: string | null
  snapped: boolean
} {
  const { from, pointerX, pointerY, nodes, topology } = args
  let best: PointTopologyNode | null = null
  let bestDist = LINK_MAGNET_RADIUS_PX

  for (const node of nodes) {
    if (node.id === from.id) continue
    if (!canAddDirectedEdge(topology, from.id, node.id)) continue
    const dist = Math.hypot(node.x - pointerX, node.y - pointerY)
    if (dist <= bestDist) {
      best = node
      bestDist = dist
    }
  }

  if (best) {
    const dx = best.x - from.x
    const dy = best.y - from.y
    const len = Math.hypot(dx, dy) || 1
    return {
      pointerX: best.x - (dx / len) * NODE_RADIUS_PX,
      pointerY: best.y - (dy / len) * NODE_RADIUS_PX,
      hoverTargetId: best.id,
      snapped: true,
    }
  }

  let x = pointerX
  let y = pointerY
  if (Math.abs(pointerY - from.y) <= AXIS_SNAP_PX) y = from.y
  if (Math.abs(pointerX - from.x) <= AXIS_SNAP_PX) x = from.x
  return {
    pointerX: x,
    pointerY: y,
    hoverTargetId: null,
    snapped: x !== pointerX || y !== pointerY,
  }
}

/** 改接邊一端時的磁吸（略過該邊自身的重複檢查） */
function resolveReconnectMagnet(args: {
  fixed: PointTopologyNode
  edgeId: string
  end: 'from' | 'to'
  pointerX: number
  pointerY: number
  nodes: PointTopologyNode[]
  topology: PointTopology
}): {
  pointerX: number
  pointerY: number
  hoverTargetId: string | null
  snapped: boolean
} {
  const { fixed, edgeId, end, pointerX, pointerY, nodes, topology } = args
  let best: PointTopologyNode | null = null
  let bestDist = LINK_MAGNET_RADIUS_PX

  for (const node of nodes) {
    if (node.id === fixed.id) continue
    if (!canReconnectDirectedEdge(topology, edgeId, end, node.id)) continue
    const dist = Math.hypot(node.x - pointerX, node.y - pointerY)
    if (dist <= bestDist) {
      best = node
      bestDist = dist
    }
  }

  if (best) {
    const dx = best.x - fixed.x
    const dy = best.y - fixed.y
    const len = Math.hypot(dx, dy) || 1
    return {
      pointerX: best.x - (dx / len) * NODE_RADIUS_PX,
      pointerY: best.y - (dy / len) * NODE_RADIUS_PX,
      hoverTargetId: best.id,
      snapped: true,
    }
  }

  let x = pointerX
  let y = pointerY
  if (Math.abs(pointerY - fixed.y) <= AXIS_SNAP_PX) y = fixed.y
  if (Math.abs(pointerX - fixed.x) <= AXIS_SNAP_PX) x = fixed.x
  return {
    pointerX: x,
    pointerY: y,
    hoverTargetId: null,
    snapped: x !== pointerX || y !== pointerY,
  }
}

/** 拖曳節點時對齊其他節點的 x／y（十字磁吸） */
function snapNodeCenterToPeers(
  x: number,
  y: number,
  nodeId: string,
  nodes: PointTopologyNode[],
): { x: number; y: number; alignedX: boolean; alignedY: boolean } {
  let nextX = x
  let nextY = y
  let alignedX = false
  let alignedY = false
  let bestDx = NODE_ALIGN_SNAP_PX
  let bestDy = NODE_ALIGN_SNAP_PX
  for (const peer of nodes) {
    if (peer.id === nodeId) continue
    const dx = Math.abs(peer.x - x)
    const dy = Math.abs(peer.y - y)
    if (dx < bestDx) {
      bestDx = dx
      nextX = peer.x
      alignedX = true
    }
    if (dy < bestDy) {
      bestDy = dy
      nextY = peer.y
      alignedY = true
    }
  }
  return { x: nextX, y: nextY, alignedX, alignedY }
}

/** 雙向邊略作平行偏移、整備分扇、自訂彎折 — 見 resolvePointTopologyEdgePath */

/** 線旁簡要標籤：橫式一列「快／均／距」；沒填就不顯示標籤 */
function formatEdgeBrief(edge: PointTopologyEdge): string {
  const parts: string[] = []
  if (edge.minTravelTimeSeconds != null) parts.push(`快${edge.minTravelTimeSeconds}s`)
  if (edge.avgTravelTimeSeconds != null) parts.push(`均${edge.avgTravelTimeSeconds}s`)
  if (edge.distanceMeters != null) {
    const meters =
      Number.isInteger(edge.distanceMeters)
        ? String(edge.distanceMeters)
        : String(Math.round(edge.distanceMeters * 10) / 10)
    parts.push(`${meters}m`)
  }
  return parts.join(' · ')
}

function EdgeArrow({
  edge,
  twin,
  from,
  to,
  parallelIndex,
  fanIndex,
  fanCount,
  selected,
  emphasized,
  dimmed,
  bending,
  onSelect,
  onBendPointerDown,
  onBendPointerMove,
  onBendPointerUp,
  onResetBend,
  onDoubleClickEdge,
}: {
  edge: PointTopologyEdge
  /**
   * 對向邊。有值＝這一對節點是雙向：只畫<strong>一條</strong>線、兩端各一個箭頭，
   * 不畫成兩條平行線（兩條線在畫面上很擠，也讓人以為是兩條不同的路）。
   */
  twin: PointTopologyEdge | null
  from: PointTopologyNode
  to: PointTopologyNode
  parallelIndex: 0 | 1
  fanIndex: number
  fanCount: number
  selected: boolean
  emphasized: boolean
  dimmed: boolean
  bending: boolean
  onSelect: () => void
  onDoubleClickEdge: () => void
  onBendPointerDown: (event: ReactPointerEvent<SVGElement>) => void
  onBendPointerMove: (event: ReactPointerEvent<SVGElement>) => void
  onBendPointerUp: (event: ReactPointerEvent<SVGElement>) => void
  onResetBend: () => void
}) {
  const isDispatch = isDispatchAfterServiceEdge(from, to)
  const isServiceLink = isServiceFacilityLinkEdge(from, to)
  const path = resolvePointTopologyEdgePath(from, to, {
    parallelIndex,
    fanIndex,
    fanCount: Math.max(fanCount, 1),
    isDispatch,
    curveOffsetX: edge.curveOffsetX,
    curveOffsetY: edge.curveOffsetY,
  })
  const { x1, y1, x2, y2, midX, midY, nx, ny, pathD } = path

  const stroke = selected
    ? '#22d3ee'
    : isServiceLink
      ? emphasized
        ? '#7cb87f'
        : '#6b9a6e'
      : emphasized
        ? '#c4c4c8'
        : '#8b8b92'
  const opacity = selected || emphasized ? 1 : dimmed ? 0.22 : isServiceLink ? 0.72 : 0.88
  const markerId = `topo-arrow-${edge.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const startMarkerId = `${markerId}-start`
  const twinBrief = twin ? formatEdgeBrief(twin) : ''
  const selfBrief = formatEdgeBrief(edge)
  // 雙向且兩邊時間距離一樣時只顯示一組，不要讓標籤變兩倍長；不一樣才分開標
  const brief =
    twin && twinBrief && twinBrief !== selfBrief
      ? `→ ${selfBrief} ／ ← ${twinBrief}`
      : selfBrief
  const boxW = Math.min(260, Math.max(72, brief.length * 7 + 16))
  const boxH = 22
  const clearGap = 6
  const side = parallelIndex === 1 ? -1 : 1
  const labelOffset = side * (boxH / 2 + clearGap)
  const labelX = midX + nx * labelOffset
  const labelY = midY + ny * labelOffset
  const strokeWidth = selected || bending ? 2.5 : emphasized ? 2 : isServiceLink ? 1.35 : 1.6
  const customBend = hasCustomEdgeBend(edge)

  return (
    <g
      className={bending ? 'cursor-grabbing' : 'cursor-grab'}
      opacity={opacity}
      onPointerDown={onBendPointerDown}
      onPointerMove={onBendPointerMove}
      onPointerUp={onBendPointerUp}
      onPointerCancel={onBendPointerUp}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onDoubleClickEdge()
        if (customBend) onResetBend()
      }}
    >
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill={stroke} />
        </marker>
        {twin ? (
          <marker
            id={startMarkerId}
            markerWidth="8"
            markerHeight="8"
            refX="0"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M6,0 L0,3 L6,6 Z" fill={stroke} />
          </marker>
        ) : null}
      </defs>
      <path d={pathD} fill="none" stroke="transparent" strokeWidth={16} />
      <path
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={isServiceLink ? '5 5' : undefined}
        markerEnd={`url(#${markerId})`}
        markerStart={twin ? `url(#${startMarkerId})` : undefined}
      />
      {(selected || emphasized || bending || customBend || !isServiceLink) && (
        <circle
          cx={midX}
          cy={midY}
          r={selected || bending ? 5.5 : 2.5}
          fill={stroke}
          stroke={selected || bending ? '#083344' : 'none'}
          strokeWidth={selected || bending ? 1.5 : 0}
        />
      )}
      {brief && (selected || emphasized || !dimmed) ? (
        <g transform={`translate(${labelX}, ${labelY})`} className="pointer-events-none">
          <foreignObject
            x={-boxW / 2}
            y={-boxH / 2}
            width={boxW}
            height={boxH}
            className="overflow-visible pointer-events-none"
          >
            <div className="flex h-full w-full items-center justify-center">
              <div
                className={[
                  'rounded-md border px-1.5 py-0.5 shadow-sm whitespace-nowrap text-[9px] font-medium leading-none tabular-nums',
                  selected
                    ? 'border-cyan-500/60 bg-cyan-950/95 text-cyan-100'
                    : 'border-zinc-600/80 bg-zinc-950/90 text-zinc-200',
                ].join(' ')}
              >
                {brief}
              </div>
            </div>
          </foreignObject>
        </g>
      ) : null}
      <title>
        {`${from.label} → ${to.label}｜中點拖曳彎折；兩端白點拖到其他節點可改接${
          customBend ? '｜雙擊重設彎折' : ''
        }`}
      </title>
    </g>
  )
}

export function PointTopologyEditorDialog({
  open,
  areas,
  topology,
  onClose,
  onApply,
}: PointTopologyEditorDialogProps) {
  const [draft, setDraft] = useState<PointTopology>(() =>
    syncPointTopologyWithAreas(topology, areas),
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  /** 雙擊節點／邊才打開屬性側欄；單擊只選取 */
  const [inspectorTarget, setInspectorTarget] = useState<
    | { kind: 'edge'; id: string }
    | { kind: 'node'; id: string }
    | null
  >(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [bendingEdgeId, setBendingEdgeId] = useState<string | null>(null)
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)
  const [reconnectDraft, setReconnectDraft] = useState<ReconnectDraft | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [listQuery, setListQuery] = useState('')
  const [legendOpen, setLegendOpen] = useState(false)
  const [historyEpoch, setHistoryEpoch] = useState(0)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const dragStartRef = useRef({ x: 0, y: 0, moved: false, subtree: false })
  const lastPointerRef = useRef({ x: 0, y: 0 })
  const edgeBendStartRef = useRef({ x: 0, y: 0, moved: false })
  const historyRef = useRef<{ past: PointTopology[]; future: PointTopology[] }>({
    past: [],
    future: [],
  })
  const historyBaselineRef = useRef<PointTopology | null>(null)
  const reconnectSessionRef = useRef<{
    edgeId: string
    end: 'from' | 'to'
    fixedNodeId: string
    startX: number
    startY: number
    pointerId: number
  } | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const canvasRef = useRef<HTMLDivElement>(null)
  const linkCaptureRef = useRef<HTMLDivElement>(null)

  const canUndo = historyRef.current.past.length > 0
  const canRedo = historyRef.current.future.length > 0
  void historyEpoch

  const resetHistory = useCallback(() => {
    historyRef.current = { past: [], future: [] }
    historyBaselineRef.current = null
    setHistoryEpoch((n) => n + 1)
  }, [])

  const pushHistoryBaseline = useCallback((baseline: PointTopology) => {
    const { past } = historyRef.current
    past.push(cloneTopology(baseline))
    if (past.length > 80) past.shift()
    historyRef.current.future = []
    setHistoryEpoch((n) => n + 1)
  }, [])

  const applyDraft = useCallback(
    (updater: (prev: PointTopology) => PointTopology) => {
      setDraft((prev) => {
        const next = updater(prev)
        if (next === prev) return prev
        pushHistoryBaseline(prev)
        return next
      })
    },
    [pushHistoryBaseline],
  )

  const undoDraft = useCallback(() => {
    const { past, future } = historyRef.current
    if (past.length === 0) return
    setDraft((current) => {
      const prev = past.pop()!
      future.push(cloneTopology(current))
      return prev
    })
    setHistoryEpoch((n) => n + 1)
  }, [])

  const redoDraft = useCallback(() => {
    const { past, future } = historyRef.current
    if (future.length === 0) return
    setDraft((current) => {
      const next = future.pop()!
      past.push(cloneTopology(current))
      return next
    })
    setHistoryEpoch((n) => n + 1)
  }, [])

  const dialogWasOpenRef = useRef(false)

  useEffect(() => {
    if (!open) {
      dialogWasOpenRef.current = false
      return
    }

    const justOpened = !dialogWasOpenRef.current
    dialogWasOpenRef.current = true

    if (!justOpened) {
      // 對話框已開著時，只同步設施增刪，不重設 draft／歷史（否則拖節點的逐步還原會被清掉）
      setDraft((prev) => syncPointTopologyWithAreas(prev, areas))
      return
    }

    const synced = syncPointTopologyWithAreas(topology, areas)
    setDraft(synced)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setInspectorTarget(null)
    setDraggingId(null)
    setBendingEdgeId(null)
    setLinkDraft(null)
    setReconnectDraft(null)
    reconnectSessionRef.current = null
    resetHistory()
    // 空拓撲時直接打開左側清單，方便從地圖加入點位
    setListOpen(synced.nodes.length === 0)
    setListQuery('')
    setLegendOpen(false)
    const frame = window.requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas || synced.nodes.length === 0) return
      let sx = 0
      let sy = 0
      for (const node of synced.nodes) {
        sx += node.x
        sy += node.y
      }
      const cx = sx / synced.nodes.length
      const cy = sy / synced.nodes.length
      canvas.scrollTo({
        left: CANVAS_PAN_PAD_PX + cx - canvas.clientWidth / 2,
        top: CANVAS_PAN_PAD_PX + cy - canvas.clientHeight / 2,
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, topology, areas, resetHistory])

  const nodeById = useMemo(() => {
    const map = new Map<string, PointTopologyNode>()
    for (const node of draft.nodes) map.set(node.id, node)
    return map
  }, [draft.nodes])

  /** 節點 id → 地圖場域實際座標（公尺），與拓撲畫布佈局無關 */
  const fieldMetersByNodeId = useMemo(() => {
    const map = new Map<string, { xM: number; yM: number }>()
    for (const area of areas) {
      for (const facility of area.facilities) {
        if (
          facility.type !== 'DockingPoint'
          && facility.type !== 'Waypoint'
          && facility.type !== 'Facility'
        ) {
          continue
        }
        map.set(facility.id, resolveFacilityFieldMeters(facility))
        if (facility.type === 'Facility') {
          const dock = getFacilityDockingPoint(facility)
          if (dock) {
            map.set(facilityDockingTopologyNodeId(facility.id), {
              xM: dock.xM,
              yM: dock.yM,
            })
          }
        }
      }
    }
    return map
  }, [areas])

  const loadCandidates = useMemo(
    () => listTopologyLoadCandidates(areas, draft),
    [areas, draft],
  )

  const availableToAdd = useMemo(() => {
    const q = listQuery.trim().toLowerCase()
    return loadCandidates.filter((item) => {
      if (item.alreadyInTopology) return false
      if (!q) return true
      return (
        item.label.toLowerCase().includes(q)
        || item.areaName.toLowerCase().includes(q)
        || item.facilityId.toLowerCase().includes(q)
        || item.nodeId.toLowerCase().includes(q)
      )
    })
  }, [loadCandidates, listQuery])

  const selectedEdge = useMemo(
    () => draft.edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [draft.edges, selectedEdgeId],
  )

  const invalidTravelEdges = useMemo(
    () => listInvalidTravelEdges(draft),
    [draft],
  )
  const hasInvalidTravelTimes = invalidTravelEdges.length > 0

  /** edgeId → 對向邊；沒有對向就不在表內 */
  const twinEdgeByEdgeId = useMemo(() => {
    const byPair = new Map<string, PointTopologyEdge>()
    for (const edge of draft.edges) {
      byPair.set(`${edge.fromNodeId}->${edge.toNodeId}`, edge)
    }
    const out = new Map<string, PointTopologyEdge>()
    for (const edge of draft.edges) {
      const opposite = byPair.get(`${edge.toNodeId}->${edge.fromNodeId}`)
      if (opposite) out.set(edge.id, opposite)
    }
    return out
  }, [draft.edges])

  /** 同一個發車停靠點的多條整備線：依入射角排序後分扇 */
  const dispatchFanByEdgeId = useMemo(() => {
    const fanIndex = new Map<string, number>()
    const fanCount = new Map<string, number>()
    const byTarget = new Map<string, PointTopologyEdge[]>()
    for (const edge of draft.edges) {
      const from = nodeById.get(edge.fromNodeId)
      const to = nodeById.get(edge.toNodeId)
      if (!isDispatchAfterServiceEdge(from, to) || !to) continue
      const list = byTarget.get(to.id) ?? []
      list.push(edge)
      byTarget.set(to.id, list)
    }
    for (const [, list] of byTarget) {
      list.sort((a, b) => {
        const fa = nodeById.get(a.fromNodeId)!
        const fb = nodeById.get(b.fromNodeId)!
        const ta = nodeById.get(a.toNodeId)!
        const angleA = Math.atan2(fa.y - ta.y, fa.x - ta.x)
        const angleB = Math.atan2(fb.y - ta.y, fb.x - ta.x)
        return angleA - angleB
      })
      list.forEach((edge, index) => {
        fanIndex.set(edge.id, index)
        fanCount.set(edge.id, list.length)
      })
    }
    return { fanIndex, fanCount }
  }, [draft.edges, nodeById])

  const canvasSize = useMemo(() => {
    let maxX = 800
    let maxY = 600
    for (const node of draft.nodes) {
      maxX = Math.max(maxX, node.x + NODE_RADIUS_PX + 120)
      maxY = Math.max(maxY, node.y + NODE_RADIUS_PX + 120)
    }
    // 世界區 + 四周大留白，才能把邊緣點位捲到正中心
    return {
      worldW: maxX,
      worldH: maxY,
      width: maxX + CANVAS_PAN_PAD_PX * 2,
      height: maxY + CANVAS_PAN_PAD_PX * 2,
      pad: CANVAS_PAN_PAD_PX,
    }
  }, [draft.nodes])

  const sortedNodes = useMemo(() => {
    const q = listQuery.trim().toLowerCase()
    const list = [...draft.nodes].sort((a, b) =>
      a.label.localeCompare(b.label, 'zh-Hant'),
    )
    if (!q) return list
    return list.filter(
      (node) =>
        node.label.toLowerCase().includes(q)
        || node.id.toLowerCase().includes(q)
        || (node.stationId ?? '').toLowerCase().includes(q),
    )
  }, [draft.nodes, listQuery])

  const scrollNodeIntoView = useCallback((nodeId: string) => {
    const node = draft.nodes.find((item) => item.id === nodeId)
    const canvas = canvasRef.current
    if (!node || !canvas) return
    const pad = CANVAS_PAN_PAD_PX
    // 點位中心對齊可視區正中心
    const left = pad + node.x - canvas.clientWidth / 2
    const top = pad + node.y - canvas.clientHeight / 2
    canvas.scrollTo({ left, top, behavior: 'smooth' })
    setSelectedNodeId(nodeId)
    setSelectedEdgeId(null)
  }, [draft.nodes])

  const canvasLocalPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: clientX - rect.left + canvas.scrollLeft - CANVAS_PAN_PAD_PX,
      y: clientY - rect.top + canvas.scrollTop - CANVAS_PAN_PAD_PX,
    }
  }, [])

  const onBendPointerDownEdge = useCallback(
    (event: ReactPointerEvent<SVGElement>, edge: PointTopologyEdge) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const local = canvasLocalPoint(event.clientX, event.clientY)
      edgeBendStartRef.current = { x: local.x, y: local.y, moved: false }
      historyBaselineRef.current = cloneTopology(draftRef.current)
      setBendingEdgeId(edge.id)
      setSelectedEdgeId(edge.id)
      setSelectedNodeId(null)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [canvasLocalPoint],
  )

  const onBendPointerMoveEdge = useCallback(
    (event: ReactPointerEvent<SVGElement>, edge: PointTopologyEdge) => {
      if (bendingEdgeId !== edge.id) return
      const from = nodeById.get(edge.fromNodeId)
      const to = nodeById.get(edge.toNodeId)
      if (!from || !to) return
      const local = canvasLocalPoint(event.clientX, event.clientY)
      const start = edgeBendStartRef.current
      if (!start.moved) {
        const dist = Math.hypot(local.x - start.x, local.y - start.y)
        if (dist < 3) return
        edgeBendStartRef.current = { ...start, moved: true }
      }
      const isDispatch = isDispatchAfterServiceEdge(from, to)
      const parallelIndex = 0 as const
      const path = resolvePointTopologyEdgePath(from, to, {
        parallelIndex,
        fanIndex: dispatchFanByEdgeId.fanIndex.get(edge.id) ?? 0,
        fanCount: dispatchFanByEdgeId.fanCount.get(edge.id) ?? 1,
        isDispatch,
        curveOffsetX: edge.curveOffsetX,
        curveOffsetY: edge.curveOffsetY,
      })
      const next = curveOffsetFromDesiredMidpoint(
        path.x1,
        path.y1,
        path.x2,
        path.y2,
        local.x,
        local.y,
      )
      setDraft((prev) =>
        updatePointTopologyEdge(prev, edge.id, {
          curveOffsetX: next.curveOffsetX,
          curveOffsetY: next.curveOffsetY,
        }),
      )
    },
    [
      bendingEdgeId,
      canvasLocalPoint,
      nodeById,
      dispatchFanByEdgeId,
    ],
  )

  const onBendPointerUpEdge = useCallback(
    (event: ReactPointerEvent<SVGElement>, edgeId: string) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      if (bendingEdgeId === edgeId) {
        if (edgeBendStartRef.current.moved && historyBaselineRef.current) {
          pushHistoryBaseline(historyBaselineRef.current)
        }
        historyBaselineRef.current = null
        setBendingEdgeId(null)
      }
    },
    [bendingEdgeId, pushHistoryBaseline],
  )

  const onPointerDownReconnectHandle = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      edge: PointTopologyEdge,
      end: 'from' | 'to',
      startX: number,
      startY: number,
    ) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const fixedNodeId = end === 'from' ? edge.toNodeId : edge.fromNodeId
      const local = canvasLocalPoint(event.clientX, event.clientY)
      const pointerId = event.pointerId
      historyBaselineRef.current = cloneTopology(draftRef.current)
      reconnectSessionRef.current = {
        edgeId: edge.id,
        end,
        fixedNodeId,
        startX,
        startY,
        pointerId,
      }
      setReconnectDraft({
        edgeId: edge.id,
        end,
        fixedNodeId,
        startX,
        startY,
        pointerX: local.x,
        pointerY: local.y,
        hoverTargetId: null,
      })
      setSelectedEdgeId(edge.id)
      setSelectedNodeId(null)
      setBendingEdgeId(null)

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        const session = reconnectSessionRef.current
        if (!session) return
        const topology = draftRef.current
        const point = canvasLocalPoint(moveEvent.clientX, moveEvent.clientY)
        const fixed = topology.nodes.find((node) => node.id === session.fixedNodeId)
        if (!fixed) {
          setReconnectDraft((prev) =>
            prev
              ? {
                  ...prev,
                  pointerX: point.x,
                  pointerY: point.y,
                  hoverTargetId: null,
                }
              : null,
          )
          return
        }
        const magnet = resolveReconnectMagnet({
          fixed,
          edgeId: session.edgeId,
          end: session.end,
          pointerX: point.x,
          pointerY: point.y,
          nodes: topology.nodes,
          topology,
        })
        setReconnectDraft({
          edgeId: session.edgeId,
          end: session.end,
          fixedNodeId: session.fixedNodeId,
          startX: session.startX,
          startY: session.startY,
          pointerX: magnet.pointerX,
          pointerY: magnet.pointerY,
          hoverTargetId: magnet.hoverTargetId,
        })
      }

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        const session = reconnectSessionRef.current
        reconnectSessionRef.current = null
        if (!session) {
          setReconnectDraft(null)
          return
        }
        const topology = draftRef.current
        const point = canvasLocalPoint(upEvent.clientX, upEvent.clientY)
        const fixed = topology.nodes.find((node) => node.id === session.fixedNodeId)
        const magnet = fixed
          ? resolveReconnectMagnet({
              fixed,
              edgeId: session.edgeId,
              end: session.end,
              pointerX: point.x,
              pointerY: point.y,
              nodes: topology.nodes,
              topology,
            })
          : null
        const targetId = magnet?.hoverTargetId ?? null
        if (targetId) {
          const baseline = historyBaselineRef.current ?? topology
          const { topology: next, newEdgeId } = reconnectPointTopologyEdge(
            topology,
            session.edgeId,
            session.end,
            targetId,
          )
          if (newEdgeId && next !== topology) {
            pushHistoryBaseline(baseline)
            setDraft(next)
            setSelectedEdgeId(newEdgeId)
            setSelectedNodeId(null)
          }
        }
        historyBaselineRef.current = null
        setReconnectDraft(null)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [canvasLocalPoint, pushHistoryBaseline],
  )

  const onPointerDownNode = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, node: PointTopologyNode) => {
      // 必須擋冒泡：否則畫布背景會立刻清掉選取，看起來像「點了沒反應」
      event.preventDefault()
      event.stopPropagation()
      const local = canvasLocalPoint(event.clientX, event.clientY)
      dragOffsetRef.current = {
        x: local.x - node.x,
        y: local.y - node.y,
      }
      dragStartRef.current = {
        x: local.x,
        y: local.y,
        moved: false,
        subtree: isSubtreeDragModifierPressed(event),
      }
      lastPointerRef.current = { x: node.x, y: node.y }
      historyBaselineRef.current = cloneTopology(draftRef.current)
      setDraggingId(node.id)
      setSelectedNodeId(node.id)
      setSelectedEdgeId(null)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [canvasLocalPoint],
  )

  const onPointerMoveNode = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!draggingId) return
      const local = canvasLocalPoint(event.clientX, event.clientY)
      // 不 clamp 到 NODE_RADIUS：否則節點無法往上／往左越過世界原點（看起來像被擋住）
      let nextX = local.x - dragOffsetRef.current.x
      let nextY = local.y - dragOffsetRef.current.y
      // 子樹拖曳不做十字磁吸，避免整組被拉歪
      if (!dragStartRef.current.subtree && !isSubtreeDragModifierPressed(event)) {
        const snapped = snapNodeCenterToPeers(nextX, nextY, draggingId, draft.nodes)
        nextX = snapped.x
        nextY = snapped.y
      }
      const dx = nextX - lastPointerRef.current.x
      const dy = nextY - lastPointerRef.current.y
      if (
        !dragStartRef.current.moved
        && Math.hypot(local.x - dragStartRef.current.x, local.y - dragStartRef.current.y)
          > DRAG_CLICK_THRESHOLD_PX
      ) {
        dragStartRef.current.moved = true
      }
      if (dx === 0 && dy === 0) return
      lastPointerRef.current = { x: nextX, y: nextY }
      setDraft((prev) => {
        if (dragStartRef.current.subtree || isSubtreeDragModifierPressed(event)) {
          const ids = collectSubtreeNodeIds(prev, draggingId)
          return movePointTopologyNodesByDelta(prev, ids, dx, dy)
        }
        return movePointTopologyNodesByDelta(prev, [draggingId], dx, dy)
      })
    },
    [draggingId, canvasLocalPoint, draft.nodes],
  )

  const onPointerUpNode = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      if (dragStartRef.current.moved && historyBaselineRef.current) {
        pushHistoryBaseline(historyBaselineRef.current)
      }
      historyBaselineRef.current = null
      setDraggingId(null)
    },
    [pushHistoryBaseline],
  )

  const onPointerDownAnchor = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, fromNodeId: string, startX: number, startY: number) => {
      event.preventDefault()
      event.stopPropagation()
      const local = canvasLocalPoint(event.clientX, event.clientY)
      setLinkDraft({
        fromNodeId,
        startX,
        startY,
        pointerX: local.x,
        pointerY: local.y,
        hoverTargetId: null,
      })
      setSelectedNodeId(fromNodeId)
      setSelectedEdgeId(null)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [canvasLocalPoint],
  )

  const onPointerMoveAnchor = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const local = canvasLocalPoint(event.clientX, event.clientY)
      setLinkDraft((prev) => {
        if (!prev) return null
        const from = draft.nodes.find((node) => node.id === prev.fromNodeId)
        if (!from) {
          return { ...prev, pointerX: local.x, pointerY: local.y, hoverTargetId: null }
        }
        const magnet = resolveLinkMagnet({
          from,
          pointerX: local.x,
          pointerY: local.y,
          nodes: draft.nodes,
          topology: draft,
        })
        return {
          ...prev,
          pointerX: magnet.pointerX,
          pointerY: magnet.pointerY,
          hoverTargetId: magnet.hoverTargetId,
        }
      })
    },
    [canvasLocalPoint, draft],
  )

  const onPointerUpAnchor = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      if (!linkDraft) return
      const local = canvasLocalPoint(event.clientX, event.clientY)
      const from = draft.nodes.find((node) => node.id === linkDraft.fromNodeId)
      const magnet = from
        ? resolveLinkMagnet({
            from,
            pointerX: local.x,
            pointerY: local.y,
            nodes: draft.nodes,
            topology: draft,
          })
        : null
      const targetId = magnet?.hoverTargetId ?? null
      if (targetId) {
        const edgeId = createPointTopologyEdgeId(linkDraft.fromNodeId, targetId)
        applyDraft((prev) => addDirectedEdge(prev, linkDraft.fromNodeId, targetId))
        setSelectedEdgeId(edgeId)
        setSelectedNodeId(null)
      }
      setLinkDraft(null)
    },
    [linkDraft, canvasLocalPoint, draft, applyDraft],
  )

  const onCanvasBackgroundPointerDown = useCallback(() => {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setInspectorTarget(null)
    setReconnectDraft(null)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return
      }
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (event.shiftKey) redoDraft()
        else undoDraft()
        return
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        event.stopImmediatePropagation()
        redoDraft()
        return
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (selectedEdgeId) {
        event.preventDefault()
        event.stopImmediatePropagation()
        applyDraft((prev) => removePointTopologyEdge(prev, selectedEdgeId))
        setSelectedEdgeId(null)
        return
      }
      if (selectedNodeId) {
        event.preventDefault()
        event.stopImmediatePropagation()
        applyDraft((prev) => removeNodesFromPointTopology(prev, [selectedNodeId]))
        setSelectedNodeId(null)
      }
    }
    // capture：先於地圖編輯器的 window keydown，避免 Cmd+Z 同時還原整張地圖
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, selectedEdgeId, selectedNodeId, undoDraft, redoDraft, applyDraft])

  // 拖曳節點時的對齊輔助線
  const dragAlignGuides = useMemo(() => {
    if (!draggingId) return { vertical: null as number | null, horizontal: null as number | null }
    const node = nodeById.get(draggingId)
    if (!node) return { vertical: null, horizontal: null }
    let vertical: number | null = null
    let horizontal: number | null = null
    for (const peer of draft.nodes) {
      if (peer.id === draggingId) continue
      if (Math.abs(peer.x - node.x) <= 0.5) vertical = node.x
      if (Math.abs(peer.y - node.y) <= 0.5) horizontal = node.y
    }
    return { vertical, horizontal }
  }, [draggingId, nodeById, draft.nodes])

  const dockingNodes = useMemo(
    () =>
      [...draft.nodes]
        .filter((node) => node.kind === 'docking')
        .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant')),
    [draft.nodes],
  )

  const selectedEdgePath = useMemo(() => {
    if (!selectedEdge) return null
    const from = nodeById.get(selectedEdge.fromNodeId)
    const to = nodeById.get(selectedEdge.toNodeId)
    if (!from || !to) return null
    return resolvePointTopologyEdgePath(from, to, {
      parallelIndex: 0,
      fanIndex: dispatchFanByEdgeId.fanIndex.get(selectedEdge.id) ?? 0,
      fanCount: dispatchFanByEdgeId.fanCount.get(selectedEdge.id) ?? 1,
      isDispatch: isDispatchAfterServiceEdge(from, to),
      curveOffsetX: selectedEdge.curveOffsetX,
      curveOffsetY: selectedEdge.curveOffsetY,
    })
  }, [
    selectedEdge,
    nodeById,
    dispatchFanByEdgeId,
  ])

  if (!open) return null

  const dockingCount = draft.nodes.filter((n) => n.kind === 'docking').length
  const waypointCount = draft.nodes.filter(
    (n) => n.kind === 'waypoint' || n.kind === 'crossover-waypoint',
  ).length
  const facilityCount = draft.nodes.filter((n) => n.kind === 'facility').length
  const facilityDockingCount = draft.nodes.filter(
    (n) => n.kind === 'facility-docking',
  ).length
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null
  const linkHoverTargetId =
    linkDraft?.hoverTargetId ?? reconnectDraft?.hoverTargetId ?? null
  const linkSnappedToTarget = Boolean(linkHoverTargetId)

  const addFacilitiesToDraft = (nodeIds: string[]) => {
    if (nodeIds.length === 0) return
    applyDraft((prev) => addFacilitiesToPointTopology(prev, areas, nodeIds))
  }

  const removeNodesFromDraft = (nodeIds: string[]) => {
    if (nodeIds.length === 0) return
    applyDraft((prev) => removeNodesFromPointTopology(prev, nodeIds))
    setSelectedNodeId((prev) => (prev && nodeIds.includes(prev) ? null : prev))
    setSelectedEdgeId(null)
  }

  const anchorPositions = selectedNode
    ? [
        { key: 'e', x: selectedNode.x + ANCHOR_OFFSET, y: selectedNode.y },
        { key: 's', x: selectedNode.x, y: selectedNode.y + ANCHOR_OFFSET },
        { key: 'w', x: selectedNode.x - ANCHOR_OFFSET, y: selectedNode.y },
        { key: 'n', x: selectedNode.x, y: selectedNode.y - ANCHOR_OFFSET },
      ]
    : []

  const kindLabel = (kind: PointTopologyNodeKind) =>
    kind === 'docking'
      ? '停靠'
      : kind === 'waypoint'
        ? '途經'
        : kind === 'crossover-waypoint'
          ? '渡線途經'
          : kind === 'facility-docking'
            ? '設施停靠'
            : '設施'

  const selectedFacilityDispatchId =
    selectedNode?.kind === 'facility'
      ? findFacilityDispatchDockingId(draft, selectedNode.id)
      : null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70">
      <div
        className="relative flex h-[90%] w-[90%] flex-col overflow-hidden rounded-lg border border-zinc-600 bg-zinc-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="point-topology-title"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-700/80 px-3 py-2.5">
          <div className="min-w-0 flex flex-col gap-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h2
                id="point-topology-title"
                className="shrink-0 text-sm font-semibold text-zinc-50"
                title="綠→紫＝整備後發車；紫↔紫＝站間行駛。點選線段可填時間與距離。"
              >
                編輯路網拓撲
              </h2>
              <p className="truncate text-[12px] font-medium text-zinc-300">
                停靠 {dockingCount} · 途經 {waypointCount} · 設施 {facilityCount}
                {facilityDockingCount > 0
                  ? ` · 設施停靠 ${facilityDockingCount}`
                  : ''}{' '}
                · 邊 {draft.edges.length}
                {draft.nodes.length === 0 ? ' — 請從左側清單加入點位' : ''}
              </p>
            </div>
            <p className="truncate text-[11px] text-zinc-400">
              ⌘/Ctrl+Z 還原 · ⌘/Ctrl+Shift+Z 復原｜選線後拖兩端改接；中點彎折｜設施↔停靠類＝虛線，停靠↔停靠＝實線
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-zinc-500 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
          >
            關閉
          </button>
        </div>

        <div className="relative min-h-0 flex-1">
          {/* 左側中央抽屜把手 */}
          <button
            type="button"
            onClick={() => setListOpen((v) => !v)}
            className={[
              'absolute top-1/2 z-40 flex h-28 w-7 -translate-y-1/2 flex-col items-center justify-center gap-1 border border-zinc-500/80 bg-zinc-900/95 text-zinc-200 shadow-lg backdrop-blur-sm transition hover:bg-zinc-800 hover:text-cyan-200',
              listOpen
                ? 'left-56 rounded-r-md border-l-0'
                : 'left-0 rounded-r-xl border-l-0',
            ].join(' ')}
            style={{ writingMode: 'vertical-rl' }}
            title={listOpen ? '關閉點位清單' : '開啟點位清單'}
          >
            <span className="text-[11px] font-semibold tracking-wider">
              {listOpen ? '收合' : '點位清單'}
            </span>
          </button>

          {/* 抽屜本體：由左緣滑出 */}
          <aside
            className={[
              'absolute left-0 top-0 z-30 flex h-full w-56 flex-col border-r border-zinc-600/90 bg-zinc-950/98 shadow-2xl transition-transform duration-200',
              listOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none',
            ].join(' ')}
            aria-hidden={!listOpen}
          >
            <div className="flex items-center justify-between border-b border-zinc-700/80 px-2.5 py-2">
              <span className="text-[11px] font-semibold text-zinc-200">點位清單</span>
              <button
                type="button"
                onClick={() => setListOpen(false)}
                className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                關閉
              </button>
            </div>
            <div className="border-b border-zinc-800 px-2 py-1.5">
              <input
                type="search"
                value={listQuery}
                onChange={(event) => setListQuery(event.target.value)}
                placeholder="搜尋名稱…"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500"
              />
              <p className="mt-1 text-[9px] leading-snug text-zinc-500">
                雙擊已載入 → 置中；「移除」退回路網外可再加入；Delete 亦可刪選取點／線
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="sticky top-0 z-10 flex items-center justify-between bg-zinc-950/95 px-2.5 py-1.5 backdrop-blur-sm">
                <span className="text-[10px] font-semibold tracking-wide text-zinc-400">
                  已在路網 · {sortedNodes.length}
                </span>
              </div>
              <ul className="space-y-0.5 px-1 pb-2">
                {sortedNodes.length === 0 ? (
                  <li className="px-2 py-2 text-[11px] text-zinc-500">尚未加入任何點位</li>
                ) : (
                  sortedNodes.map((node) => {
                    const field = fieldMetersByNodeId.get(node.id)
                    const active = selectedNodeId === node.id
                    return (
                      <li key={node.id}>
                        <div
                          className={[
                            'flex items-center gap-1 rounded-md px-1.5 py-1 transition',
                            active
                              ? 'bg-cyan-950/70 ring-1 ring-cyan-500/50'
                              : 'hover:bg-zinc-800/60',
                          ].join(' ')}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedNodeId(node.id)
                              setSelectedEdgeId(null)
                            }}
                            onDoubleClick={() => scrollNodeIntoView(node.id)}
                            className="min-w-0 flex-1 px-0.5 text-left"
                            title="雙擊：移到畫面正中心"
                          >
                            <span className="flex w-full items-center gap-1.5">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: node.color }}
                              />
                              <span className="truncate text-[11px] font-medium text-zinc-100">
                                {node.label}
                              </span>
                            </span>
                            <span className="block pl-3.5 text-[9px] text-zinc-500">
                              {kindLabel(node.kind)}
                              {field
                                ? ` · X ${field.xM.toFixed(1)} Y ${field.yM.toFixed(1)}`
                                : ''}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeNodesFromDraft([node.id])}
                            className="shrink-0 rounded border border-zinc-600/80 px-1.5 py-0.5 text-[9px] font-medium text-zinc-300 hover:border-red-700/60 hover:bg-red-950/50 hover:text-red-200"
                            title="從路網移除（可再加入）"
                          >
                            移除
                          </button>
                        </div>
                      </li>
                    )
                  })
                )}
              </ul>

              <div className="sticky top-0 z-10 flex items-center justify-between gap-1 border-t border-zinc-800/80 bg-zinc-950/95 px-2.5 py-1.5 backdrop-blur-sm">
                <span className="text-[10px] font-semibold tracking-wide text-zinc-400">
                  可加入 · {availableToAdd.length}
                </span>
                {availableToAdd.length > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      addFacilitiesToDraft(availableToAdd.map((item) => item.nodeId))
                    }
                    className="rounded border border-cyan-700/60 px-1.5 py-0.5 text-[9px] font-medium text-cyan-200 hover:bg-cyan-950/80"
                  >
                    全部加入
                  </button>
                ) : null}
              </div>
              <ul className="space-y-0.5 px-1 pb-2">
                {availableToAdd.length === 0 ? (
                  <li className="px-2 py-2 text-[11px] text-zinc-500">
                    {loadCandidates.every((item) => item.alreadyInTopology)
                      ? '地圖上可載入的點位都已加入'
                      : '無符合搜尋的可加入項目'}
                  </li>
                ) : (
                  availableToAdd.map((item) => (
                    <li key={item.nodeId}>
                      <div className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-zinc-800/60">
                        <div className="min-w-0 flex-1 px-0.5">
                          <p className="truncate text-[11px] font-medium text-zinc-200">
                            {item.label}
                          </p>
                          <p className="truncate text-[9px] text-zinc-500">
                            {kindLabel(item.kind)} · {item.areaName}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addFacilitiesToDraft([item.nodeId])}
                          className="shrink-0 rounded border border-cyan-700/50 px-1.5 py-0.5 text-[9px] font-medium text-cyan-200 hover:bg-cyan-950/70"
                        >
                          加入
                        </button>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </aside>

          <div
            ref={canvasRef}
            className="absolute inset-0 overflow-auto overscroll-contain bg-[radial-gradient(circle_at_1px_1px,#3f3f46_1px,transparent_0)] [background-size:24px_24px] bg-zinc-950 [scrollbar-gutter:stable]"
            onPointerDown={onCanvasBackgroundPointerDown}
            title="觸控板雙指滑動可平移整張拓撲圖"
          >
            <div
              ref={linkCaptureRef}
              className="relative"
              style={{
                width: canvasSize.width,
                height: canvasSize.height,
              }}
            >
              <div
                className="absolute"
                style={{
                  left: canvasSize.pad,
                  top: canvasSize.pad,
                  width: canvasSize.worldW,
                  height: canvasSize.worldH,
                }}
              >
              <svg
                className="pointer-events-none absolute inset-0 z-[1] overflow-visible"
                width={canvasSize.worldW}
                height={canvasSize.worldH}
              >
                {/* 對齊輔助線 */}
                {dragAlignGuides.vertical != null ? (
                  <line
                    x1={dragAlignGuides.vertical}
                    y1={0}
                    x2={dragAlignGuides.vertical}
                    y2={canvasSize.worldH}
                    stroke="#22d3ee"
                    strokeWidth={1}
                    strokeDasharray="4 6"
                    opacity={0.45}
                  />
                ) : null}
                {dragAlignGuides.horizontal != null ? (
                  <line
                    x1={0}
                    y1={dragAlignGuides.horizontal}
                    x2={canvasSize.worldW}
                    y2={dragAlignGuides.horizontal}
                    stroke="#22d3ee"
                    strokeWidth={1}
                    strokeDasharray="4 6"
                    opacity={0.45}
                  />
                ) : null}
                <g className="pointer-events-auto">
                  {draft.edges.map((edge) => {
                    if (reconnectDraft?.edgeId === edge.id) return null
                    const from = nodeById.get(edge.fromNodeId)
                    const to = nodeById.get(edge.toNodeId)
                    if (!from || !to) return null
                    // 雙向的一對只畫一條（兩端各一個箭頭）。
                    // 由「被選中的那一條」代表；都沒選就由 id 較小的代表，
                    // 這樣選誰都看得到自己的線是實心高亮的。
                    const twin = twinEdgeByEdgeId.get(edge.id) ?? null
                    if (twin) {
                      const representative =
                        selectedEdgeId === edge.id
                          ? edge.id
                          : selectedEdgeId === twin.id
                            ? twin.id
                            : edge.id < twin.id
                              ? edge.id
                              : twin.id
                      if (representative !== edge.id) return null
                    }
                    const selected =
                      selectedEdgeId === edge.id
                      || (twin != null && selectedEdgeId === twin.id)
                    const focusActive = Boolean(selectedNodeId || selectedEdgeId)
                    const touchesSelectedNode =
                      selectedNodeId === edge.fromNodeId
                      || selectedNodeId === edge.toNodeId
                    const emphasized =
                      selected || (Boolean(selectedNodeId) && touchesSelectedNode)
                    const dimmed = focusActive && !emphasized
                    return (
                      <EdgeArrow
                        key={edge.id}
                        edge={edge}
                        twin={twin}
                        from={from}
                        to={to}
                        parallelIndex={0}
                        fanIndex={dispatchFanByEdgeId.fanIndex.get(edge.id) ?? 0}
                        fanCount={dispatchFanByEdgeId.fanCount.get(edge.id) ?? 1}
                        selected={selected}
                        emphasized={emphasized}
                        dimmed={dimmed}
                        bending={bendingEdgeId === edge.id}
                        onSelect={() => {
                          setSelectedEdgeId(edge.id)
                          setSelectedNodeId(null)
                        }}
                        onDoubleClickEdge={() => {
                          setSelectedEdgeId(edge.id)
                          setSelectedNodeId(null)
                          setInspectorTarget({ kind: 'edge', id: edge.id })
                        }}
                        onBendPointerDown={(event) => onBendPointerDownEdge(event, edge)}
                        onBendPointerMove={(event) => onBendPointerMoveEdge(event, edge)}
                        onBendPointerUp={(event) => onBendPointerUpEdge(event, edge.id)}
                        onResetBend={() => {
                          applyDraft((prev) =>
                            updatePointTopologyEdge(prev, edge.id, {
                              curveOffsetX: null,
                              curveOffsetY: null,
                            }),
                          )
                        }}
                      />
                    )
                  })}
                  {linkDraft ? (
                    <g>
                      <line
                        x1={linkDraft.startX}
                        y1={linkDraft.startY}
                        x2={linkDraft.pointerX}
                        y2={linkDraft.pointerY}
                        stroke={linkSnappedToTarget ? '#67e8f9' : '#22d3ee'}
                        strokeWidth={linkSnappedToTarget ? 2.5 : 1.75}
                        strokeDasharray={linkSnappedToTarget ? undefined : '5 4'}
                        opacity={linkSnappedToTarget ? 1 : 0.9}
                      />
                      {linkSnappedToTarget ? (
                        <circle
                          cx={linkDraft.pointerX}
                          cy={linkDraft.pointerY}
                          r={5}
                          fill="#67e8f9"
                          stroke="#083344"
                          strokeWidth={1.5}
                        />
                      ) : null}
                    </g>
                  ) : null}
                  {reconnectDraft ? (
                    <g>
                      <line
                        x1={reconnectDraft.startX}
                        y1={reconnectDraft.startY}
                        x2={reconnectDraft.pointerX}
                        y2={reconnectDraft.pointerY}
                        stroke={
                          reconnectDraft.hoverTargetId ? '#67e8f9' : '#22d3ee'
                        }
                        strokeWidth={reconnectDraft.hoverTargetId ? 2.5 : 1.75}
                        strokeDasharray={
                          reconnectDraft.hoverTargetId ? undefined : '5 4'
                        }
                        opacity={0.95}
                      />
                      <circle
                        cx={reconnectDraft.pointerX}
                        cy={reconnectDraft.pointerY}
                        r={reconnectDraft.hoverTargetId ? 6 : 4}
                        fill={
                          reconnectDraft.hoverTargetId ? '#67e8f9' : '#22d3ee'
                        }
                        stroke="#083344"
                        strokeWidth={1.5}
                      />
                    </g>
                  ) : null}
                </g>
              </svg>

              {draft.nodes.map((node) => {
                const size = NODE_RADIUS_PX * 2
                const selected = selectedNodeId === node.id
                const linkReady = linkHoverTargetId === node.id
                const field = fieldMetersByNodeId.get(node.id)
                const fieldText = field
                  ? `X ${field.xM.toFixed(2)} · Y ${field.yM.toFixed(2)} m`
                  : null
                const linkBlocked =
                  (Boolean(linkDraft)
                    && node.id !== linkDraft!.fromNodeId
                    && !linkReady
                    && !canAddDirectedEdge(draft, linkDraft!.fromNodeId, node.id))
                  || (Boolean(reconnectDraft)
                    && node.id !== reconnectDraft!.fixedNodeId
                    && !linkReady
                    && !canReconnectDirectedEdge(
                      draft,
                      reconnectDraft!.edgeId,
                      reconnectDraft!.end,
                      node.id,
                    ))
                return (
                  <button
                    key={node.id}
                    type="button"
                    title={
                      linkReady
                        ? `放開以${reconnectDraft ? '改接至' : '連接到'}「${node.label}」`
                        : [
                            `${node.label}（${
                              node.kind === 'docking'
                                ? '停靠點'
                                : node.kind === 'crossover-waypoint'
                                  ? '渡線途經點'
                                  : node.kind === 'facility-docking'
                                    ? '設施停靠點'
                                    : node.kind === 'facility'
                                      ? '設施'
                                      : '途經點'
                            }）`,
                            fieldText ? `場域座標 ${fieldText}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                    }
                    className={[
                      'absolute z-[10] flex select-none flex-col items-center justify-center rounded-full border-2 px-1.5 text-center shadow-lg transition duration-150',
                      linkReady
                        ? 'z-20 scale-110 border-emerald-300 ring-4 ring-emerald-400/80'
                        : selected
                          ? 'border-cyan-300 ring-2 ring-cyan-400/70'
                          : 'border-white/25',
                      linkBlocked ? 'opacity-40' : '',
                      'cursor-grab active:cursor-grabbing',
                      draggingId === node.id ? 'z-20 scale-105' : '',
                    ].join(' ')}
                    style={{
                      left: node.x - NODE_RADIUS_PX,
                      top: node.y - NODE_RADIUS_PX,
                      width: size,
                      height: size,
                      backgroundColor: node.color,
                      color: contrastText(node.color),
                      boxShadow: linkReady
                        ? '0 0 0 6px rgba(52, 211, 153, 0.25), 0 10px 24px rgba(16, 185, 129, 0.35)'
                        : undefined,
                    }}
                    onPointerDown={(event) => onPointerDownNode(event, node)}
                    onPointerMove={onPointerMoveNode}
                    onPointerUp={onPointerUpNode}
                    onPointerCancel={onPointerUpNode}
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      setSelectedNodeId(node.id)
                      setSelectedEdgeId(null)
                      setInspectorTarget({ kind: 'node', id: node.id })
                    }}
                  >
                    <span className="line-clamp-2 max-w-full break-words px-0.5 text-[9px] font-semibold leading-tight">
                      {node.label}
                    </span>
                    {field ? (
                      <span className="mt-0.5 flex flex-col items-center gap-px font-mono text-[7px] font-medium leading-none tabular-nums opacity-95">
                        <span>X {field.xM.toFixed(2)}</span>
                        <span>Y {field.yM.toFixed(2)}</span>
                      </span>
                    ) : null}
                  </button>
                )
              })}

              {anchorPositions.map((anchor) => (
                  <button
                    key={anchor.key}
                    type="button"
                    title={
                      selectedNode?.kind === 'facility'
                        ? '拖曳到停靠點：指定整備後發車點'
                        : '拖曳到另一個圓以建立有向連線'
                    }
                    className="absolute z-30 rounded-full border border-cyan-300 bg-cyan-950 shadow-md hover:bg-cyan-800"
                    style={{
                      left: anchor.x - ANCHOR_SIZE / 2,
                      top: anchor.y - ANCHOR_SIZE / 2,
                      width: ANCHOR_SIZE,
                      height: ANCHOR_SIZE,
                    }}
                    onPointerDown={(event) => {
                      if (!selectedNodeId) return
                      onPointerDownAnchor(event, selectedNodeId, anchor.x, anchor.y)
                    }}
                    onPointerMove={onPointerMoveAnchor}
                    onPointerUp={onPointerUpAnchor}
                    onPointerCancel={onPointerUpAnchor}
                  />
                ))}

              {selectedEdge && selectedEdgePath && !reconnectDraft
                ? (
                    <>
                      <button
                        type="button"
                        title="拖曳起點：改接到其他節點"
                        className="absolute z-40 rounded-full border-2 border-white bg-cyan-500 shadow-lg hover:scale-110 hover:bg-cyan-400"
                        style={{
                          left: selectedEdgePath.x1 - RECONNECT_HANDLE_SIZE / 2,
                          top: selectedEdgePath.y1 - RECONNECT_HANDLE_SIZE / 2,
                          width: RECONNECT_HANDLE_SIZE,
                          height: RECONNECT_HANDLE_SIZE,
                          touchAction: 'none',
                        }}
                        onPointerDown={(event) =>
                          onPointerDownReconnectHandle(
                            event,
                            selectedEdge,
                            'from',
                            selectedEdgePath.x2,
                            selectedEdgePath.y2,
                          )
                        }
                      />
                      <button
                        type="button"
                        title="拖曳終點：改接到其他節點"
                        className="absolute z-40 rounded-full border-2 border-white bg-cyan-500 shadow-lg hover:scale-110 hover:bg-cyan-400"
                        style={{
                          left: selectedEdgePath.x2 - RECONNECT_HANDLE_SIZE / 2,
                          top: selectedEdgePath.y2 - RECONNECT_HANDLE_SIZE / 2,
                          width: RECONNECT_HANDLE_SIZE,
                          height: RECONNECT_HANDLE_SIZE,
                          touchAction: 'none',
                        }}
                        onPointerDown={(event) =>
                          onPointerDownReconnectHandle(
                            event,
                            selectedEdge,
                            'to',
                            selectedEdgePath.x1,
                            selectedEdgePath.y1,
                          )
                        }
                      />
                    </>
                  )
                : null}
              </div>
            </div>
          </div>

          {/* 語意圖例：預設收合，避免佔畫面 */}
          <div
            className={[
              'absolute bottom-3 z-20',
              listOpen ? 'left-60' : 'left-3',
            ].join(' ')}
          >
            {legendOpen ? (
              <div className="max-w-[240px] rounded-lg border border-zinc-600/80 bg-zinc-950/90 px-2.5 py-2 shadow-lg backdrop-blur-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold text-zinc-200">怎麼看這張圖</p>
                  <button
                    type="button"
                    className="rounded px-1 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                    onClick={() => setLegendOpen(false)}
                  >
                    收合
                  </button>
                </div>
                <ul className="mt-1.5 space-y-1 text-[10px] leading-snug text-zinc-400">
                  <li className="flex items-start gap-1.5">
                    <span
                      className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: TOPOLOGY_KIND_COLORS.facility }}
                    />
                    <span>綠點＝整備設施</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span
                      className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: TOPOLOGY_KIND_COLORS['facility-docking'] }}
                    />
                    <span>琥珀點＝設施停靠點</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span
                      className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: TOPOLOGY_KIND_COLORS.docking }}
                    />
                    <span>紫點＝可發車停靠點</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="mt-1 h-0.5 w-3 shrink-0 border-t border-dashed border-[#7cb87f]" />
                    <span>綠虛線＝設施 ↔ 停靠類（整備）</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="mt-1 h-0.5 w-3 shrink-0 bg-zinc-400" />
                    <span>實線＝停靠 ↔ 停靠（含設施停靠點）</span>
                  </li>
                </ul>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLegendOpen(true)}
                className="rounded-md border border-zinc-600/80 bg-zinc-950/85 px-2 py-1 text-[10px] font-medium text-zinc-300 shadow-lg backdrop-blur-sm hover:border-zinc-500 hover:text-zinc-100"
                title="顯示圖例"
              >
                說明
              </button>
            )}
          </div>

          {selectedEdge && inspectorTarget?.kind === 'edge' && inspectorTarget.id === selectedEdge.id ? (
            <aside className="absolute right-0 top-0 z-30 flex h-full w-56 flex-col border-l border-zinc-700/80 bg-zinc-950/95 shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-700/80 px-2.5 py-1.5">
                <span className="text-[10px] font-semibold tracking-wider text-zinc-400">
                  {isDispatchAfterServiceEdge(
                    nodeById.get(selectedEdge.fromNodeId),
                    nodeById.get(selectedEdge.toNodeId),
                  )
                    ? '整備後發車'
                    : '站間行駛'}
                </span>
                <button
                  type="button"
                  className="text-[10px] text-zinc-500 hover:text-zinc-300"
                  onClick={() => { setSelectedEdgeId(null); setInspectorTarget(null) }}
                  title="收合側欄"
                >
                  收合
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
                <EdgePropertiesForm
                  edge={selectedEdge}
                  fromLabel={labelForTopologyNode(draft, selectedEdge.fromNodeId)}
                  toLabel={labelForTopologyNode(draft, selectedEdge.toNodeId)}
                  roleHint={
                    isDispatchAfterServiceEdge(
                      nodeById.get(selectedEdge.fromNodeId),
                      nodeById.get(selectedEdge.toNodeId),
                    )
                      ? '這條線表示：整備結束後，車輛去此停靠點發車。'
                      : isServiceFacilityLinkEdge(
                            nodeById.get(selectedEdge.fromNodeId),
                            nodeById.get(selectedEdge.toNodeId),
                          )
                        ? '這條線表示：設施本體與設施停靠點之間的整備連線。'
                        : '這條線表示：停靠點之間的行駛連線（含正線停靠與設施停靠）。'
                  }
                  readOnly={false}
                  canReverse={canReversePointTopologyEdge(draft, selectedEdge.id)}
                  isBidirectional={isPointTopologyEdgeBidirectional(
                    draft,
                    selectedEdge.id,
                  )}
                  onMakeBidirectional={() => {
                    const { topology, newEdgeId } =
                      makePointTopologyEdgeBidirectional(draft, selectedEdge.id)
                    if (!newEdgeId) return
                    pushHistoryBaseline(draft)
                    setDraft(topology)
                  }}
                  onRemoveOpposite={() => {
                    const oppositeId = findOppositePointTopologyEdgeId(
                      draft,
                      selectedEdge.id,
                    )
                    if (!oppositeId) return
                    applyDraft((prev) => removePointTopologyEdge(prev, oppositeId))
                  }}
                  onChange={(patch) => {
                    applyDraft((prev) =>
                      updatePointTopologyEdge(prev, selectedEdge.id, patch),
                    )
                  }}
                  onReverse={() => {
                    const { topology, newEdgeId } = reversePointTopologyEdge(
                      draft,
                      selectedEdge.id,
                    )
                    if (!newEdgeId) return
                    pushHistoryBaseline(draft)
                    setDraft(topology)
                    setSelectedEdgeId(newEdgeId)
                  }}
                  onResetBend={() => {
                    applyDraft((prev) =>
                      updatePointTopologyEdge(prev, selectedEdge.id, {
                        curveOffsetX: null,
                        curveOffsetY: null,
                      }),
                    )
                  }}
                  onDelete={() => {
                    applyDraft((prev) => removePointTopologyEdge(prev, selectedEdge.id))
                    setSelectedEdgeId(null)
                    setInspectorTarget(null)
                  }}
                />
              </div>
            </aside>
          ) : selectedNode?.kind === 'facility' && inspectorTarget?.kind === 'node' && inspectorTarget.id === selectedNode.id ? (
            <aside className="absolute right-0 top-0 z-30 flex h-full w-56 flex-col border-l border-zinc-700/80 bg-zinc-950/95 shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-700/80 px-2.5 py-1.5">
                <span className="text-[10px] font-semibold tracking-wider text-zinc-400">
                  整備後發車
                </span>
                <button
                  type="button"
                  className="text-[10px] text-zinc-500 hover:text-zinc-300"
                  onClick={() => { setSelectedNodeId(null); setInspectorTarget(null) }}
                >
                  收合
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
                <div>
                  <p className="text-[11px] font-medium text-zinc-100">{selectedNode.label}</p>
                  <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
                    整備任務結束後，這台車應該去哪裡發車？
                  </p>
                </div>
                <label className="block space-y-1">
                  <span className="text-[10px] text-zinc-500">發車停靠點</span>
                  <select
                    value={selectedFacilityDispatchId ?? ''}
                    onChange={(event) => {
                      const nextId = event.target.value || null
                      applyDraft((prev) =>
                        setFacilityDispatchDocking(prev, selectedNode.id, nextId),
                      )
                    }}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-cyan-500"
                  >
                    <option value="">尚未指定</option>
                    {dockingNodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.label}
                      </option>
                    ))}
                  </select>
                </label>
                {dockingNodes.length === 0 ? (
                  <p className="text-[10px] leading-snug text-amber-300/90">
                    請先從左側清單加入至少一個停靠點。
                  </p>
                ) : selectedFacilityDispatchId ? (
                  <p className="text-[10px] leading-snug text-lime-200/80">
                    已指定：整備完成 → {labelForTopologyNode(draft, selectedFacilityDispatchId)}
                  </p>
                ) : (
                  <p className="text-[10px] leading-snug text-zinc-500">
                    也可從綠點周圍小圓點拖到紫色停靠點。
                  </p>
                )}
              </div>
            </aside>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-700/80 px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={!canUndo}
              onClick={undoDraft}
              title="還原（⌘/Ctrl+Z）"
              className="rounded-md border border-zinc-600 bg-zinc-800 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
            >
              還原
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={redoDraft}
              title="復原（⌘/Ctrl+Shift+Z）"
              className="rounded-md border border-zinc-600 bg-zinc-800 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
            >
              復原
            </button>
            {hasInvalidTravelTimes ? (
              <p className="min-w-0 text-[10px] leading-snug text-red-300/95">
                有 {invalidTravelEdges.length} 條連線的最快時間大於平均時間，請修正後再套用。
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
            >
              取消
            </button>
            <button
              type="button"
              disabled={hasInvalidTravelTimes}
              onClick={() => {
                if (hasInvalidTravelTimes) return
                onApply(draft)
              }}
              className="rounded-md border border-cyan-600 bg-cyan-950/80 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-900/80 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-500"
            >
              套用路網拓撲
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EdgePropertiesForm({
  edge,
  fromLabel,
  toLabel,
  roleHint,
  readOnly,
  canReverse,
  isBidirectional,
  onMakeBidirectional,
  onRemoveOpposite,
  onChange,
  onReverse,
  onResetBend,
  onDelete,
}: {
  edge: PointTopologyEdge
  fromLabel: string
  toLabel: string
  roleHint?: string
  readOnly: boolean
  canReverse: boolean
  /** 對向邊已存在＝這一對節點已經是雙向 */
  isBidirectional: boolean
  onMakeBidirectional: () => void
  onRemoveOpposite: () => void
  onChange: (
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
  ) => void
  onReverse: () => void
  onResetBend: () => void
  onDelete: () => void
}) {
  const customBend = hasCustomEdgeBend(edge)
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-medium text-zinc-200">
          {fromLabel}
          <span className="mx-1 text-cyan-400">→</span>
          {toLabel}
        </p>
        {roleHint ? (
          <p className="mt-1 text-[10px] leading-snug text-zinc-400">{roleHint}</p>
        ) : null}
        <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{edge.id}</p>
      </div>
      {!readOnly ? (
        <div className="space-y-1">
          {isBidirectional ? (
            <>
              <div className="w-full rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-3 py-2 text-center text-xs font-medium text-emerald-200">
                已設為雙向
              </div>
              <button
                type="button"
                onClick={onRemoveOpposite}
                title="刪除對向那一條，恢復成單向"
                className="w-full rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
              >
                改回單向（刪除對向邊）
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onMakeBidirectional}
              title="自動補一條反向連線，時間與距離沿用這一條"
              className="w-full rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-900/50"
            >
              設為雙向（自動補 {toLabel} → {fromLabel}）
            </button>
          )}
          <button
            type="button"
            disabled={!canReverse}
            onClick={onReverse}
            title={
              canReverse
                ? '將箭頭方向對調（保留時間與距離）'
                : '對向連線已存在，無法直接反轉；請刪除對向邊後再試，或改編輯對向邊'
            }
            className="w-full rounded-lg border border-cyan-700/60 bg-cyan-950/40 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-900/40 disabled:text-zinc-500"
          >
            反轉方向（{fromLabel} ← {toLabel}）
          </button>
          {!canReverse ? (
            <p className="text-[10px] leading-snug text-amber-300/80">
              對向連線已存在。若要改成單向反方向，請先刪除對向邊再反轉。
            </p>
          ) : null}
          <button
            type="button"
            disabled={!customBend}
            onClick={onResetBend}
            title={customBend ? '清除手動彎折，恢復預設線徑' : '尚未彎折線徑'}
            className="w-full rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
          >
            重設線徑彎折
          </button>
          <p className="text-[10px] leading-snug text-zinc-500">
            拖曳線兩端白點到其他節點可改接；中點拖曳可彎折（雙擊重設彎折）。
          </p>
        </div>
      ) : null}
      <label className="block space-y-1">
        <span className="text-[10px] text-zinc-500">最快時間（秒）</span>
        <input
          type="number"
          min={0}
          step={1}
          disabled={readOnly}
          value={edge.minTravelTimeSeconds ?? ''}
          onChange={(event) =>
            onChange({ minTravelTimeSeconds: parseOptionalNumber(event.target.value) })
          }
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-cyan-500 disabled:opacity-50"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[10px] text-zinc-500">平均時間（秒）</span>
        <input
          type="number"
          min={0}
          step={1}
          disabled={readOnly}
          value={edge.avgTravelTimeSeconds ?? ''}
          onChange={(event) =>
            onChange({ avgTravelTimeSeconds: parseOptionalNumber(event.target.value) })
          }
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-cyan-500 disabled:opacity-50"
        />
      </label>
      {edge.minTravelTimeSeconds != null
        && edge.avgTravelTimeSeconds != null
        && edge.minTravelTimeSeconds > edge.avgTravelTimeSeconds ? (
        <p className="text-[10px] leading-snug text-red-300/95">
          最快時間不可大於平均時間，請修正後才能套用路網拓撲。
        </p>
      ) : null}
      <label className="block space-y-1">
        <span className="text-[10px] text-zinc-500">實際距離（公尺）</span>
        <input
          type="number"
          min={0}
          step={0.1}
          disabled={readOnly}
          value={edge.distanceMeters ?? ''}
          onChange={(event) =>
            onChange({ distanceMeters: parseOptionalNumber(event.target.value) })
          }
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-cyan-500 disabled:opacity-50"
        />
      </label>
      {!readOnly ? (
        <button
          type="button"
          onClick={onDelete}
          className="w-full rounded-lg border border-red-700/70 bg-red-950/50 px-3 py-2 text-xs font-medium text-red-200 hover:bg-red-900/60"
        >
          刪除此連線
        </button>
      ) : null}
    </div>
  )
}
