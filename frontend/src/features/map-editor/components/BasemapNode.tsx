import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  CircleCheck,
  Columns2,
  Eraser,
  PencilLine,
  Rows2,
  Route,
  Maximize,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MapBasemapLayout, MapBasemapObject } from '../types/basemap'
import { AreaDragTrack } from './AreaDragTrack'
import { BasemapCellOverlay } from './BasemapCellOverlay'
import { BasemapGraphic } from './BasemapGraphic'
import { BasemapPartitionContent } from './BasemapPartitionContent'
import { BasemapFilePickerDialog } from './BasemapFilePickerDialog'
import { TrackGenGraphic } from './TrackGenGraphic'
import {
  TrackGenSizeDialog,
  type TrackGenSizeParams,
} from './TrackGenSizeDialog'
import { parseLaneCenterlines } from '../opendrive/laneCenterlines'
import {
  getTrackGenFileName,
  getTrackGenSummary,
  getTrackGenXodr,
  isTrackGenComponent,
  TRACKGEN_FILE_NAME_KEY,
  TRACKGEN_BLOCK_SIZE_KEY,
  getTrackGenBlockSize,
  TRACKGEN_RESULT_KEY,
  TRACKGEN_XODR_KEY,
} from '../utils/trackGenFacility'
import { buildTrackGraph, type TrackGraph } from '../utils/trackGenGraph'
import type { TrackGenGroup } from '../utils/trackGenGroups'
import { layoutTrackGraph } from '../utils/trackGenGraphLayout'
import {
  applyTrackGenMerges,
  getTrackGenMerges,
  TRACKGEN_MERGES_KEY,
  type TrackGenMerge,
} from '../utils/trackGenMerge'
import type { TrackGenLayout } from '../utils/trackGenLayout'
import { MapFloatingAnchorPortal } from './MapFloatingAnchorPortal'
import {
  type BasemapFileSelection,
  getBasemapFileName,
  getBasemapOpacity,
  getBasemapPreviewUrl,
  getBasemapWorldBounds,
  getBasemapXodrContent,
  isBasemapAboveAreas,
  parseBasemapOpenDrivePlan,
  setBasemapWorldBoundsPatch,
  MAP_BASEMAP_SELECTED_Z_BOOST,
  MAP_BASEMAP_Z_ABOVE_BASE,
  MAP_BASEMAP_Z_BELOW_BASE,
  BASEMAP_FILE_NAME_KEY,
  BASEMAP_PREVIEW_URL_KEY,
  BASEMAP_SOURCE_TYPE_KEY,
  BASEMAP_XODR_CONTENT_KEY,
  BASEMAP_PARTITION_KEY,
  parseBasemapPartition,
} from '../utils/basemapFacility'
import {
  adjustSharedPartitionDivider,
  clientToBasemapLocalPx,
  confirmBasemapPartitionCuts,
  getBasemapPartitionCell,
  hitBasemapPartitionCellAt,
  isBasemapPartitionConfirmed,
  reopenBasemapPartitionCuts,
  resizeBasemapLockedCellFromOrigin,
  splitBasemapPartitionCell,
  type BasemapLockedResizeHandle,
  type BasemapNormRect,
  type BasemapSharedDivider,
} from '../utils/basemapPartition'
import { attachPartitionCellWorldBounds } from '../utils/basemapPartitionWorld'
import { parseOpenDriveXodr } from '../opendrive'

const MIN_BASEMAP_PX = 40
const LAYOUT_DRAG_START_PX = 4

type ResizeCorner = 'tl' | 'tr' | 'bl' | 'br'

function normalizeBasemapLayout(layout: MapBasemapLayout): MapBasemapLayout {
  return {
    ...layout,
    wPx: Math.max(MIN_BASEMAP_PX, layout.wPx),
    hPx: Math.max(MIN_BASEMAP_PX, layout.hPx),
  }
}

function layoutFromCornerResize(
  start: MapBasemapLayout,
  corner: ResizeCorner,
  dx: number,
  dy: number,
): MapBasemapLayout {
  let { xPx, yPx, wPx, hPx } = start
  if (corner === 'br') {
    wPx = start.wPx + dx
    hPx = start.hPx + dy
  } else if (corner === 'tr') {
    wPx = start.wPx + dx
    hPx = start.hPx - dy
    yPx = start.yPx + dy
  } else if (corner === 'bl') {
    wPx = start.wPx - dx
    hPx = start.hPx + dy
    xPx = start.xPx + dx
  } else {
    wPx = start.wPx - dx
    hPx = start.hPx - dy
    xPx = start.xPx + dx
    yPx = start.yPx + dy
  }
  return { xPx, yPx, wPx, hPx }
}

type Props = {
  /** 軌道生成：把結果變成真正的設施 */
  onApplyTrackGen?: (
    basemapId: string,
    layout: TrackGenLayout,
    groups: TrackGenGroup[],
  ) => void
  /** 目前這張地圖的畫布尺寸（像素）——生成對話框要照它畫縮圖 */
  mapPixelSize?: { width: number; height: number }
  basemap: MapBasemapObject
  stackOrder: number
  stackCount: number
  selected: boolean
  readOnly?: boolean
  editMode?: boolean
  mapScale: number
  showToolbar?: boolean
  onSelect: (id: string) => void
  onPatchLayout: (id: string, layout: MapBasemapLayout) => void
  onPatchParameters: (id: string, patch: Record<string, unknown>) => void
  onLayoutSessionStart?: () => void
  onBringToFront?: (id: string) => void
  onSendToBack?: (id: string) => void
  onDoubleClick?: (id: string) => void
}

export const BasemapNode = memo(function BasemapNode({
  mapPixelSize,
  basemap,
  stackOrder,
  stackCount,
  selected,
  readOnly = false,
  editMode = false,
  mapScale,
  showToolbar = true,
  onSelect,
  onPatchLayout,
  onPatchParameters,
  onLayoutSessionStart,
  onBringToFront,
  onSendToBack,
  onDoubleClick,
  onApplyTrackGen,
}: Props) {
  const { t } = useTranslation()
  const canEdit = editMode && !readOnly
  const layout = basemap.layout
  const rootRef = useRef<HTMLDivElement>(null)
  const toolbarAnchorRef = useRef<HTMLDivElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null)
  const [liveLayout, setLiveLayout] = useState<MapBasemapLayout | null>(null)
  const liveLayoutRef = useRef<MapBasemapLayout | null>(null)
  const dragRef = useRef<
    | { kind: 'move'; startX: number; startY: number; layout: MapBasemapLayout }
    | {
        kind: 'resize'
        corner: ResizeCorner
        startX: number
        startY: number
        layout: MapBasemapLayout
      }
    | null
  >(null)
  const pendingRef = useRef<typeof dragRef.current>(null)
  const historyPushedRef = useRef(false)
  const pendingCellSelectRef = useRef<string | null | undefined>(undefined)
  const partitionRef = useRef(
    parseBasemapPartition(basemap.parameters, layout.wPx, layout.hPx),
  )

  const displayLayout = liveLayout ?? layout

  /* ── 軌道生成元件 ─────────────────────────────────────────────
     沿用底圖的搬移／縮放／選取／存檔管線，只以 componentKind 區分身分，
     內容、工具列與屬性各走各的。 */
  const isTrackGen = isTrackGenComponent(basemap.parameters)
  const trackGenXodr = getTrackGenXodr(basemap.parameters)
  const trackGenCenterlines = useMemo(() => {
    if (!isTrackGen || !trackGenXodr) return null
    try {
      return parseLaneCenterlines(trackGenXodr, { sampleStepM: 1 })
    } catch {
      return null
    }
  }, [isTrackGen, trackGenXodr])
  const trackGenParseFailed = isTrackGen && !!trackGenXodr && !trackGenCenterlines
  const trackGenResult = getTrackGenSummary(basemap.parameters)
  const [generating, setGenerating] = useState(false)

  /**
   * 生成軌道：算完就直接在地圖上建出真正的軌道元件。
   *
   * 中間<strong>不畫示意圖形</strong>。使用者要的是圓角／斜接／一般軌道那些能個別
   * 拉伸、設屬性、被車輛投影命中的元件；先畫一份藍色示意方塊再按一次「套用」，
   * 只是多一道手續。這個元件負責的是「載入路網、看中心線、按下生成」。
   */
  /*
   * 生成前先問「一塊軌道多大」。
   *
   * 目標是用簡單明瞭的幾何表示場域，不是模擬得很像；一塊畫多長多寬應該由使用者
   * 決定，所以先開對話框讓他拉，拉完才生成。
   */
  const [sizeDialogOpen, setSizeDialogOpen] = useState(false)
  /*
   * 路網的圖先建好再開對話框。
   *
   * 對話框要能回答「這樣生出來多大」，而那得把整份版面排完才知道；排版吃的就是這張
   * 圖。圖與「一塊多少像素」無關，拉參數時不必重建。
   */
  const [pendingGraph, setPendingGraph] = useState<TrackGraph | null>(null)

  const openSizeDialog = useCallback(() => {
    if (!trackGenCenterlines) return
    setGenerating(true)
    // 讓「生成中」先畫出來，再做這件會佔住主執行緒的計算
    window.setTimeout(() => {
      try {
        setPendingGraph(buildTrackGraph(trackGenCenterlines))
        setSizeDialogOpen(true)
      } finally {
        setGenerating(false)
      }
    }, 0)
  }, [trackGenCenterlines])

  /** 圖上橫的邊與縱的邊各有哪幾段（公尺），對話框拿去顯示 */
  const trackGenTotals = useMemo(() => {
    if (!pendingGraph) return undefined
    const x: number[] = []
    const y: number[] = []
    for (const e of pendingGraph.edges) {
      if (e.orient === 'h') x.push(e.lengthM)
      else y.push(e.lengthM)
    }
    return { x, y }
  }, [pendingGraph])

  /**
   * 這組參數排出來會佔多大、兩軸各幾塊——對話框拿去跟畫布比。
   *
   * 塊數直接<strong>數排出來的形狀</strong>，不另外用公尺數推。
   */
  const measureTrackGen = useCallback(
    (block: TrackGenSizeParams, merges: TrackGenMerge[] = []) => {
      if (!pendingGraph) return null
      const canvas = mapPixelSize ?? { width: displayLayout.wPx, height: displayLayout.hPx }
      /*
       * 使用者在預覽上合併過的，這裡就要照著併。量出來的尺寸、預覽畫的、生成出去的
       * 是同一份版面——分開算的話按下生成會跑出跟畫面不一樣的東西。
       */
      const graphLayout = applyTrackGenMerges(
        layoutTrackGraph(pendingGraph, block, {
          wPx: displayLayout.wPx,
          hPx: displayLayout.hPx,
        }),
        merges,
      )
      const { bounds, shapes } = graphLayout
      /*
       * 塊數只數<strong>其中一條線</strong>，不然雙線會變兩倍。取塊數最多的那一條，
       * 圖模型的線是車道鍵（例如 8:-2），沒有「參考線」這個概念。
       */
      const perLine = new Map<string, { x: number; y: number }>()
      for (const sh of shapes) {
        if (sh.kind !== 'rect') continue
        const cur = perLine.get(sh.lineKey) ?? { x: 0, y: 0 }
        if (Math.abs(Math.round(sh.rotationDeg / 90)) % 2 === 0) cur.x += 1
        else cur.y += 1
        perLine.set(sh.lineKey, cur)
      }
      let countX = 0
      let countY = 0
      for (const c of perLine.values()) {
        if (c.x + c.y > countX + countY) {
          countX = c.x
          countY = c.y
        }
      }
      const wPx = Math.max(1, bounds.xMax - bounds.xMin)
      const hPx = Math.max(1, bounds.yMax - bounds.yMin)
      /*
       * 生成出來會落在畫布的哪裡：位置沿用這個元件的框，但整塊要留在畫布內，
       * 與套用時同一條規則。預覽照這個位置畫，看到的就是實際會長成的樣子。
       */
      const clamp = (v: number, span: number, limit: number) =>
        Math.max(0, Math.min(v, Math.max(0, limit - span)))
      return {
        wPx,
        hPx,
        countX,
        countY,
        shapes,
        bounds,
        mergesApplied: graphLayout.mergesApplied,
        layout: graphLayout ?? undefined,
        originPx: {
          x: clamp(displayLayout.xPx, wPx, canvas.width),
          y: clamp(displayLayout.yPx, hPx, canvas.height),
        },
      }
    },
    [displayLayout, mapPixelSize, pendingGraph],
  )

  /**
   * 擴展至當前空間：把元件撐成整張畫布。
   *
   * 生成出來的軌道<strong>鋪滿這個元件的框</strong>，所以框有多大、圖就有多大。要
   * 「照地圖的解析度生成」時，先把框拉到跟畫布一樣大是必要的一步——手拉四個角很難
   * 剛好對齊，差幾個像素比例尺就不是整數，一按就好比較實在。
   */
  const expandToCanvas = useCallback(() => {
    const ps = mapPixelSize
    if (!ps) return
    onLayoutSessionStart?.()
    onPatchLayout(
      basemap.id,
      normalizeBasemapLayout({ xPx: 0, yPx: 0, wPx: ps.width, hPx: ps.height }),
    )
  }, [basemap.id, mapPixelSize, onLayoutSessionStart, onPatchLayout])

  /** 已經剛好鋪滿了就沒事可做 */
  const filledCanvas =
    !!mapPixelSize &&
    Math.abs(layout.xPx) < 0.5 &&
    Math.abs(layout.yPx) < 0.5 &&
    Math.abs(layout.wPx - mapPixelSize.width) < 0.5 &&
    Math.abs(layout.hPx - mapPixelSize.height) < 0.5

  const runTrackGeneration = useCallback((
    block: TrackGenSizeParams,
    groups: TrackGenGroup[],
    merges: TrackGenMerge[],
  ) => {
    const graph = pendingGraph
    if (!graph) return
    const measured = measureTrackGen(block, merges)
    if (!measured?.layout) return
    // 摘要留著給屬性匡顯示，也讓「重新生成」知道上一次生成過
    onPatchParameters(basemap.id, {
      [TRACKGEN_RESULT_KEY]: {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        components: graph.components,
        lanes: new Set(graph.edges.flatMap((e) => e.lanes.map((l) => l.key))).size,
        totalM: Math.round(graph.edges.reduce((t, e) => t + e.lengthM, 0)),
      },
      [TRACKGEN_BLOCK_SIZE_KEY]: block,
      // 合併是使用者一塊一塊點出來的，重新生成要照他上次的樣子做
      [TRACKGEN_MERGES_KEY]: merges,
    })
    onApplyTrackGen?.(basemap.id, measured.layout as TrackGenLayout, groups)
  }, [basemap.id, measureTrackGen, onApplyTrackGen, onPatchParameters, pendingGraph])

  const previewUrl = getBasemapPreviewUrl(basemap.parameters)
  const fileName = getBasemapFileName(basemap.parameters)
  const xodrContent = getBasemapXodrContent(basemap.parameters)
  const xodrPlan = useMemo(
    () => parseBasemapOpenDrivePlan(basemap.parameters),
    [basemap.parameters],
  )
  const xodrParseFailed = !!xodrContent && !xodrPlan
  const worldBounds = useMemo(
    () => getBasemapWorldBounds(basemap.parameters, displayLayout, xodrPlan),
    [basemap.parameters, displayLayout, xodrPlan],
  )
  const aboveAreas = isBasemapAboveAreas(basemap.parameters)
  const canBringForward = !aboveAreas || stackOrder < stackCount - 1
  const canSendBackward = aboveAreas || stackOrder > 0
  const basemapZIndex =
    (aboveAreas ? MAP_BASEMAP_Z_ABOVE_BASE : MAP_BASEMAP_Z_BELOW_BASE) +
    stackOrder +
    (selected ? MAP_BASEMAP_SELECTED_Z_BOOST : 0)
  const partition = useMemo(
    () =>
      parseBasemapPartition(
        basemap.parameters,
        displayLayout.wPx,
        displayLayout.hPx,
      ),
    [basemap.parameters, displayLayout.hPx, displayLayout.wPx],
  )

  useEffect(() => {
    partitionRef.current = partition
  }, [partition])

  const cutsConfirmed = isBasemapPartitionConfirmed(partition)
  const selectedCell = selectedCellId
    ? getBasemapPartitionCell(partition, selectedCellId)
    : null
  const canSplit = !cutsConfirmed && !!selectedCell
  const canConfirmCuts = !cutsConfirmed && partition.cells.length >= 2
  const canReopenCuts = cutsConfirmed

  const patchPartition = useCallback(
    (nextPartition: typeof partition) => {
      partitionRef.current = nextPartition
      onPatchParameters(basemap.id, { [BASEMAP_PARTITION_KEY]: nextPartition })
    },
    [basemap.id, onPatchParameters],
  )

  const patchPartitionWithWorld = useCallback(
    (nextPartition: typeof partition) => {
      const withWorld = isBasemapPartitionConfirmed(nextPartition)
        ? attachPartitionCellWorldBounds(nextPartition, worldBounds)
        : nextPartition
      patchPartition(withWorld)
    },
    [patchPartition, worldBounds],
  )

  useEffect(() => {
    if (!cutsConfirmed || partition.cellWorldBounds) return
    patchPartitionWithWorld(partition)
  }, [cutsConfirmed, partition, patchPartitionWithWorld])

  useEffect(() => {
    if (!selected) {
      setSelectedCellId(null)
      return
    }
    if (selectedCellId) return
    const defaultCell =
      partition.cells.find((c) => !cutsConfirmed || !c.locked) ??
      partition.cells[0] ??
      null
    if (defaultCell) {
      setSelectedCellId(defaultCell.id)
    }
  }, [selected, partition, selectedCellId])

  useEffect(() => {
    if (!selected || !canEdit) return
    if (basemap.parameters?.[BASEMAP_PARTITION_KEY]) return
    patchPartition(partition)
  }, [
    selected,
    canEdit,
    basemap.parameters,
    partition,
    patchPartition,
  ])

  const resolveCellHit = useCallback(
    (clientX: number, clientY: number): string | null => {
      const root = rootRef.current
      if (!root) return null
      const { x, y } = clientToBasemapLocalPx(
        root,
        clientX,
        clientY,
        displayLayout.wPx,
        displayLayout.hPx,
      )
      return hitBasemapPartitionCellAt(
        partition,
        displayLayout.wPx,
        displayLayout.hPx,
        x,
        y,
      )
    },
    [displayLayout.hPx, displayLayout.wPx, partition],
  )

  const onSplitCell = useCallback(
    (axis: 'row' | 'col') => {
      if (!selectedCellId || cutsConfirmed) return
      const cell = getBasemapPartitionCell(partition, selectedCellId)
      if (!cell) return
      onLayoutSessionStart?.()
      const result = splitBasemapPartitionCell(partition, selectedCellId, axis)
      if (!result) return
      patchPartition(result.partition)
      setSelectedCellId(result.newCellIds[0])
    },
    [cutsConfirmed, onLayoutSessionStart, partition, patchPartition, selectedCellId],
  )

  const onConfirmCuts = useCallback(() => {
    if (cutsConfirmed) return
    onLayoutSessionStart?.()
    const next = confirmBasemapPartitionCuts(partition)
    if (!next) return
    patchPartitionWithWorld(next)
  }, [cutsConfirmed, onLayoutSessionStart, partition, patchPartitionWithWorld])

  const onReopenCuts = useCallback(() => {
    if (!cutsConfirmed) return
    onLayoutSessionStart?.()
    const next = reopenBasemapPartitionCuts(partition)
    if (!next) return
    patchPartition(next)
  }, [cutsConfirmed, onLayoutSessionStart, partition, patchPartition])

  const onDividerDrag = useCallback(
    (divider: BasemapSharedDivider, localX: number, localY: number) => {
      const next = adjustSharedPartitionDivider(
        partitionRef.current,
        divider,
        localX,
        localY,
        displayLayout.wPx,
        displayLayout.hPx,
      )
      if (!next) return
      patchPartition(next)
    },
    [displayLayout.hPx, displayLayout.wPx, patchPartition],
  )

  const onLockedCellResize = useCallback(
    (
      cellId: string,
      handle: BasemapLockedResizeHandle,
      originRect: BasemapNormRect,
      totalDxNorm: number,
      totalDyNorm: number,
    ) => {
      const next = resizeBasemapLockedCellFromOrigin(
        partitionRef.current,
        cellId,
        handle,
        originRect,
        totalDxNorm,
        totalDyNorm,
      )
      if (!next) return
      patchPartition(next)
    },
    [patchPartition],
  )

  useEffect(() => {
    liveLayoutRef.current = liveLayout
  }, [liveLayout])

  const applyPointer = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current
      if (!drag) return
      const scale = Math.max(0.01, mapScale)
      const dx = (clientX - drag.startX) / scale
      const dy = (clientY - drag.startY) / scale
      if (drag.kind === 'move') {
        const next = normalizeBasemapLayout({
          ...drag.layout,
          xPx: drag.layout.xPx + dx,
          yPx: drag.layout.yPx + dy,
        })
        liveLayoutRef.current = next
        setLiveLayout(next)
        return
      }
      const next = normalizeBasemapLayout(
        layoutFromCornerResize(drag.layout, drag.corner, dx, dy),
      )
      liveLayoutRef.current = next
      setLiveLayout(next)
    },
    [mapScale],
  )

  const endDrag = useCallback(
    (commit: boolean) => {
      const pendingLayout = liveLayoutRef.current
      dragRef.current = null
      pendingRef.current = null
      if (commit && pendingLayout) {
        onPatchLayout(basemap.id, pendingLayout)
      }
      setLiveLayout(null)
      liveLayoutRef.current = null
      historyPushedRef.current = false
    },
    [basemap.id, onPatchLayout],
  )

  const attachWindowListeners = useCallback(
    (pointerId: number) => {
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        const pending = pendingRef.current
        if (pending && !dragRef.current) {
          const dx = ev.clientX - pending.startX
          const dy = ev.clientY - pending.startY
          if (dx * dx + dy * dy < LAYOUT_DRAG_START_PX * LAYOUT_DRAG_START_PX) {
            return
          }
          if (!historyPushedRef.current) {
            historyPushedRef.current = true
            onLayoutSessionStart?.()
          }
          pendingCellSelectRef.current = undefined
          dragRef.current = pending
          pendingRef.current = null
        }
        applyPointer(ev.clientX, ev.clientY)
      }
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        const didDrag = !!dragRef.current
        endDrag(didDrag)
        if (didDrag) {
          pendingCellSelectRef.current = undefined
        } else if (pendingCellSelectRef.current !== undefined) {
          setSelectedCellId(pendingCellSelectRef.current)
          pendingCellSelectRef.current = undefined
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [applyPointer, endDrag, onLayoutSessionStart],
  )

  const onMovePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!canEdit) return
      e.stopPropagation()
      e.preventDefault()
      const hitId = resolveCellHit(e.clientX, e.clientY)
      pendingCellSelectRef.current = hitId
      if (hitId) {
        setSelectedCellId(hitId)
      }
      pendingRef.current = {
        kind: 'move',
        startX: e.clientX,
        startY: e.clientY,
        layout: liveLayoutRef.current ?? layout,
      }
      rootRef.current?.setPointerCapture(e.pointerId)
      attachWindowListeners(e.pointerId)
    },
    [attachWindowListeners, canEdit, layout, resolveCellHit],
  )

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, corner: ResizeCorner) => {
      if (!canEdit || !selected) return
      e.stopPropagation()
      e.preventDefault()
      if (!historyPushedRef.current) {
        historyPushedRef.current = true
        onLayoutSessionStart?.()
      }
      dragRef.current = {
        kind: 'resize',
        corner,
        startX: e.clientX,
        startY: e.clientY,
        layout,
      }
      rootRef.current?.setPointerCapture(e.pointerId)
      attachWindowListeners(e.pointerId)
    },
    [attachWindowListeners, canEdit, layout, onLayoutSessionStart, selected],
  )

  /**
   * 直接把 .xodr 拖到元件上。
   *
   * 空白狀態的提示寫著「點擊或拖曳 .xodr 至此」，但先前根本沒有接 drop——拖進去
   * 什麼都不會發生。拖放少一次開對話框、少一次按確定，這一步本來就該省掉。
   */
  const [dropActive, setDropActive] = useState(false)

  const onTrackGenFileDrop = useCallback(
    (e: React.DragEvent) => {
      setDropActive(false)
      if (!isTrackGen || readOnly) return
      const file = e.dataTransfer.files?.[0]
      if (!file || !/\.xodr$/i.test(file.name)) return
      e.preventDefault()
      e.stopPropagation()
      const reader = new FileReader()
      reader.onload = () => {
        const content = String(reader.result ?? '')
        if (!content.trim()) return
        onPatchParameters(basemap.id, {
          [TRACKGEN_XODR_KEY]: content,
          [TRACKGEN_FILE_NAME_KEY]: file.name,
          [TRACKGEN_RESULT_KEY]: undefined,
        })
      }
      reader.readAsText(file)
    },
    [basemap.id, isTrackGen, onPatchParameters, readOnly],
  )

  const onConfirmFile = useCallback(
    (selection: BasemapFileSelection) => {
      if (isTrackGen) {
        // 軌道生成只吃路網；載入新檔就把上一次的生成結果作廢，
        // 否則畫面上會是新的中心線配上舊的軌道。
        if (selection.kind !== 'xodr') return
        onPatchParameters(basemap.id, {
          [TRACKGEN_XODR_KEY]: selection.content,
          [TRACKGEN_FILE_NAME_KEY]: selection.file.name,
          [TRACKGEN_RESULT_KEY]: undefined,
        })
        setPickerOpen(false)
        return
      }
      const oldUrl = getBasemapPreviewUrl(basemap.parameters)
      if (oldUrl?.startsWith('blob:')) URL.revokeObjectURL(oldUrl)

      if (selection.kind === 'image') {
        onPatchParameters(basemap.id, {
          [BASEMAP_SOURCE_TYPE_KEY]: 'image',
          [BASEMAP_PREVIEW_URL_KEY]: selection.previewUrl,
          [BASEMAP_FILE_NAME_KEY]: selection.file.name,
          [BASEMAP_XODR_CONTENT_KEY]: undefined,
        })
        const img = new Image()
        img.onload = () => {
          const w = Math.max(1, img.naturalWidth)
          const h = Math.max(1, img.naturalHeight)
          onPatchParameters(basemap.id, {
            ...setBasemapWorldBoundsPatch({
              xmin: 0,
              ymin: 0,
              xmax: w,
              ymax: h,
            }),
          })
        }
        img.src = selection.previewUrl
      } else {
        const plan = parseOpenDriveXodr(selection.content, { sampleStepM: 1 })
        const spanW = plan.bounds.xmax - plan.bounds.xmin
        const spanH = plan.bounds.ymax - plan.bounds.ymin
        const aspect = spanH > 0 ? spanW / spanH : 1
        let wPx = displayLayout.wPx
        let hPx = displayLayout.hPx
        if (aspect >= 1) {
          hPx = wPx / aspect
        } else {
          wPx = hPx * aspect
        }
        onPatchLayout(
          basemap.id,
          normalizeBasemapLayout({ ...displayLayout, wPx, hPx }),
        )
        onPatchParameters(basemap.id, {
          [BASEMAP_SOURCE_TYPE_KEY]: 'xodr',
          [BASEMAP_XODR_CONTENT_KEY]: selection.content,
          [BASEMAP_FILE_NAME_KEY]: selection.file.name,
          [BASEMAP_PREVIEW_URL_KEY]: undefined,
          ...setBasemapWorldBoundsPatch(plan.bounds),
        })
      }
      setPickerOpen(false)
    },
    [
      basemap.id,
      basemap.parameters,
      displayLayout,
      onPatchLayout,
      onPatchParameters,
    ],
  )

  const hasBasemapContent = !!previewUrl || !!xodrPlan
  const showPartitionContent = cutsConfirmed && hasBasemapContent

  return (
    <>
      <div
        ref={rootRef}
        data-basemap-root
        data-basemap-id={basemap.id}
        className={`absolute touch-none select-none${canEdit ? ' cursor-move' : ''}`}
        style={{
          left: displayLayout.xPx,
          top: displayLayout.yPx,
          width: displayLayout.wPx,
          height: displayLayout.hPx,
          zIndex: basemapZIndex,
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if ((e.target as HTMLElement).closest('[data-basemap-pick]')) return
          if ((e.target as HTMLElement).closest('[data-basemap-pinned-layer]')) return
          if ((e.target as HTMLElement).closest('[data-basemap-cell-divider]')) return
          if ((e.target as HTMLElement).closest('[data-basemap-cell-resize-handle]')) return
          if ((e.target as HTMLElement).closest('[data-area-drag-track]')) return
          if ((e.target as HTMLElement).closest('[data-area-resize-corner]')) return
          if ((e.target as HTMLElement).closest('[data-basemap-toolbar]')) return
          e.stopPropagation()
          onSelect(basemap.id)
          if (canEdit) {
            onMovePointerDown(e)
          }
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-basemap-pick]')) return
          if ((e.target as HTMLElement).closest('[data-area-drag-track]')) return
          if ((e.target as HTMLElement).closest('[data-area-resize-corner]')) return
          if ((e.target as HTMLElement).closest('[data-basemap-toolbar]')) return
          e.stopPropagation()
          e.preventDefault()
          onSelect(basemap.id)
          onDoubleClick?.(basemap.id)
        }}
      >
        {isTrackGen ? (
          <div
            className="size-full"
            onDragOver={(e) => {
              if (readOnly) return
              e.preventDefault()
              e.stopPropagation()
              setDropActive(true)
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={onTrackGenFileDrop}
            style={
              dropActive
                ? { outline: '2px dashed #34d399', outlineOffset: -2, borderRadius: 2 }
                : undefined
            }
          >
          <TrackGenGraphic
            width={displayLayout.wPx}
            height={displayLayout.hPx}
            centerlines={trackGenCenterlines}
            parseFailed={trackGenParseFailed}
            result={trackGenResult}
            fileName={getTrackGenFileName(basemap.parameters)}
            readOnly={readOnly}
            selected={selected}
            onPickClick={() => setPickerOpen(true)}
          />
          </div>
        ) : (
          <BasemapGraphic
            width={displayLayout.wPx}
            height={displayLayout.hPx}
            worldBounds={worldBounds}
            mapScale={mapScale}
            contentOpacity={getBasemapOpacity(basemap.parameters)}
            imageUrl={previewUrl}
            xodrPlan={xodrPlan}
            xodrParseFailed={xodrParseFailed}
            fileName={fileName}
            readOnly={readOnly}
            selected={selected}
            hideContent={showPartitionContent}
            onPickClick={() => setPickerOpen(true)}
          />
        )}
        {!isTrackGen && showPartitionContent ? (
          <BasemapPartitionContent
            partition={partition}
            parentWorldBounds={worldBounds}
            basemapWidthPx={displayLayout.wPx}
            basemapHeightPx={displayLayout.hPx}
            contentOpacity={getBasemapOpacity(basemap.parameters)}
            imageUrl={previewUrl}
            xodrPlan={xodrPlan}
            fileName={fileName}
          />
        ) : null}
        {selected ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[2] border-2 border-cyan-400/90"
          />
        ) : null}
        {canEdit && selected && !isTrackGen ? (
          <BasemapCellOverlay
            partition={partition}
            widthPx={displayLayout.wPx}
            heightPx={displayLayout.hPx}
            mapScale={mapScale}
            selectedCellId={selectedCellId}
            onCellSelect={setSelectedCellId}
            onDividerDrag={onDividerDrag}
            onDividerSessionStart={onLayoutSessionStart}
            onLockedCellResize={onLockedCellResize}
            onLockedResizeSessionStart={onLayoutSessionStart}
          />
        ) : null}
        {canEdit && selected ? (
          <AreaDragTrack
            wPx={displayLayout.wPx}
            hPx={displayLayout.hPx}
            active={!!liveLayout}
            onMovePointerDown={onMovePointerDown}
            onResizePointerDown={onResizePointerDown}
          />
        ) : null}
        {canEdit && selected && showToolbar ? (
          <>
            <div
              ref={toolbarAnchorRef}
              className="pointer-events-none absolute size-0"
              style={{
                left: displayLayout.wPx / 2,
                top: displayLayout.hPx + 8,
              }}
              aria-hidden
            />
            <MapFloatingAnchorPortal
              open
              anchorRef={toolbarAnchorRef}
              dataAttr="data-basemap-toolbar"
              className="pointer-events-none flex flex-col items-center gap-1"
              offsetY={4}
            >
              <div
                data-basemap-toolbar
                className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-zinc-500/90 bg-zinc-900/98 px-2 py-1.5 shadow-xl ring-1 ring-cyan-500/30"
                role="toolbar"
                aria-label={
                  isTrackGen
                    ? t('mapEditor.basemap.toolbar.trackGenAria')
                    : t('mapEditor.basemap.toolbar.basemapAria')
                }
              >
                {isTrackGen ? (
                  <>
                    <button
                      type="button"
                      title={
                        trackGenCenterlines
                          ? trackGenResult
                            ? t('mapEditor.basemap.toolbar.regenerateTitle')
                            : t('mapEditor.basemap.toolbar.generateTitle')
                          : t('mapEditor.basemap.toolbar.needXodr')
                      }
                      disabled={!trackGenCenterlines || generating}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        openSizeDialog()
                      }}
                      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Route className="size-4" aria-hidden />
                      {generating
                        ? t('mapEditor.basemap.toolbar.generating')
                        : trackGenResult
                          ? t('mapEditor.basemap.toolbar.regenerate')
                          : t('mapEditor.basemap.toolbar.generate')}
                    </button>
                    <button
                      type="button"
                      title={
                        filledCanvas
                          ? t('mapEditor.basemap.toolbar.expandDone')
                          : t('mapEditor.basemap.toolbar.expandTitle')
                      }
                      aria-label={t('mapEditor.basemap.toolbar.expandTitle')}
                      data-basemap-expand
                      disabled={!canEdit || !mapPixelSize || filledCanvas}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        expandToCanvas()
                      }}
                      className="rounded-full p-1.5 text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Maximize className="size-4" aria-hidden />
                    </button>
                    {trackGenResult ? (
                      <button
                        type="button"
                        title={t('mapEditor.basemap.toolbar.clearResultTitle')}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          onPatchParameters(basemap.id, { [TRACKGEN_RESULT_KEY]: undefined })
                        }}
                        className="rounded-full p-1.5 text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300"
                      >
                        <Eraser className="size-4" aria-hidden />
                      </button>
                    ) : null}
                    <span className="mx-0.5 h-4 w-px bg-zinc-600" aria-hidden />
                  </>
                ) : null}
                <button
                  type="button"
                  hidden={isTrackGen}
                  title={
                    canSplit
                      ? t('mapEditor.basemap.toolbar.splitRow')
                      : cutsConfirmed
                        ? t('mapEditor.basemap.toolbar.cutsConfirmed')
                        : t('mapEditor.basemap.toolbar.selectRegionFirst')
                  }
                  disabled={!canSplit}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    onSplitCell('row')
                  }}
                  className="rounded-full p-1.5 text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Rows2 className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  hidden={isTrackGen}
                  title={
                    canSplit
                      ? t('mapEditor.basemap.toolbar.splitCol')
                      : cutsConfirmed
                        ? t('mapEditor.basemap.toolbar.cutsConfirmed')
                        : t('mapEditor.basemap.toolbar.selectRegionFirst')
                  }
                  disabled={!canSplit}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    onSplitCell('col')
                  }}
                  className="rounded-full p-1.5 text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Columns2 className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  hidden={isTrackGen}
                  title={
                    canConfirmCuts
                      ? t('mapEditor.basemap.toolbar.confirmCutsTitle')
                      : canReopenCuts
                        ? t('mapEditor.basemap.toolbar.reopenCutsTitle')
                        : t('mapEditor.basemap.toolbar.needTwoCells')
                  }
                  disabled={!canConfirmCuts && !canReopenCuts}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    if (canReopenCuts) onReopenCuts()
                    else if (canConfirmCuts) onConfirmCuts()
                  }}
                  className={`rounded-full p-1.5 transition disabled:cursor-not-allowed disabled:opacity-35 ${
                    canReopenCuts
                      ? 'text-violet-200 hover:bg-violet-950/80 hover:text-violet-100'
                      : 'text-zinc-200 hover:bg-zinc-700 hover:text-cyan-300'
                  }`}
                >
                  {canReopenCuts ? (
                    <PencilLine className="size-4" aria-hidden />
                  ) : (
                    <CircleCheck className="size-4" aria-hidden />
                  )}
                  <span className="sr-only">
                    {canReopenCuts
                      ? t('mapEditor.basemap.toolbar.reopenCuts')
                      : t('mapEditor.basemap.toolbar.confirmCuts')}
                  </span>
                </button>
                <div className="mx-0.5 h-5 w-px bg-zinc-600/80" aria-hidden />
                <button
                  type="button"
                  title={t('mapEditor.basemap.toolbar.sendToBack')}
                  disabled={!canSendBackward}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    onSendToBack?.(basemap.id)
                  }}
                  className="rounded-full p-1.5 text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ArrowDownToLine className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  title={t('mapEditor.basemap.toolbar.bringToFront')}
                  disabled={!canBringForward}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    onBringToFront?.(basemap.id)
                  }}
                  className="rounded-full p-1.5 text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ArrowUpToLine className="size-4" aria-hidden />
                </button>
              </div>
            </MapFloatingAnchorPortal>
          </>
        ) : null}
      </div>
      <TrackGenSizeDialog
        key={sizeDialogOpen ? 'open' : 'closed'}
        open={sizeDialogOpen}
        canvasPx={
          mapPixelSize ?? { width: displayLayout.wPx, height: displayLayout.hPx }
        }
        boxPx={{ wPx: displayLayout.wPx, hPx: displayLayout.hPx }}
        totals={trackGenTotals}
        initial={getTrackGenBlockSize(basemap.parameters)}
        initialMerges={getTrackGenMerges(basemap.parameters)}
        measure={measureTrackGen}
        onCancel={() => setSizeDialogOpen(false)}
        onConfirm={(block, groups, merges) => {
          setSizeDialogOpen(false)
          runTrackGeneration(block, groups, merges)
        }}
      />
      <BasemapFilePickerDialog
        open={pickerOpen}
        initialFileName={fileName}
        onConfirm={onConfirmFile}
        onCancel={() => setPickerOpen(false)}
      />
    </>
  )
})
