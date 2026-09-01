import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  CircleCheck,
  Columns2,
  Check,
  Eraser,
  PencilLine,
  Rows2,
  Route,
} from 'lucide-react'
import type { MapBasemapLayout, MapBasemapObject } from '../types/basemap'
import { AreaDragTrack } from './AreaDragTrack'
import { BasemapCellOverlay } from './BasemapCellOverlay'
import { BasemapGraphic } from './BasemapGraphic'
import { BasemapPartitionContent } from './BasemapPartitionContent'
import { BasemapFilePickerDialog } from './BasemapFilePickerDialog'
import { TrackGenGraphic } from './TrackGenGraphic'
import { parseLaneCenterlines } from '../opendrive/laneCenterlines'
import { generateTracks } from '../utils/trackGenerator'
import {
  getTrackGenFileName,
  getTrackGenResult,
  getTrackGenSettings,
  getTrackGenXodr,
  isTrackGenComponent,
  TRACKGEN_FILE_NAME_KEY,
  TRACKGEN_RESULT_KEY,
  TRACKGEN_XODR_KEY,
} from '../utils/trackGenFacility'
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
  onApplyTrackGen?: (basemapId: string) => void
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
  const trackGenResult = getTrackGenResult(basemap.parameters)
  const trackGenSettings = getTrackGenSettings(basemap.parameters)
  const [generating, setGenerating] = useState(false)

  const runTrackGeneration = useCallback(() => {
    if (!trackGenCenterlines) return
    setGenerating(true)
    // 讓「生成中」先畫出來，再做這件會佔住主執行緒約一秒的計算
    window.setTimeout(() => {
      try {
        const result = generateTracks(trackGenCenterlines, {
          blockLengthM: trackGenSettings.blockLengthM,
        })
        onPatchParameters(basemap.id, { [TRACKGEN_RESULT_KEY]: result })
      } finally {
        setGenerating(false)
      }
    }, 0)
  }, [basemap.id, onPatchParameters, trackGenCenterlines, trackGenSettings.blockLengthM])

  /*
   * 載入路網之後直接生成。
   *
   * 中心線只是中繼產物，使用者要的是軌道；讓他先看一張中心線再按一次按鈕沒有
   * 意義。改成拿到路網就生成，按鈕留著給改完參數重跑用。
   *
   * 判斷條件是「有路網、沒有結果」，所以拖進來、用選檔對話框、或是重新開啟一張
   * 舊地圖，三種進來的路徑都會生成。
   */
  const autoGenKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isTrackGen || !trackGenCenterlines || trackGenResult || generating) return
    const key = `${trackGenXodr?.length ?? 0}:${trackGenSettings.blockLengthM}`
    if (autoGenKeyRef.current === key) return
    autoGenKeyRef.current = key
    runTrackGeneration()
  }, [
    isTrackGen,
    trackGenCenterlines,
    trackGenResult,
    generating,
    trackGenXodr,
    trackGenSettings.blockLengthM,
    runTrackGeneration,
  ])

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
          <TrackGenGraphic
            width={displayLayout.wPx}
            height={displayLayout.hPx}
            centerlines={trackGenCenterlines}
            parseFailed={trackGenParseFailed}
            result={trackGenResult}
            settings={trackGenSettings}
            fileName={getTrackGenFileName(basemap.parameters)}
            readOnly={readOnly}
            selected={selected}
            onPickClick={() => setPickerOpen(true)}
          />
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
                aria-label={isTrackGen ? '軌道生成' : '底圖圖層'}
              >
                {isTrackGen ? (
                  <>
                    <button
                      type="button"
                      title={
                        trackGenCenterlines ? '依目前設定重新生成軌道' : '請先載入 .xodr'
                      }
                      disabled={!trackGenCenterlines || generating}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        runTrackGeneration()
                      }}
                      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Route className="size-4" aria-hidden />
                      {generating ? '生成中…' : '重新生成'}
                    </button>
                    {trackGenResult && onApplyTrackGen ? (
                      <button
                        type="button"
                        title="把生成的軌道變成地圖上真正的設施，之後可個別拉伸與設定"
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          onApplyTrackGen(basemap.id)
                        }}
                        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300"
                      >
                        <Check className="size-4" aria-hidden />
                        套用到地圖
                      </button>
                    ) : null}
                    {trackGenResult ? (
                      <button
                        type="button"
                        title="清除生成結果，回到只顯示中心線"
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
                      ? '橫向分割（上／下）'
                      : cutsConfirmed
                        ? '已確定切割，請點選各格後拖曳邊緣調整'
                        : '請先點選要分割的區域'
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
                      ? '縱向分割（左／右）'
                      : cutsConfirmed
                        ? '已確定切割，請點選各格後拖曳邊緣調整'
                        : '請先點選要分割的區域'
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
                      ? '確定切割（各格完全獨立，可個別縮放）'
                      : canReopenCuts
                        ? '重新編輯切割（回到分割草稿）'
                        : '請先分割成至少兩格'
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
                    {canReopenCuts ? '重新編輯切割' : '確定切割'}
                  </span>
                </button>
                <div className="mx-0.5 h-5 w-px bg-zinc-600/80" aria-hidden />
                <button
                  type="button"
                  title="置底（移到 Area 與地圖元件下方）"
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
                  title="置頂（蓋過 Area 與地圖元件）"
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
      <BasemapFilePickerDialog
        open={pickerOpen}
        initialFileName={fileName}
        onConfirm={onConfirmFile}
        onCancel={() => setPickerOpen(false)}
      />
    </>
  )
})
