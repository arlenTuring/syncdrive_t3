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
} from '../types/pointTopology'
import {
  addDirectedEdge,
  canAddDirectedEdge,
  canReversePointTopologyEdge,
  collectSubtreeNodeIds,
  createPointTopologyEdgeId,
  isSubtreeDragModifierPressed,
  labelForTopologyNode,
  listInvalidTravelEdges,
  movePointTopologyNodesByDelta,
  NODE_RADIUS_PX,
  removePointTopologyEdge,
  reversePointTopologyEdge,
  syncPointTopologyWithAreas,
  topologySubtreeDragModifierLabel,
  updatePointTopologyEdge,
} from '../utils/pointTopology'
import { resolveFacilityFieldMeters } from '../utils/facilityListEntries'

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

const ANCHOR_OFFSET = NODE_RADIUS_PX + 10
const ANCHOR_SIZE = 10
const DRAG_CLICK_THRESHOLD_PX = 4
/** 連線磁吸半徑（含圓外圍） */
const LINK_MAGNET_RADIUS_PX = NODE_RADIUS_PX + 36
/** 自由拖曳時對齊水平／垂直的磁吸閾值 */
const AXIS_SNAP_PX = 14
/** 拖曳節點時對齊其他節點座標軸的磁吸閾值 */
const NODE_ALIGN_SNAP_PX = 10

function contrastText(hex: string): string {
  const raw = hex.replace('#', '')
  if (raw.length !== 6) return '#fff'
  const r = Number.parseInt(raw.slice(0, 2), 16)
  const g = Number.parseInt(raw.slice(2, 4), 16)
  const b = Number.parseInt(raw.slice(4, 6), 16)
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luma > 0.62 ? '#18181b' : '#fafafa'
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

/** 雙向邊略作平行偏移，避免重疊 */
function edgeEndpoints(
  from: PointTopologyNode,
  to: PointTopologyNode,
  parallelIndex: 0 | 1,
): { x1: number; y1: number; x2: number; y2: number; nx: number; ny: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const shift = parallelIndex === 1 ? 7 : 0
  const inset = NODE_RADIUS_PX + 2
  return {
    x1: from.x + ux * inset + nx * shift,
    y1: from.y + uy * inset + ny * shift,
    x2: to.x - ux * inset + nx * shift,
    y2: to.y - uy * inset + ny * shift,
    nx,
    ny,
  }
}

/** 線旁簡要標籤：橫式一列「快／均／距」 */
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
  return parts.length > 0 ? parts.join(' · ') : '未填'
}

function EdgeArrow({
  edge,
  from,
  to,
  parallelIndex,
  selected,
  onSelect,
}: {
  edge: PointTopologyEdge
  from: PointTopologyNode
  to: PointTopologyNode
  parallelIndex: 0 | 1
  selected: boolean
  onSelect: () => void
}) {
  const { x1, y1, x2, y2, nx, ny } = edgeEndpoints(from, to, parallelIndex)
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  const stroke = selected ? '#22d3ee' : '#a1a1aa'
  const markerId = `topo-arrow-${edge.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const brief = formatEdgeBrief(edge)
  const hasMetrics =
    edge.minTravelTimeSeconds != null
    || edge.avgTravelTimeSeconds != null
    || edge.distanceMeters != null
  // 橫式單列：高度固定，略偏離線段，文字保持水平不旋轉
  const boxW = Math.min(160, Math.max(72, brief.length * 7 + 16))
  const boxH = 22
  const clearGap = 6
  const side = parallelIndex === 1 ? -1 : 1
  const labelOffset = side * (boxH / 2 + clearGap)
  const labelX = midX + nx * labelOffset
  const labelY = midY + ny * labelOffset

  return (
    <g className="cursor-pointer" onPointerDown={(event) => {
      event.stopPropagation()
      onSelect()
    }}>
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
      </defs>
      {/* 加寬透明 hit area */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="transparent"
        strokeWidth={14}
      />
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={selected ? 2.5 : 1.75}
        markerEnd={`url(#${markerId})`}
      />
      <circle cx={midX} cy={midY} r={selected ? 4 : 3} fill={stroke} />
      <g transform={`translate(${labelX}, ${labelY})`}>
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
                  : hasMetrics
                    ? 'border-zinc-600/80 bg-zinc-950/90 text-zinc-200'
                    : 'border-amber-700/50 bg-zinc-950/90 text-amber-200/90',
              ].join(' ')}
            >
              {brief}
            </div>
          </div>
        </foreignObject>
      </g>
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
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [listQuery, setListQuery] = useState('')
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const dragStartRef = useRef({ x: 0, y: 0, moved: false, subtree: false })
  const lastPointerRef = useRef({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)
  const linkCaptureRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const synced = syncPointTopologyWithAreas(topology, areas)
    setDraft(synced)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setDraggingId(null)
    setLinkDraft(null)
    setListOpen(false)
    setListQuery('')
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
  }, [open, topology, areas])

  const hint = useMemo(() => topologySubtreeDragModifierLabel(), [])

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
        if (facility.type !== 'DockingPoint' && facility.type !== 'Waypoint') continue
        map.set(facility.id, resolveFacilityFieldMeters(facility))
      }
    }
    return map
  }, [areas])

  const selectedEdge = useMemo(
    () => draft.edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [draft.edges, selectedEdgeId],
  )

  const invalidTravelEdges = useMemo(
    () => listInvalidTravelEdges(draft),
    [draft],
  )
  const hasInvalidTravelTimes = invalidTravelEdges.length > 0

  const parallelIndexByEdgeId = useMemo(() => {
    const map = new Map<string, 0 | 1>()
    for (const edge of draft.edges) {
      const hasReverse = draft.edges.some(
        (other) =>
          other.fromNodeId === edge.toNodeId && other.toNodeId === edge.fromNodeId,
      )
      if (hasReverse && edge.fromNodeId > edge.toNodeId) {
        map.set(edge.id, 1)
      } else {
        map.set(edge.id, 0)
      }
    }
    return map
  }, [draft.edges])

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
      let nextX = Math.max(NODE_RADIUS_PX, local.x - dragOffsetRef.current.x)
      let nextY = Math.max(NODE_RADIUS_PX, local.y - dragOffsetRef.current.y)
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

  const onPointerUpNode = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDraggingId(null)
  }, [])

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
        setDraft((prev) => addDirectedEdge(prev, linkDraft.fromNodeId, targetId))
        setSelectedEdgeId(edgeId)
        setSelectedNodeId(null)
      }
      setLinkDraft(null)
    },
    [linkDraft, canvasLocalPoint, draft],
  )

  const onCanvasBackgroundPointerDown = useCallback(() => {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (!selectedEdgeId) return
      event.preventDefault()
      setDraft((prev) => removePointTopologyEdge(prev, selectedEdgeId))
      setSelectedEdgeId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, selectedEdgeId])

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

  if (!open) return null

  const dockingCount = draft.nodes.filter((n) => n.kind === 'docking').length
  const waypointCount = draft.nodes.filter((n) => n.kind === 'waypoint').length
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null
  const linkHoverTargetId = linkDraft?.hoverTargetId ?? null
  const linkSnappedToTarget = Boolean(linkHoverTargetId)

  const anchorPositions = selectedNode
    ? [
        { key: 'e', x: selectedNode.x + ANCHOR_OFFSET, y: selectedNode.y },
        { key: 's', x: selectedNode.x, y: selectedNode.y + ANCHOR_OFFSET },
        { key: 'w', x: selectedNode.x - ANCHOR_OFFSET, y: selectedNode.y },
        { key: 'n', x: selectedNode.x, y: selectedNode.y - ANCHOR_OFFSET },
      ]
    : []

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70">
      <div
        className="flex h-[90%] w-[90%] flex-col overflow-hidden rounded-lg border border-zinc-600 bg-zinc-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="point-topology-title"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-700/80 px-3 py-2.5">
          <div className="min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2
              id="point-topology-title"
              className="shrink-0 text-sm font-semibold text-zinc-50"
              title="一條線＝一個方向；兩點之間最多可有對向各一條。點選線段可填時間與距離。"
            >
              編輯點位拓撲
            </h2>
            <p className="truncate text-[12px] font-medium text-zinc-300">
              停靠 {dockingCount} · 途經 {waypointCount} · 邊 {draft.edges.length}
              {draft.nodes.length === 0 ? ' — 請先放置停靠點或途經點' : ''}
              <span className="ml-2 hidden text-zinc-400 lg:inline" title={hint}>
                · 觸控板滑動平移畫布 · 清單雙擊定位 · {hint}
              </span>
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
                雙擊項目 → 點位移到畫面正中心
              </p>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto p-1">
              {sortedNodes.length === 0 ? (
                <li className="px-2 py-3 text-[11px] text-zinc-500">無符合點位</li>
              ) : (
                sortedNodes.map((node) => {
                  const field = fieldMetersByNodeId.get(node.id)
                  const active = selectedNodeId === node.id
                  return (
                    <li key={node.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedNodeId(node.id)
                          setSelectedEdgeId(null)
                        }}
                        onDoubleClick={() => scrollNodeIntoView(node.id)}
                        className={[
                          'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition',
                          active
                            ? 'bg-cyan-950/70 ring-1 ring-cyan-500/50'
                            : 'hover:bg-zinc-800/80',
                        ].join(' ')}
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
                        <span className="pl-3.5 text-[9px] text-zinc-500">
                          {node.kind === 'docking' ? '停靠' : '途經'}
                          {field
                            ? ` · X ${field.xM.toFixed(1)} Y ${field.yM.toFixed(1)}`
                            : ''}
                        </span>
                      </button>
                    </li>
                  )
                })
              )}
            </ul>
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
                    const from = nodeById.get(edge.fromNodeId)
                    const to = nodeById.get(edge.toNodeId)
                    if (!from || !to) return null
                    return (
                      <EdgeArrow
                        key={edge.id}
                        edge={edge}
                        from={from}
                        to={to}
                        parallelIndex={parallelIndexByEdgeId.get(edge.id) ?? 0}
                        selected={selectedEdgeId === edge.id}
                        onSelect={() => {
                          setSelectedEdgeId(edge.id)
                          setSelectedNodeId(null)
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
                  Boolean(linkDraft)
                  && node.id !== linkDraft!.fromNodeId
                  && !linkReady
                  && !canAddDirectedEdge(draft, linkDraft!.fromNodeId, node.id)
                return (
                  <button
                    key={node.id}
                    type="button"
                    title={
                      linkReady
                        ? `放開以連接到「${node.label}」`
                        : [
                            `${node.label}（${node.kind === 'docking' ? '停靠點' : '途經點'}）`,
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
                    title="拖曳到另一個圓以建立有向連線"
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
              </div>
            </div>
          </div>

          {selectedEdge ? (
            <aside className="absolute right-0 top-0 z-30 flex h-full w-56 flex-col border-l border-zinc-700/80 bg-zinc-950/95 shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-700/80 px-2.5 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  連線屬性
                </span>
                <button
                  type="button"
                  className="text-[10px] text-zinc-500 hover:text-zinc-300"
                  onClick={() => setSelectedEdgeId(null)}
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
                  readOnly={false}
                  canReverse={canReversePointTopologyEdge(draft, selectedEdge.id)}
                  onChange={(patch) => {
                    setDraft((prev) =>
                      updatePointTopologyEdge(prev, selectedEdge.id, patch),
                    )
                  }}
                  onReverse={() => {
                    const { topology, newEdgeId } = reversePointTopologyEdge(
                      draft,
                      selectedEdge.id,
                    )
                    if (!newEdgeId) return
                    setDraft(topology)
                    setSelectedEdgeId(newEdgeId)
                  }}
                  onDelete={() => {
                    setDraft((prev) => removePointTopologyEdge(prev, selectedEdge.id))
                    setSelectedEdgeId(null)
                  }}
                />
              </div>
            </aside>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-700/80 px-3 py-2">
          {hasInvalidTravelTimes ? (
            <p className="min-w-0 flex-1 text-[10px] leading-snug text-red-300/95">
              有 {invalidTravelEdges.length} 條連線的最快時間大於平均時間，請修正後再套用。
            </p>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
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
              套用拓撲
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
  readOnly,
  canReverse,
  onChange,
  onReverse,
  onDelete,
}: {
  edge: PointTopologyEdge
  fromLabel: string
  toLabel: string
  readOnly: boolean
  canReverse: boolean
  onChange: (
    patch: Partial<
      Pick<
        PointTopologyEdge,
        'minTravelTimeSeconds' | 'avgTravelTimeSeconds' | 'distanceMeters'
      >
    >,
  ) => void
  onReverse: () => void
  onDelete: () => void
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-medium text-zinc-200">
          {fromLabel}
          <span className="mx-1 text-cyan-400">→</span>
          {toLabel}
        </p>
        <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{edge.id}</p>
      </div>
      {!readOnly ? (
        <div className="space-y-1">
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
          最快時間不可大於平均時間，請修正後才能套用拓撲。
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
