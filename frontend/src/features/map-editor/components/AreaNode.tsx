import type { RefObject } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MqttLiveEntry } from '../live/mqttLiveTypes'
import { getMqttEntityId } from '../live/mqttEntityId'
import type { PaletteItem } from '../constants/palette'
import type { MapAreaLayout, MapAreaObject, MapPixelSize } from '../types/area'
import type {
  FacilityObject,
  GeofenceFacility,
  SlotEquipmentState,
  SlotOccupancy,
} from '../types/facility'
import {
  areaPxPerMeter,
  isMeterInDomain,
  meterToAreaLocalPx,
} from '../utils/areaCoords'
import {
  areaLayoutResizeMapFreezeOffset,
  resolveFacilityRenderPlacement,
  resolveFacilityRenderPlacementDuringAreaResize,
  resolveFacilitySnapRectCss,
} from '../utils/facilityAreaCoords'
import { findFacilityAtAreaLocalPx } from '../utils/facilityHitTest'
import {
  cornerTrackEndSegmentsPx,
  readCornerTrack,
  readSwitchTrack,
  readTaperTrack,
  switchTrackEndSegmentsPx,
  taperTrackEndSegmentsPx,
  CORNER_TRACK_KEY,
  SWITCH_TRACK_KEY,
  TAPER_TRACK_KEY,
} from '../utils/trackShapes'
import { buildTaperFromEndSegments, type EndSegment } from '../utils/taperJoin'
import { buildCornerFromEndSegments } from '../utils/cornerJoin'
import { buildRectFromEndSegments } from '../utils/railJoin'
import { alignSwitchFaces, buildSwitchFromEndSegments } from '../utils/switchJoin'
import {
  resolveFacilityAreaPosition,
  resolveFacilityAreaSize,
} from '../utils/facilityAreaCoords'
import { areaLocalPxToMeter } from '../utils/areaCoords'
import {
  resolveAreaBorderStyle,
  resolveAreaFillStyle,
} from '../utils/areaLayoutStyle'
import {
  BASEMAP_LAYER_Z,
  listBasemapsForPaint,
  listRoadLinesForPaint,
  resolveFacilityStackZ,
  ROAD_LINE_LAYER_Z,
  sortFacilitiesForPaint,
} from '../utils/facilityLayerOrder'
import {
  extractFacilityFormat,
  type FacilityFormatSnapshot,
} from '../utils/facilityFormatPainter'
import {
  decodePaletteDragItem,
  isAreaPaletteItem,
  PALETTE_DRAG_MIME,
} from '../utils/paletteDrag'
import { FacilityNode } from './FacilityNode'
import { FacilityDragGuidesOverlay } from './FacilityDragGuidesOverlay'
import { CrossoverSnapOverlay } from './CrossoverSnapOverlay'
import { buildEditorTrackSnapSegments } from '../utils/trackEditorSnapSegments'
import type { CrossoverSnapUi } from '../utils/crossoverSnapUi'
import { GeofenceNode } from './GeofenceNode'
import type { AlignGuideLine, SnapRect } from '../utils/facilityDragAlign'
import { buildCrossAreaPeerSnapRects } from '../utils/facilityDragAlign'
import { AreaRulerOverlay } from './AreaRulerOverlay'
import { AreaDragTrack } from './AreaDragTrack'
import {
  facilityIdsInMarqueeRect,
  type MarqueeRect,
} from '../utils/facilityMarquee'

const MIN_AREA_PX = 32
/** 開始拖曳 Area 布局前所需移動距離（螢幕 px） */
const LAYOUT_DRAG_START_PX = 4
/** 框選開始前所需移動距離（螢幕 px） */
const MARQUEE_START_PX = 4
/** 邊界感應帶寬度（Area 內局部 px） */
const EDGE_HIT_PX = 10
/** 角落感應帶（優先於直邊） */
const CORNER_HIT_PX = 14

type AreaResizeEdge =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'tl'
  | 'tr'
  | 'bl'
  | 'br'

function normalizeAreaLayoutSize(layout: MapAreaLayout): MapAreaLayout {
  return {
    ...layout,
    wPx: Math.max(MIN_AREA_PX, layout.wPx),
    hPx: Math.max(MIN_AREA_PX, layout.hPx),
  }
}

/** 依拖曳位移調整外框；角落不鎖 domain 比例（避免未移動就跳位） */
function layoutFromCornerResize(
  start: MapAreaLayout,
  edge: AreaResizeEdge,
  dx: number,
  dy: number,
): MapAreaLayout {
  let { xPx, yPx, wPx, hPx } = start

  if (edge === 'right') {
    wPx = start.wPx + dx
  } else if (edge === 'left') {
    wPx = start.wPx - dx
    xPx = start.xPx + dx
  } else if (edge === 'bottom') {
    hPx = start.hPx + dy
  } else if (edge === 'top') {
    hPx = start.hPx - dy
    yPx = start.yPx + dy
  } else if (edge === 'br') {
    wPx = start.wPx + dx
    hPx = start.hPx + dy
  } else if (edge === 'tr') {
    wPx = start.wPx + dx
    hPx = start.hPx - dy
    yPx = start.yPx + dy
  } else if (edge === 'bl') {
    wPx = start.wPx - dx
    hPx = start.hPx + dy
    xPx = start.xPx + dx
  } else if (edge === 'tl') {
    wPx = start.wPx - dx
    hPx = start.hPx - dy
    xPx = start.xPx + dx
    yPx = start.yPx + dy
  }

  return normalizeAreaLayoutSize({ ...start, xPx, yPx, wPx, hPx })
}

function hitAreaLayoutEdge(
  localX: number,
  localY: number,
  wPx: number,
  hPx: number,
): AreaResizeEdge | null {
  const onLeft = localX <= CORNER_HIT_PX
  const onRight = localX >= wPx - CORNER_HIT_PX
  const onTop = localY <= CORNER_HIT_PX
  const onBottom = localY >= hPx - CORNER_HIT_PX

  if (onTop && onLeft) return 'tl'
  if (onTop && onRight) return 'tr'
  if (onBottom && onLeft) return 'bl'
  if (onBottom && onRight) return 'br'
  if (localX <= EDGE_HIT_PX) return 'left'
  if (localX >= wPx - EDGE_HIT_PX) return 'right'
  if (localY <= EDGE_HIT_PX) return 'top'
  if (localY >= hPx - EDGE_HIT_PX) return 'bottom'
  return null
}

function cursorForAreaEdge(edge: AreaResizeEdge): string {
  switch (edge) {
    case 'left':
    case 'right':
      return 'ew-resize'
    case 'top':
    case 'bottom':
      return 'ns-resize'
    case 'tl':
    case 'br':
      return 'nwse-resize'
    case 'tr':
    case 'bl':
      return 'nesw-resize'
  }
}

type AreaNodeProps = {
  area: MapAreaObject
  selected: boolean
  selectedFacilityIds: string[]
  geofenceSelectedLabelId: string | null
  readOnly: boolean
  editMode: boolean
  liveById?: Record<string, MqttLiveEntry>
  slotPreview?: {
    facilityId: string
    occupancy: SlotOccupancy
    equipment: SlotEquipmentState
  } | null
  onSelectArea: (areaId: string) => void
  onSelectFacility: (
    areaId: string,
    facilityId: string | null,
    options?: { additive?: boolean },
  ) => void
  onSelectFacilities?: (
    areaId: string,
    facilityIds: string[],
    options?: { additive?: boolean },
  ) => void
  /** 點選 Area 內空白（非設施）時 */
  onEmptyMapPointerDown?: () => void
  onSelectGeofenceLabel: (areaId: string, facilityId: string, labelId: string | null) => void
  onFacilityDoubleClick?: (areaId: string, facilityId: string) => void
  onDragFacility: (
    areaId: string,
    facilityId: string,
    update: {
      areaPosition: { x: number; y: number }
      position: { x: number; y: number }
    },
  ) => void
  onDragSessionStart?: () => void
  onResizeFacility?: (
    areaId: string,
    facilityId: string,
    areaSizePx: { w: number; h: number },
  ) => void
  onResizeSessionStart?: () => void
  onPatchFacilityParameters?: (
    areaId: string,
    facilityId: string,
    patch: Record<string, unknown>,
  ) => void
  onRotateLeft90: (areaId: string, facilityId: string) => void
  onRotateRight90: (areaId: string, facilityId: string) => void
  onRotateDelta: (areaId: string, facilityId: string, deltaDeg: number) => void
  onTrackCornerEditStart?: () => void
  onDeleteFacility?: (areaId: string, facilityId: string) => void
  onUpdateGeofence?: (
    areaId: string,
    facilityId: string,
    update: {
      verticesMeters?: { x: number; y: number }[]
      parameters?: Record<string, unknown>
    },
  ) => void
  onGeofenceEditStart?: () => void
  onPaletteDrop?: (
    areaId: string,
    item: PaletteItem,
    areaPositionCenter: { x: number; y: number },
  ) => void
  /** 畫布 fit 視窗縮放比，供 Area 刻度 UI 補償 */
  mapScale?: number
  mapViewportRef?: RefObject<HTMLDivElement | null>
  mapPixelSize?: MapPixelSize
  onPatchAreaLayout?: (areaId: string, layout: MapAreaLayout) => void
  /** 拉伸預覽：依新 layout 重算場域座標，區域座標不變 */
  onAreaLayoutSessionStart?: () => void
  /** 全選 Area：拖曳外框移動時一併平移所有 Area */
  allAreasSelected?: boolean
  onBulkAreasLayoutSessionStart?: () => void
  onBulkAreasLayoutMove?: (dx: number, dy: number) => void
  onBulkAreasLayoutCommit?: () => void
  formatPaintSnapshot?: FacilityFormatSnapshot | null
  onStartFormatPaint?: (snapshot: FacilityFormatSnapshot) => void
  onFormatPaintTarget?: (areaId: string, facilityId: string) => void
  onCancelFormatPaint?: () => void
  onFacilityHover?: (
    areaId: string,
    facilityId: string,
    hovered: boolean,
  ) => void
  showCenterLabel?: boolean
  /** 選取元件時顯示圓形工具列（旋轉、格式複製、刪除等） */
  showFacilityToolbars?: boolean
  /** 與其他 Area 的繪製順序（用於選取時浮起） */
  areaStackOrder?: number
  /** 地圖上所有 Area（跨區對齊用） */
  allAreas?: MapAreaObject[]
  /** 導通掃描：附近可能涉及的軌道 id */
  connectivityScanHighlightTrackIds?: readonly string[] | null
}

/** Area 外框拖曳軌道 z-index；內層含選中設施時須高於此值 */
const AREA_DRAG_TRACK_Z = 5000
const AREA_INNER_ELEVATED_Z = AREA_DRAG_TRACK_Z + 20

export const AreaNode = memo(function AreaNode({
  area,
  areaStackOrder = 0,
  selected,
  selectedFacilityIds,
  geofenceSelectedLabelId,
  readOnly,
  editMode,
  liveById,
  slotPreview = null,
  onSelectArea,
  onSelectFacility,
  onSelectFacilities,
  onEmptyMapPointerDown,
  onSelectGeofenceLabel,
  onFacilityDoubleClick,
  onDragFacility,
  onDragSessionStart,
  onResizeFacility,
  onResizeSessionStart,
  onPatchFacilityParameters,
  onRotateLeft90,
  onRotateRight90,
  onRotateDelta,
  onTrackCornerEditStart,
  onDeleteFacility,
  onUpdateGeofence,
  onGeofenceEditStart,
  onPaletteDrop,
  mapScale = 1,
  mapViewportRef,
  mapPixelSize,
  onPatchAreaLayout,
  onAreaLayoutSessionStart,
  allAreasSelected = false,
  onBulkAreasLayoutSessionStart,
  onBulkAreasLayoutMove,
  onBulkAreasLayoutCommit,
  formatPaintSnapshot = null,
  onStartFormatPaint,
  onFormatPaintTarget,
  onCancelFormatPaint,
  onFacilityHover,
  showCenterLabel = false,
  showFacilityToolbars = true,
  allAreas,
  connectivityScanHighlightTrackIds = null,
}: AreaNodeProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const { layout, domain } = area
  const canEditLayout =
    editMode &&
    !readOnly &&
    !!mapPixelSize &&
    !!onPatchAreaLayout
  /** 檢視模式：Area 外框不攔截點擊，讓下層重疊區域的設施可被選取（如 U16） */
  const viewModePointerPassthrough = !editMode
  const hasSelectedFacility = selectedFacilityIds.length > 0
  const elevateAreaStack = selected || hasSelectedFacility
  const areaZIndex = elevateAreaStack
    ? 10_000 + areaStackOrder
    : 10 + areaStackOrder
  const [liveLayout, setLiveLayout] = useState<MapAreaLayout | null>(null)
  const liveLayoutRef = useRef<MapAreaLayout | null>(null)
  const [draggingFacilityId, setDraggingFacilityId] = useState<string | null>(
    null,
  )
  const [resizingFacilityId, setResizingFacilityId] = useState<string | null>(
    null,
  )
  const [dragLiveAreaPos, setDragLiveAreaPos] = useState<{
    x: number
    y: number
  } | null>(null)
  const [dragAlignGuides, setDragAlignGuides] = useState<AlignGuideLine[] | null>(
    null,
  )
  const [crossoverSnapUi, setCrossoverSnapUi] = useState<CrossoverSnapUi | null>(
    null,
  )
  const [dragStartPositions, setDragStartPositions] = useState<Record<
    string,
    { x: number; y: number }
  > | null>(null)
  const displayLayout = liveLayout ?? layout
  /** 已提交的 layout；設施渲染／命中用此值，拉伸預覽時不隨 liveLayout 變動 */
  const committedLayout = layout
  const displayDomain = domain
  const areaBorder = resolveAreaBorderStyle(displayLayout)
  const areaFill = resolveAreaFillStyle(displayLayout)
  const layoutSessionPushedRef = useRef(false)
  const layoutPendingRef = useRef<
    | {
        kind: 'move' | 'resize'
        edge?: AreaResizeEdge
        startX: number
        startY: number
        layout: MapAreaLayout
      }
    | null
  >(null)
  const layoutDragRef = useRef<
    | {
        kind: 'move'
        startX: number
        startY: number
        layout: MapAreaLayout
      }
    | {
        kind: 'resize'
        edge: AreaResizeEdge
        startX: number
        startY: number
        layout: MapAreaLayout
      }
    | null
  >(null)
  const [hoverEdge, setHoverEdge] = useState<AreaResizeEdge | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null)
  const marqueePendingRef = useRef<{
    startX: number
    startY: number
    shiftKey: boolean
  } | null>(null)
  const marqueeWindowCleanupRef = useRef<(() => void) | null>(null)
  const marqueeActiveRef = useRef(false)

  useEffect(
    () => () => {
      marqueeWindowCleanupRef.current?.()
      marqueeWindowCleanupRef.current = null
    },
    [],
  )

  const clearMarqueeWindowListeners = useCallback(() => {
    marqueeWindowCleanupRef.current?.()
    marqueeWindowCleanupRef.current = null
  }, [])

  const layoutWindowCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    liveLayoutRef.current = liveLayout
  }, [liveLayout])

  const clearLayoutDragState = useCallback(
    (commit = false) => {
      const wasBulkMove =
        allAreasSelected &&
        layoutDragRef.current?.kind === 'move' &&
        !!onBulkAreasLayoutMove
      const pendingLayout = liveLayoutRef.current
      if (wasBulkMove && commit) {
        onBulkAreasLayoutCommit?.()
      } else if (commit && pendingLayout && onPatchAreaLayout && !wasBulkMove) {
        onPatchAreaLayout(area.id, normalizeAreaLayoutSize(pendingLayout))
      }
      layoutPendingRef.current = null
      layoutDragRef.current = null
      layoutSessionPushedRef.current = false
      setLiveLayout(null)
      liveLayoutRef.current = null
      layoutWindowCleanupRef.current?.()
      layoutWindowCleanupRef.current = null
    },
    [
      area.id,
      allAreasSelected,
      onBulkAreasLayoutCommit,
      onBulkAreasLayoutMove,
      onPatchAreaLayout,
    ],
  )

  useEffect(() => {
    if (!selected) {
      clearLayoutDragState(true)
    }
  }, [selected, clearLayoutDragState])

  useEffect(
    () => () => {
      clearLayoutDragState(true)
    },
    [clearLayoutDragState],
  )

  const { pxPerMeterX, pxPerMeterY } = areaPxPerMeter(committedLayout, displayDomain)
  const domainSpan = {
    w: displayDomain.xMaxM - displayDomain.xMinM,
    h: displayDomain.yMaxM - displayDomain.yMinM,
  }
  const areaMeterContext = {
    domain: displayDomain,
    layout: committedLayout,
  }

  const crossoverSegmentById = useMemo(
    () => buildEditorTrackSnapSegments(area),
    [area],
  )

  const onCrossoverSnapUiChange = useCallback((ui: CrossoverSnapUi | null) => {
    setCrossoverSnapUi(ui)
  }, [])

  const crossoverSnapOverlayModel = useMemo(() => {
    if (!crossoverSnapUi) return null
    const primaryIds = new Set(crossoverSnapUi.hooks.map((h) => h.trackId))
    const trackGlows: Array<{
      trackId: string
      x1: number
      y1: number
      x2: number
      y2: number
      primary: boolean
    }> = []
    for (const trackId of crossoverSnapUi.nearbyTrackIds) {
      const seg = crossoverSegmentById.get(trackId)
      if (!seg) continue
      const b = seg.bounds
      const p1 = meterToAreaLocalPx(b.xMinM, b.yMinM, displayDomain, committedLayout)
      const p2 = meterToAreaLocalPx(b.xMaxM, b.yMaxM, displayDomain, committedLayout)
      // Area local Y 向上 → CSS Y 向下
      const h = committedLayout.hPx
      if (seg.horizontal) {
        const y = h - (p1.y + p2.y) / 2
        trackGlows.push({
          trackId,
          x1: Math.min(p1.x, p2.x),
          y1: y,
          x2: Math.max(p1.x, p2.x),
          y2: y,
          primary: primaryIds.has(trackId),
        })
      } else {
        const x = (p1.x + p2.x) / 2
        trackGlows.push({
          trackId,
          x1: x,
          y1: h - Math.max(p1.y, p2.y),
          x2: x,
          y2: h - Math.min(p1.y, p2.y),
          primary: primaryIds.has(trackId),
        })
      }
    }
    const hooks = crossoverSnapUi.hooks.map((hook) => {
      const at = meterToAreaLocalPx(
        hook.xM,
        hook.yM,
        displayDomain,
        committedLayout,
      )
      const from = meterToAreaLocalPx(
        hook.fromXM,
        hook.fromYM,
        displayDomain,
        committedLayout,
      )
      const h = committedLayout.hPx
      return {
        trackId: hook.trackId,
        x: at.x,
        y: h - at.y,
        fromX: from.x,
        fromY: h - from.y,
        horizontal: hook.horizontal,
        openNx: hook.openNx,
        openNy: -hook.openNy,
        engaged: hook.engaged,
      }
    })
    return { trackGlows, hooks }
  }, [
    committedLayout,
    crossoverSegmentById,
    crossoverSnapUi,
    displayDomain,
  ])

  const clientToInnerLocal = useCallback(
    (clientX: number, clientY: number) => {
      const el = innerRef.current
      if (!el) return { x: 0, y: 0 }
      const rect = el.getBoundingClientRect()
      const scale = Math.max(0.01, mapScale)
      return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale,
      }
    },
    [mapScale],
  )

  const beginLayoutDrag = useCallback(
    (pointerId: number) => {
      const pending = layoutPendingRef.current
      if (!pending) return
      layoutPendingRef.current = null
      layoutDragRef.current = {
        kind: 'move',
        startX: pending.startX,
        startY: pending.startY,
        layout: pending.layout,
      }
      try {
        outerRef.current?.setPointerCapture(pointerId)
      } catch {
        /* ignore */
      }
    },
    [],
  )

  const applyLayoutPointerMove = useCallback(
    (clientX: number, clientY: number, pointerId: number) => {
      const pending = layoutPendingRef.current
      if (pending && !layoutDragRef.current) {
        const dx = clientX - pending.startX
        const dy = clientY - pending.startY
        if (dx * dx + dy * dy >= LAYOUT_DRAG_START_PX * LAYOUT_DRAG_START_PX) {
          beginLayoutDrag(pointerId)
        }
      }

      const drag = layoutDragRef.current
      if (!drag) return
      if (!layoutSessionPushedRef.current) {
        layoutSessionPushedRef.current = true
        if (drag.kind === 'move' && allAreasSelected && onBulkAreasLayoutMove) {
          onBulkAreasLayoutSessionStart?.()
        } else {
          onAreaLayoutSessionStart?.()
        }
      }
      const scale = Math.max(0.01, mapScale)
      const dx = (clientX - drag.startX) / scale
      const dy = (clientY - drag.startY) / scale
      if (drag.kind === 'move') {
        if (allAreasSelected && onBulkAreasLayoutMove) {
          onBulkAreasLayoutMove(dx, dy)
          return
        }
        const next = normalizeAreaLayoutSize({
          ...drag.layout,
          xPx: drag.layout.xPx + dx,
          yPx: drag.layout.yPx + dy,
        })
        setLiveLayout(next)
        return
      }
      const next = layoutFromCornerResize(drag.layout, drag.edge, dx, dy)
      setLiveLayout(next)
    },
    [
      mapScale,
      allAreasSelected,
      onAreaLayoutSessionStart,
      onBulkAreasLayoutSessionStart,
      onBulkAreasLayoutMove,
      beginLayoutDrag,
    ],
  )

  const attachLayoutWindowListeners = useCallback(
    (pointerId: number) => {
      layoutWindowCleanupRef.current?.()
      const onWindowMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        applyLayoutPointerMove(ev.clientX, ev.clientY, pointerId)
      }
      const onWindowUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        clearLayoutDragState(true)
        try {
          outerRef.current?.releasePointerCapture(pointerId)
        } catch {
          /* ignore */
        }
      }
      window.addEventListener('pointermove', onWindowMove)
      window.addEventListener('pointerup', onWindowUp)
      window.addEventListener('pointercancel', onWindowUp)
      layoutWindowCleanupRef.current = () => {
        window.removeEventListener('pointermove', onWindowMove)
        window.removeEventListener('pointerup', onWindowUp)
        window.removeEventListener('pointercancel', onWindowUp)
      }
    },
    [clearLayoutDragState, applyLayoutPointerMove],
  )

  const onLayoutPointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      kind: 'move' | 'resize',
      edge?: AreaResizeEdge,
    ) => {
      if (!canEditLayout || !selected) return
      e.stopPropagation()
      e.preventDefault()
      if (kind === 'resize' && allAreasSelected) return
      if (kind === 'resize' && edge) {
        layoutPendingRef.current = null
        layoutDragRef.current = {
          kind: 'resize',
          edge,
          startX: e.clientX,
          startY: e.clientY,
          layout,
        }
        outerRef.current?.setPointerCapture(e.pointerId)
        attachLayoutWindowListeners(e.pointerId)
        return
      }
      layoutPendingRef.current = {
        kind: 'move',
        startX: e.clientX,
        startY: e.clientY,
        layout,
      }
      outerRef.current?.setPointerCapture(e.pointerId)
      attachLayoutWindowListeners(e.pointerId)
    },
    [allAreasSelected, canEditLayout, selected, layout, attachLayoutWindowListeners],
  )

  const updateHoverEdge = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (
        !canEditLayout ||
        !selected ||
        layoutDragRef.current ||
        layoutPendingRef.current
      ) {
        return
      }
      const rect = e.currentTarget.getBoundingClientRect()
      const scale = Math.max(0.01, mapScale)
      const localX = (e.clientX - rect.left) / scale
      const localY = (e.clientY - rect.top) / scale
      setHoverEdge(
        hitAreaLayoutEdge(localX, localY, displayLayout.wPx, displayLayout.hPx),
      )
    },
    [canEditLayout, selected, mapScale, displayLayout.wPx, displayLayout.hPx],
  )

  const clearHoverEdge = useCallback(() => {
    if (layoutDragRef.current) return
    setHoverEdge(null)
  }, [])

  const pickFacilityAtClient = useCallback(
    (clientX: number, clientY: number) => {
      const outer = outerRef.current
      if (!outer) return null
      const rect = outer.getBoundingClientRect()
      const scale = Math.max(0.01, mapScale)
      const localX = (clientX - rect.left) / scale
      const localY = (clientY - rect.top) / scale
      return findFacilityAtAreaLocalPx(
        localX,
        localY,
        area.facilities,
        displayDomain,
        committedLayout,
        domainSpan,
      )
    },
    [
      mapScale,
      area.facilities,
      displayDomain,
      committedLayout,
      domainSpan,
    ],
  )

  const selectFacilityInViewMode = useCallback(
    (facilityId: string, additive: boolean) => {
      if (editMode) return
      onSelectFacility(area.id, facilityId, { additive })
    },
    [editMode, onSelectFacility, area.id],
  )

  const onOuterPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      if (!canEditLayout) {
        const hitFacilityId = pickFacilityAtClient(e.clientX, e.clientY)
        if (hitFacilityId) {
          selectFacilityInViewMode(hitFacilityId, e.shiftKey)
        }
        return
      }
      const t = e.target as HTMLElement
      if (
        t.closest('[data-facility-root]') ||
        t.closest('[data-facility]') ||
        t.closest('[data-geofence]')
      ) {
        return
      }
      const rect = e.currentTarget.getBoundingClientRect()
      const scale = Math.max(0.01, mapScale)
      const localX = (e.clientX - rect.left) / scale
      const localY = (e.clientY - rect.top) / scale
      const edge = hitAreaLayoutEdge(
        localX,
        localY,
        displayLayout.wPx,
        displayLayout.hPx,
      )
      if (edge && selected) {
        onLayoutPointerDown(e, 'resize', edge)
        return
      }
      const hitFacilityId = findFacilityAtAreaLocalPx(
        localX,
        localY,
        area.facilities,
        displayDomain,
        displayLayout,
        domainSpan,
      )
      if (hitFacilityId) {
        if (formatPaintSnapshot) {
          onFormatPaintTarget?.(area.id, hitFacilityId)
          return
        }
        onSelectFacility(area.id, hitFacilityId, { additive: e.shiftKey })
        return
      }
      if (formatPaintSnapshot) {
        onCancelFormatPaint?.()
      }
    },
    [
      canEditLayout,
      mapScale,
      displayLayout,
      area.facilities,
      displayDomain,
      domainSpan,
      onLayoutPointerDown,
      formatPaintSnapshot,
      onFormatPaintTarget,
      onCancelFormatPaint,
      onSelectFacility,
      area.id,
      selected,
      pickFacilityAtClient,
      selectFacilityInViewMode,
    ],
  )

  const onLayoutPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      applyLayoutPointerMove(e.clientX, e.clientY, e.pointerId)
    },
    [applyLayoutPointerMove],
  )

  const onLayoutPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      clearLayoutDragState(true)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    },
    [clearLayoutDragState],
  )


  /* ── 斜接軌道端點接合 ────────────────────────────────────────
     端點拖到別的軌道邊上 → 高亮 → 放手接合，並讓那一端與對手齊寬。
     這是斜接軌道能接上「A 在 B 之上」與「A 在 B 之下」兩種情形的唯一辦法：
     平行四邊形兩端一定等寬、錯位方向也固定，後者怎麼轉都接不上。           */

  /**
   * 拖曳中會接上的目標：<strong>哪一條軌道的哪一條邊</strong>。
   *
   * 先前只記 id、畫面上把整塊框起來。使用者要的是「那一邊」——一塊軌道有兩個端面，
   * 框住整塊看不出來會接到哪一頭。現在把邊也記下來，直接把那條邊描粗。
   */
  const [taperHighlight, setTaperHighlight] = useState<{
    targetId: string
    edge: { x1: number; y1: number; x2: number; y2: number }
  } | null>(null)

  /**
   * 一個軌道的<strong>兩條端面</strong>（Area 局部像素，含旋轉）。
   *
   * 只回傳與行進方向垂直的那一對短邊，不回傳長邊。軌道是端對端相接的，接到側面
   * 既接不出東西、又會把長邊變成一個大得多的吸附目標，短短的端面反而永遠吸不到
   * ——實測就是只吸得到上下邊、吸不到左右邊。
   */
  const facilityEndEdgesLocal = useCallback(
    (f: FacilityObject) => {
      const pos = resolveFacilityAreaPosition(f, displayDomain, displayLayout)
      const size = resolveFacilityAreaSize(f, displayDomain, displayLayout)
      const top = displayLayout.hPx - pos.y - size.h
      const cx = pos.x + size.w / 2
      const cy = top + size.h / 2
      const rad = ((f.rotation ?? 0) * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const corner = (dx: number, dy: number) => ({
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos,
      })
      // 圓角軌道的端面是外弧與內弧之間那一小段直邊，不是外框的短邊
      if (f.name === 'RailCorner') {
        const segs = cornerTrackEndSegmentsPx(readCornerTrack(f.parameters), size.w, size.h)
        const L = (q: { x: number; y: number }) => ({ x: pos.x + q.x, y: top + q.y })
        return (['a', 'b'] as const).map((k) => {
          const p0 = L(segs[k][0])
          const p1 = L(segs[k][1])
          return { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y }
        })
      }
      // 分岔軌道有三個面，也由自己的幾何決定
      if (f.name === 'RailSwitch') {
        const segs = switchTrackEndSegmentsPx(readSwitchTrack(f.parameters), size.w, size.h)
        const L = (q: { x: number; y: number }) => ({ x: pos.x + q.x, y: top + q.y })
        return (['a', 'm', 'b'] as const).map((k) => {
          const p0 = L(segs[k][0])
          const p1 = L(segs[k][1])
          return { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y }
        })
      }
      // 斜接軌道的端面由它自己的幾何決定，不是外框的長短邊
      if (f.name === 'RailTaper') {
        const segs = taperTrackEndSegmentsPx(readTaperTrack(f.parameters), size.w, size.h)
        const L = (q: { x: number; y: number }) => ({ x: pos.x + q.x, y: top + q.y })
        const a0 = L(segs.a[0])
        const a1 = L(segs.a[1])
        const b0 = L(segs.b[0])
        const b1 = L(segs.b[1])
        return [
          { x1: a0.x, y1: a0.y, x2: a1.x, y2: a1.y },
          { x1: b0.x, y1: b0.y, x2: b1.x, y2: b1.y },
        ]
      }
      const hw = size.w / 2
      const hh = size.h / 2
      const tl = corner(-hw, -hh)
      const tr = corner(hw, -hh)
      const br = corner(hw, hh)
      const bl = corner(-hw, hh)
      // 長邊沿著行進方向，端面是另一對
      return size.w >= size.h
        ? [
            { x1: tl.x, y1: tl.y, x2: bl.x, y2: bl.y },
            { x1: tr.x, y1: tr.y, x2: br.x, y2: br.y },
          ]
        : [
            { x1: tl.x, y1: tl.y, x2: tr.x, y2: tr.y },
            { x1: bl.x, y1: bl.y, x2: br.x, y2: br.y },
          ]
    },
    [displayDomain, displayLayout],
  )

  /**
   * 一個元件<strong>自己</strong>的接合面，依面的代號取用。
   *
   * 四種軌道都有：一般兩個（兩條短邊）、圓角兩個、斜接兩個、分岔三個。虛擬渡線不在
   * 這個機制裡——它本來就是靠兩個 portal 貼上軌道，不是靠端面。
   */
  const trackFacesLocal = useCallback(
    (f: FacilityObject): Record<string, EndSegment> | null => {
      const edges = facilityEndEdgesLocal(f)
      const seg = (e: { x1: number; y1: number; x2: number; y2: number }): EndSegment => [
        { x: e.x1, y: e.y1 },
        { x: e.x2, y: e.y2 },
      ]
      if (f.name === 'RailSwitch') {
        if (edges.length < 3) return null
        return { a: seg(edges[0]!), m: seg(edges[1]!), b: seg(edges[2]!) }
      }
      if (edges.length < 2) return null
      return { a: seg(edges[0]!), b: seg(edges[1]!) }
    },
    [facilityEndEdgesLocal],
  )

  /** 這一面換成那條邊之後，這個元件表示得出來嗎——表示不出來就不該亮綠燈 */
  const trackWouldJoin = useCallback(
    (f: FacilityObject, end: string, edge: EndSegment): boolean => {
      const cur = trackFacesLocal(f)
      if (!cur || !cur[end]) return false
      if (f.name === 'RailSwitch') {
        const next = alignSwitchFaces(
          { a: cur.a!, m: cur.m!, b: cur.b! },
          end as 'a' | 'm' | 'b',
          edge,
        )
        return !!next && !!buildSwitchFromEndSegments(next.a, next.m, next.b)
      }
      const other = end === 'a' ? cur.b! : cur.a!
      const [x, y] = end === 'a' ? [edge, other] : [other, edge]
      if (f.name === 'RailTaper') return !!buildTaperFromEndSegments(x, y)
      if (f.name === 'RailCorner') return !!buildCornerFromEndSegments(x, y)
      return !!buildRectFromEndSegments(edge, other)
    },
    [trackFacesLocal],
  )

  const clientToAreaLocal = useCallback(
    (clientX: number, clientY: number) => {
      const rect = innerRef.current?.getBoundingClientRect()
      if (!rect) return null
      const scale = Math.max(0.01, mapScale)
      return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale }
    },
    [mapScale],
  )

  const onTrackEndProbe = useCallback(
    (facilityId: string, end: string, clientX: number, clientY: number) => {
      const f = area.facilities.find((x) => x.id === facilityId)
      const p = clientToAreaLocal(clientX, clientY)
      if (!f || !p) return null
      // 吸附範圍隨縮放走，畫面上大約就是一根手指的寬度
      const reach = 14 / Math.max(0.01, mapScale)
      let best: { targetId: string; edge: { x1: number; y1: number; x2: number; y2: number } } | null =
        null
      let bestD = reach
      for (const other of area.facilities) {
        if (other.id === facilityId || other.type !== 'Track') continue
        for (const e of facilityEndEdgesLocal(other)) {
          const dx = e.x2 - e.x1
          const dy = e.y2 - e.y1
          const l2 = dx * dx + dy * dy
          const u = l2 ? Math.max(0, Math.min(1, ((p.x - e.x1) * dx + (p.y - e.y1) * dy) / l2)) : 0
          const d = Math.hypot(p.x - (e.x1 + dx * u), p.y - (e.y1 + dy * u))
          /*
           * 接不成的就不算候選。
           *
           * 先前這種目標照樣亮綠燈，放手卻什麼都沒發生——使用者只會覺得功能壞了。
           * 現在先試算一次，成得了才亮。
           */
          if (
            d < bestD &&
            trackWouldJoin(f, end, [
              { x: e.x1, y: e.y1 },
              { x: e.x2, y: e.y2 },
            ])
          ) {
            bestD = d
            best = { targetId: other.id, edge: e }
          }
        }
      }
      setTaperHighlight(best)
      return best
    },
    [area.facilities, clientToAreaLocal, facilityEndEdgesLocal, mapScale, trackWouldJoin],
  )

  const onTrackEndCommit = useCallback(
    (
      facilityId: string,
      end: string,
      target: { targetId: string; edge: { x1: number; y1: number; x2: number; y2: number } } | null,
      pointer: { clientX: number; clientY: number },
    ) => {
      setTaperHighlight(null)
      const f = area.facilities.find((x) => x.id === facilityId)
      if (!f || !onPatchFacilityParameters || !onResizeFacility || !onDragFacility) return
      const cur = trackFacesLocal(f)
      if (!cur || !cur[end]) return

      let want: EndSegment
      if (target) {
        want = [
          { x: target.edge.x1, y: target.edge.y1 },
          { x: target.edge.x2, y: target.edge.y2 },
        ]
      } else {
        // 沒碰到東西：把那一面整條平移到指標處，寬度不變
        const p = clientToAreaLocal(pointer.clientX, pointer.clientY)
        if (!p) return
        const seg = cur[end]!
        const mid = { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 }
        const dx = p.x - mid.x
        const dy = p.y - mid.y
        want = [
          { x: seg[0].x + dx, y: seg[0].y + dy },
          { x: seg[1].x + dx, y: seg[1].y + dy },
        ]
      }

      /** 算出來的新外框與新幾何；幾何為 null 表示這一種元件沒有幾何參數（一般軌道） */
      let built:
        | {
            box: { x: number; y: number; w: number; h: number }
            patch: Record<string, unknown> | null
            rotationDeg?: number
          }
        | null = null

      if (f.name === 'RailSwitch') {
        const next = alignSwitchFaces(
          { a: cur.a!, m: cur.m!, b: cur.b! },
          end as 'a' | 'm' | 'b',
          want,
        )
        const r = next && buildSwitchFromEndSegments(next.a, next.m, next.b)
        if (r) built = { box: r.box, patch: { [SWITCH_TRACK_KEY]: r.geometry } }
      } else {
        const other = end === 'a' ? cur.b! : cur.a!
        const [x, y] = end === 'a' ? [want, other] : [other, want]
        if (f.name === 'RailTaper') {
          const r = buildTaperFromEndSegments(x, y)
          if (r) built = { box: r.box, patch: { [TAPER_TRACK_KEY]: r.geometry } }
        } else if (f.name === 'RailCorner') {
          const r = buildCornerFromEndSegments(x, y)
          if (r) built = { box: r.box, patch: { [CORNER_TRACK_KEY]: r.geometry } }
        } else {
          // 一般軌道：寬度由被拖的那一面決定，所以它一定放第一個
          const r = buildRectFromEndSegments(want, other)
          if (r) built = { box: r.box, patch: null, rotationDeg: r.rotationDeg }
        }
      }
      if (!built) return

      onDragSessionStart?.()
      if (built.patch) onPatchFacilityParameters(area.id, facilityId, built.patch)
      if (built.rotationDeg !== undefined) {
        // 只有相對旋轉的介面，所以自己算差值
        const delta = built.rotationDeg - (f.rotation ?? 0)
        if (Math.abs(delta) > 0.01) onRotateDelta(area.id, facilityId, delta)
      }
      onResizeFacility(area.id, facilityId, { w: built.box.w, h: built.box.h })
      onDragFacility(area.id, facilityId, {
        areaPosition: {
          x: built.box.x,
          y: displayLayout.hPx - built.box.y - built.box.h,
        },
        position: areaLocalPxToMeter(
          built.box.x,
          displayLayout.hPx - built.box.y - built.box.h,
          displayDomain,
          displayLayout,
        ),
      })
    },
    [
      area.id,
      area.facilities,
      clientToAreaLocal,
      displayDomain,
      displayLayout,
      onDragFacility,
      onDragSessionStart,
      onPatchFacilityParameters,
      onResizeFacility,
      onRotateDelta,
      trackFacesLocal,
    ],
  )

  const handleInnerDrop = useCallback(
    (e: React.DragEvent) => {
      if (!editMode || !onPaletteDrop || !innerRef.current) return
      e.preventDefault()
      e.stopPropagation()
      const raw = e.dataTransfer.getData(PALETTE_DRAG_MIME)
      const item = decodePaletteDragItem(raw)
      if (!item || isAreaPaletteItem(item)) return
      const rect = innerRef.current.getBoundingClientRect()
      const scale = Math.max(0.01, mapScale)
      const localX = (e.clientX - rect.left) / scale
      const localY = (e.clientY - rect.top) / scale
      onPaletteDrop(area.id, item, { x: localX, y: localY })
    },
    [editMode, onPaletteDrop, area.id, displayDomain, displayLayout, mapScale],
  )

  const onAreaDragTrackPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!canEditLayout || !selected || e.button !== 0) return
      onLayoutPointerDown(e, 'move')
    },
    [canEditLayout, selected, onLayoutPointerDown],
  )

  const onAreaResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, edge: AreaResizeEdge) => {
      if (!canEditLayout || !selected || e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      onLayoutPointerDown(e, 'resize', edge)
    },
    [canEditLayout, selected, onLayoutPointerDown],
  )

  const onInnerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      const t = e.target as HTMLElement
      if (!editMode) {
        if (
          t.closest('[data-facility-root]:not([data-geofence-root])') ||
          t.closest('[data-facility]:not([data-geofence])')
        ) {
          return
        }
        const hitFacilityId = pickFacilityAtClient(e.clientX, e.clientY)
        if (hitFacilityId) {
          e.stopPropagation()
          selectFacilityInViewMode(hitFacilityId, e.shiftKey)
        }
        return
      }
      if (
        t.closest('[data-facility-root]') ||
        t.closest('[data-facility]') ||
        t.closest('[data-geofence]') ||
        t.closest('[data-geofence-label]') ||
        t.closest('[data-geofence-handle]') ||
        t.closest('[data-geofence-edge-add]') ||
        t.closest('[data-geofence-scale-handle]')
      ) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      clearMarqueeWindowListeners()

      const local = clientToInnerLocal(e.clientX, e.clientY)
      const edge = hitAreaLayoutEdge(
        local.x,
        local.y,
        displayLayout.wPx,
        displayLayout.hPx,
      )
      if (edge && canEditLayout && selected) {
        onLayoutPointerDown(e, 'resize', edge)
        return
      }

      const shiftKey = e.shiftKey
      marqueePendingRef.current = {
        startX: local.x,
        startY: local.y,
        shiftKey,
      }
      marqueeActiveRef.current = false
      setMarqueeRect(null)

      const onWindowMove = (ev: PointerEvent) => {
        const pending = marqueePendingRef.current
        if (!pending) return
        const cur = clientToInnerLocal(ev.clientX, ev.clientY)
        const dx = cur.x - pending.startX
        const dy = cur.y - pending.startY
        if (!marqueeActiveRef.current) {
          if (dx * dx + dy * dy < MARQUEE_START_PX * MARQUEE_START_PX) return
          marqueeActiveRef.current = true
        }
        setMarqueeRect({
          x: pending.startX,
          y: pending.startY,
          w: dx,
          h: dy,
        })
      }

      const onWindowUp = (ev: PointerEvent) => {
        clearMarqueeWindowListeners()
        const pending = marqueePendingRef.current
        if (!pending) return
        const wasActive = marqueeActiveRef.current
        marqueePendingRef.current = null
        marqueeActiveRef.current = false
        setMarqueeRect(null)

        if (!editMode) return

        if (wasActive && onSelectFacilities) {
          const cur = clientToInnerLocal(ev.clientX, ev.clientY)
          const rect: MarqueeRect = {
            x: pending.startX,
            y: pending.startY,
            w: cur.x - pending.startX,
            h: cur.y - pending.startY,
          }
          const ids = facilityIdsInMarqueeRect(
            area.facilities,
            rect,
            displayDomain,
            committedLayout,
            domainSpan,
          )
          onSelectFacilities(area.id, ids, { additive: pending.shiftKey })
          return
        }

        if (formatPaintSnapshot) {
          onCancelFormatPaint?.()
        }
        onEmptyMapPointerDown?.()
        onSelectArea(area.id)
        onSelectFacility(area.id, null)
      }

      window.addEventListener('pointermove', onWindowMove)
      window.addEventListener('pointerup', onWindowUp)
      window.addEventListener('pointercancel', onWindowUp)
      marqueeWindowCleanupRef.current = () => {
        window.removeEventListener('pointermove', onWindowMove)
        window.removeEventListener('pointerup', onWindowUp)
        window.removeEventListener('pointercancel', onWindowUp)
      }
    },
    [
      editMode,
      clientToInnerLocal,
      clearMarqueeWindowListeners,
      canEditLayout,
      displayLayout.wPx,
      displayLayout.hPx,
      onLayoutPointerDown,
      onSelectArea,
      onSelectFacilities,
      area.facilities,
      area.id,
      domain,
      displayLayout,
      domainSpan,
      onSelectArea,
      onSelectFacility,
      formatPaintSnapshot,
      onCancelFormatPaint,
      onEmptyMapPointerDown,
      pickFacilityAtClient,
      selectFacilityInViewMode,
    ],
  )

  const outerCursor = canEditLayout
    ? hoverEdge
      ? cursorForAreaEdge(hoverEdge)
      : undefined
    : undefined

  const facilitySnapRect = useCallback(
    (fac: FacilityObject): SnapRect => {
      const rect = resolveFacilitySnapRectCss(
        fac,
        displayDomain,
        committedLayout,
        domainSpan,
      )
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }
    },
    [displayDomain, committedLayout, domainSpan],
  )

  const crossAreaPeerSnapRects = useMemo(
    () =>
      allAreas && allAreas.length > 1
        ? buildCrossAreaPeerSnapRects(allAreas, area.id)
        : [],
    [allAreas, area.id],
  )

  const peerSnapRectsFor = useCallback(
    (excludeId: string): SnapRect[] => {
      const sameArea = area.facilities
        .filter((other) => other.id !== excludeId)
        .map(facilitySnapRect)
      return [...sameArea, ...crossAreaPeerSnapRects]
    },
    [area.facilities, facilitySnapRect, crossAreaPeerSnapRects],
  )

  const renderFacility = (
    f: FacilityObject,
    orderIndex: number,
    opts?: { roadLineLayer?: boolean; basemapLayer?: boolean },
  ) => {
    const mqttLive = liveById?.[getMqttEntityId(f)]
    const isSelected = selectedFacilityIds.includes(f.id)
    const z = resolveFacilityStackZ(f, orderIndex, isSelected, opts)
    const preview =
      slotPreview && slotPreview.facilityId === f.id ? slotPreview : null

    if (f.type === 'Geofence') {
      const resizeDrag = layoutDragRef.current
      const isAreaResizePreview =
        liveLayout != null && resizeDrag?.kind === 'resize'
      const geofenceFreeze =
        isAreaResizePreview && resizeDrag
          ? areaLayoutResizeMapFreezeOffset(resizeDrag.layout, liveLayout)
          : { left: 0, top: 0 }
      return (
        <div
          key={f.id}
          data-facility-root
          data-geofence-root
          className="pointer-events-none absolute"
          style={{
            left: geofenceFreeze.left,
            top: geofenceFreeze.top,
            width: isAreaResizePreview ? committedLayout.wPx : displayLayout.wPx,
            height: isAreaResizePreview ? committedLayout.hPx : displayLayout.hPx,
            zIndex: z,
          }}
        >
          <GeofenceNode
            facility={f as GeofenceFacility}
            selected={isSelected}
            selectedLabelId={isSelected ? geofenceSelectedLabelId : null}
            readOnly={readOnly || !editMode}
            scaleX={pxPerMeterX}
            scaleY={pxPerMeterY}
            stackZIndex={z}
            meterMode
            mapScale={mapScale}
            areaMeterContext={areaMeterContext}
            worldRef={innerRef as RefObject<HTMLDivElement>}
            onSelect={() => onSelectFacility(area.id, f.id)}
            onSelectLabel={(_fid, labelId) =>
              onSelectGeofenceLabel(area.id, f.id, labelId)
            }
            onUpdateGeofence={
              onUpdateGeofence
                ? (_id, update) => onUpdateGeofence(area.id, f.id, update)
                : undefined
            }
            onGeofenceEditStart={onGeofenceEditStart}
            onDelete={
              onDeleteFacility && editMode
                ? () => onDeleteFacility(area.id, f.id)
                : undefined
            }
            formatPaintSnapshot={formatPaintSnapshot}
            onStartFormatPaint={
              editMode && onStartFormatPaint
                ? () =>
                    onStartFormatPaint(
                      extractFacilityFormat(
                        f,
                        displayDomain,
                        committedLayout,
                        domainSpan,
                      ),
                    )
                : undefined
            }
            onFormatPaintPick={
              onFormatPaintTarget
                ? () => onFormatPaintTarget(area.id, f.id)
                : undefined
            }
            onCancelFormatPaint={onCancelFormatPaint}
            showFacilityToolbar={showFacilityToolbars}
          />
        </div>
      )
    }

    if (f.type === 'TrackCrossover') {
      const resizeDrag = layoutDragRef.current
      const isAreaResizePreview =
        liveLayout != null && resizeDrag?.kind === 'resize'
      const freeze =
        isAreaResizePreview && resizeDrag
          ? areaLayoutResizeMapFreezeOffset(resizeDrag.layout, liveLayout)
          : { left: 0, top: 0 }
      return (
        <div
          key={f.id}
          data-facility-root
          data-track-crossover-root
          className="pointer-events-none absolute overflow-visible"
          style={{
            left: freeze.left,
            top: freeze.top,
            width: isAreaResizePreview ? committedLayout.wPx : displayLayout.wPx,
            height: isAreaResizePreview ? committedLayout.hPx : displayLayout.hPx,
            zIndex: z,
          }}
          onPointerDown={(e) => {
            if (editMode || e.button !== 0) return
            // 命中由線徑端點／線身處理；此處僅擋冒泡到 Area
            if (!(e.target as HTMLElement).closest('[data-crossover-portal-handle], line, circle')) {
              return
            }
            e.stopPropagation()
            selectFacilityInViewMode(f.id, e.shiftKey)
          }}
        >
          <FacilityNode
            facility={f}
            displayPosition={{ x: 0, y: 0 }}
            areaAnchorPx={{ x: freeze.left, y: freeze.top }}
            mqttLive={mqttLive}
            slotPreview={preview}
            selected={isSelected}
            scaleX={pxPerMeterX}
            scaleY={pxPerMeterY}
            mapScale={mapScale}
            meterMode
            domainBoundsM={displayDomain}
            areaMeterContext={areaMeterContext}
            mapViewportRef={mapViewportRef}
            readOnly={readOnly || !editMode}
            worldRef={innerRef as RefObject<HTMLDivElement>}
            onSelect={(id, options) => onSelectFacility(area.id, id, options)}
            onOpenProperties={
              onFacilityDoubleClick
                ? () => onFacilityDoubleClick(area.id, f.id)
                : undefined
            }
            onDrag={(_id, update) => {
              if (!('areaPosition' in update)) return
              setDragLiveAreaPos(update.areaPosition)
              onDragFacility(area.id, f.id, update)
            }}
            onDragSessionStart={onDragSessionStart}
            peerSnapRects={[]}
            onFacilityResizeActiveChange={undefined}
            onHoverChange={
              editMode && onFacilityHover
                ? (hovered) => onFacilityHover(area.id, f.id, hovered)
                : undefined
            }
            onFacilityDragActiveChange={(active) => {
              setDraggingFacilityId(active ? f.id : null)
              if (!active) {
                setDragStartPositions(null)
                setDragLiveAreaPos(null)
                setDragAlignGuides(null)
              }
            }}
            onResize={
              onResizeFacility
                ? (_id, size) => onResizeFacility(area.id, f.id, size)
                : undefined
            }
            onPatchParameters={
              onPatchFacilityParameters
                ? (_id, patch) => onPatchFacilityParameters(area.id, f.id, patch)
                : undefined
            }
            onRotateLeft90={() => onRotateLeft90(area.id, f.id)}
            onRotateRight90={() => onRotateRight90(area.id, f.id)}
            onRotateDelta={(_id, deg) => onRotateDelta(area.id, f.id, deg)}
            onDelete={
              onDeleteFacility && editMode
                ? () => onDeleteFacility(area.id, f.id)
                : undefined
            }
            stackZIndex={z}
            showFacilityToolbar={showFacilityToolbars}
            crossoverSegmentById={crossoverSegmentById}
            onCrossoverSnapUiChange={onCrossoverSnapUiChange}
          />
        </div>
      )
    }

    const resizeDrag = layoutDragRef.current
    const isAreaResizePreview =
      liveLayout != null && resizeDrag?.kind === 'resize'
    const placement = isAreaResizePreview
      ? resolveFacilityRenderPlacementDuringAreaResize(
          f,
          displayDomain,
          resizeDrag.layout,
          liveLayout,
          domainSpan,
        )
      : resolveFacilityRenderPlacement(
          f,
          displayDomain,
          committedLayout,
          domainSpan,
        )
    const baseCss = placement.css
    let displayCss = baseCss

    if (dragStartPositions && dragLiveAreaPos && draggingFacilityId) {
      const startDragPos = dragStartPositions[draggingFacilityId]
      const startFacPos = dragStartPositions[f.id]
      if (startDragPos && startFacPos) {
        const dx = dragLiveAreaPos.x - startDragPos.x
        const dy = dragLiveAreaPos.y - startDragPos.y
        const livePos = {
          x: startFacPos.x + dx,
          y: startFacPos.y + dy,
        }
        displayCss = resolveFacilityRenderPlacement(
          { ...f, areaPosition: livePos },
          displayDomain,
          committedLayout,
          domainSpan,
        ).css
      }
    } else if (
      mqttLive?.positionMeters &&
      isMeterInDomain(
        mqttLive.positionMeters.x,
        mqttLive.positionMeters.y,
        displayDomain,
      )
    ) {
      displayCss = resolveFacilityRenderPlacement(
        {
          ...f,
          areaPosition: meterToAreaLocalPx(
            mqttLive.positionMeters.x,
            mqttLive.positionMeters.y,
            displayDomain,
            committedLayout,
          ),
        },
        displayDomain,
        committedLayout,
        domainSpan,
      ).css
    }

    const areaSize = placement.areaSize

    return (
      <div
        key={f.id}
        data-facility-root
        className={`pointer-events-auto absolute overflow-visible`}
        style={{
          left: displayCss.left,
          top: displayCss.top,
          width: areaSize.w,
          height: areaSize.h,
          zIndex: z,
        }}
        onPointerDown={(e) => {
          if (editMode || e.button !== 0) return
          e.stopPropagation()
          selectFacilityInViewMode(f.id, e.shiftKey)
        }}
      >
        <FacilityNode
          facility={f}
          displayPosition={{ x: 0, y: 0 }}
          areaAnchorPx={{ x: displayCss.left, y: displayCss.top }}
          mqttLive={mqttLive}
          slotPreview={preview}
          selected={isSelected}
          scaleX={pxPerMeterX}
          scaleY={pxPerMeterY}
          mapScale={mapScale}
          meterMode
          domainBoundsM={displayDomain}
          areaMeterContext={areaMeterContext}
          mapViewportRef={mapViewportRef}
          readOnly={readOnly || !editMode}
          worldRef={innerRef as RefObject<HTMLDivElement>}
          onSelect={(id, options) => onSelectFacility(area.id, id, options)}
          onOpenProperties={
            onFacilityDoubleClick
              ? () => onFacilityDoubleClick(area.id, f.id)
              : undefined
          }
          onDrag={(_id, update) => {
            if (!('areaPosition' in update)) return
            setDragLiveAreaPos(update.areaPosition)
            onDragFacility(area.id, f.id, update)
          }}
          onDragSessionStart={onDragSessionStart}
          peerSnapRects={editMode ? peerSnapRectsFor(f.id) : []}
          onAlignGuidesChange={
            editMode ? (guides) => setDragAlignGuides(guides) : undefined
          }
          onFacilityResizeActiveChange={
            editMode
              ? (active) => {
                  if (active) {
                    setResizingFacilityId(f.id)
                    setDragLiveAreaPos({
                      x: f.areaPosition.x,
                      y: f.areaPosition.y,
                    })
                  } else {
                    setResizingFacilityId(null)
                    setDragAlignGuides(null)
                    setDragLiveAreaPos((pos) =>
                      draggingFacilityId ? pos : null,
                    )
                  }
                }
              : undefined
          }
          onHoverChange={
            editMode && onFacilityHover
              ? (hovered) => onFacilityHover(area.id, f.id, hovered)
              : undefined
          }
          onFacilityDragActiveChange={(active) => {
            setDraggingFacilityId(active ? f.id : null)
            if (active) {
              const starts: Record<string, { x: number; y: number }> = {}
              for (const id of selectedFacilityIds) {
                const fac = area.facilities.find((x) => x.id === id)
                if (fac) {
                  starts[id] = { x: fac.areaPosition.x, y: fac.areaPosition.y }
                }
              }
              setDragStartPositions(starts)
            } else {
              setDragLiveAreaPos(null)
              setDragAlignGuides(null)
              setDragStartPositions(null)
            }
          }}
          onResize={
            onResizeFacility
              ? (_id, size) => onResizeFacility(area.id, f.id, size)
              : undefined
          }
          onResizeSessionStart={onResizeSessionStart}
          onPatchParameters={
            onPatchFacilityParameters
              ? (_id, patch) => onPatchFacilityParameters(area.id, f.id, patch)
              : undefined
          }
          onRotateLeft90={() => onRotateLeft90(area.id, f.id)}
          onRotateRight90={() => onRotateRight90(area.id, f.id)}
          onRotateDelta={(_id, deg) => onRotateDelta(area.id, f.id, deg)}
          onTrackCornerEditStart={onTrackCornerEditStart}
          onTrackEndProbe={editMode ? onTrackEndProbe : undefined}
          onTrackEndCommit={editMode ? onTrackEndCommit : undefined}
          onDelete={
            onDeleteFacility && editMode
              ? () => onDeleteFacility(area.id, f.id)
              : undefined
          }
          formatPaintSnapshot={formatPaintSnapshot}
          onStartFormatPaint={
            editMode && onStartFormatPaint
              ? () =>
                  onStartFormatPaint(
                    extractFacilityFormat(
                      f,
                      displayDomain,
                      committedLayout,
                      domainSpan,
                    ),
                  )
              : undefined
          }
          onFormatPaintPick={
            onFormatPaintTarget
              ? () => onFormatPaintTarget(area.id, f.id)
              : undefined
          }
          onCancelFormatPaint={onCancelFormatPaint}
          stackZIndex={
            connectivityScanHighlightTrackIds?.includes(f.id) ||
            crossoverSnapUi?.nearbyTrackIds.includes(f.id)
              ? Math.max(z, 9000)
              : z
          }
          showFacilityToolbar={showFacilityToolbars}
          connectivityScanHighlight={connectivityScanHighlightTrackIds?.includes(f.id) ?? false}
          crossoverSnapHighlight={
            crossoverSnapUi?.nearbyTrackIds.includes(f.id) ?? false
          }
          crossoverSnapPrimary={
            crossoverSnapUi?.hooks.some((h) => h.trackId === f.id) ?? false
          }
          crossoverSegmentById={crossoverSegmentById}
        />
      </div>
    )
  }

  const transformFacilityId = draggingFacilityId ?? resizingFacilityId

  const draggingRect =
    transformFacilityId && dragLiveAreaPos
      ? (() => {
          const target = area.facilities.find((f) => f.id === transformFacilityId)
          if (!target || target.type === 'TrackCrossover') return null
          const snap = resolveFacilitySnapRectCss(
            { ...target, areaPosition: dragLiveAreaPos },
            displayDomain,
            committedLayout,
            domainSpan,
          )
          return {
            left: snap.left,
            top: snap.top,
            width: snap.width,
            height: snap.height,
          }
        })()
      : null

  return (
    <div
      ref={outerRef}
      className={`absolute ${
        liveLayout || transformFacilityId ? 'overflow-hidden' : 'overflow-visible'
      }${viewModePointerPassthrough ? ' pointer-events-none' : ''}`}
      style={{
        left: displayLayout.xPx,
        top: displayLayout.yPx,
        width: displayLayout.wPx,
        height: displayLayout.hPx,
        zIndex: areaZIndex,
        backgroundColor: areaFill.backgroundColor,
        outline: selected ? '2px solid #22d3ee' : undefined,
        outlineOffset: selected ? 0 : undefined,
        border: `${areaBorder.borderWidthPx}px solid ${areaBorder.borderColor}`,
        boxSizing: 'border-box',
        cursor: outerCursor,
      }}
      onPointerDown={(e) => {
        const t = e.target as HTMLElement
        if (t.closest('[data-facility-root]:not([data-geofence-root])')) return
        if (t.closest('[data-facility]:not([data-geofence])')) return
        if (t.closest('[data-geofence]')) return
        e.stopPropagation()
        onEmptyMapPointerDown?.()
        if (!selected) {
          onSelectArea(area.id)
          onSelectFacility(area.id, null)
        }
        onOuterPointerDown(e)
      }}
      onPointerMove={(e) => {
        updateHoverEdge(e)
        onLayoutPointerMove(e)
      }}
      onPointerUp={onLayoutPointerUp}
      onPointerCancel={onLayoutPointerUp}
      onPointerLeave={clearHoverEdge}
      data-area-id={area.id}
    >
      {canEditLayout && selected && (
        <AreaDragTrack
          wPx={displayLayout.wPx}
          hPx={displayLayout.hPx}
          active={selected}
          onMovePointerDown={onAreaDragTrackPointerDown}
          onResizePointerDown={onAreaResizePointerDown}
        />
      )}
      <div
        ref={innerRef}
        className={`relative h-full w-full overflow-visible${
          viewModePointerPassthrough ? ' pointer-events-none' : ''
        }`}
        style={{
          position: 'relative',
          ...(hasSelectedFacility
            ? { zIndex: AREA_INNER_ELEVATED_Z }
            : {}),
        }}
        onDragOver={(e) => {
          if (editMode && onPaletteDrop) e.preventDefault()
        }}
        onDrop={handleInnerDrop}
        onPointerDown={onInnerPointerDown}
      >
        {area.showRuler && (
          <AreaRulerOverlay
            domain={displayDomain}
            layout={displayLayout}
            mapScale={mapScale}
            showMoveHint={false}
          />
        )}
        {listBasemapsForPaint(area.facilities).length > 0 ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{ zIndex: BASEMAP_LAYER_Z }}
          >
            {listBasemapsForPaint(area.facilities).map((f, orderIndex) =>
              renderFacility(f, orderIndex, { basemapLayer: true }),
            )}
          </div>
        ) : null}
        {sortFacilitiesForPaint(
          area.facilities.filter((f) => f.type !== 'Geofence'),
        ).map((f, orderIndex) => renderFacility(f, orderIndex))}
        {listRoadLinesForPaint(area.facilities).length > 0 ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{ zIndex: ROAD_LINE_LAYER_Z }}
          >
            {listRoadLinesForPaint(area.facilities).map((f, orderIndex) =>
              renderFacility(f, orderIndex, { roadLineLayer: true }),
            )}
          </div>
        ) : null}
        {area.facilities
          .filter((f) => f.type === 'Geofence')
          .map((f, idx) =>
            renderFacility(
              f,
              area.facilities.filter((x) => x.type !== 'Geofence').length + idx,
            ),
          )}
        {/*
          * 端點拖到某條軌道上時，把那條框起來——使用者才知道放手會接到誰。
          */}
        {taperHighlight
          ? (() => {
              const t = area.facilities.find((x) => x.id === taperHighlight.targetId)
              if (!t) return null
              const pos = resolveFacilityAreaPosition(t, displayDomain, displayLayout)
              const size = resolveFacilityAreaSize(t, displayDomain, displayLayout)
              const e = taperHighlight.edge
              return (
                <>
                  {/* 先淡淡地標出是哪一塊 */}
                  <div
                    className="pointer-events-none absolute z-[94] rounded-[2px] border border-emerald-400/50 bg-emerald-400/10"
                    style={{
                      left: pos.x,
                      top: displayLayout.hPx - pos.y - size.h,
                      width: size.w,
                      height: size.h,
                      transform: `rotate(${t.rotation ?? 0}deg)`,
                    }}
                  />
                  {/* 真正會接上的是<strong>這一條邊</strong>，描粗才看得出來接哪一頭 */}
                  <svg
                    className="pointer-events-none absolute left-0 top-0 z-[96] overflow-visible"
                    width={1}
                    height={1}
                  >
                    <line
                      x1={e.x1}
                      y1={e.y1}
                      x2={e.x2}
                      y2={e.y2}
                      stroke="#34d399"
                      strokeWidth={5 / Math.max(0.01, mapScale)}
                      strokeLinecap="round"
                      opacity={0.95}
                    />
                    {[
                      [e.x1, e.y1],
                      [e.x2, e.y2],
                    ].map(([cx, cy], i) => (
                      <circle
                        key={i}
                        cx={cx}
                        cy={cy}
                        r={3.5 / Math.max(0.01, mapScale)}
                        fill="#ecfdf5"
                        stroke="#34d399"
                        strokeWidth={1.5 / Math.max(0.01, mapScale)}
                      />
                    ))}
                  </svg>
                </>
              )
            })()
          : null}
        <FacilityDragGuidesOverlay
          guides={dragAlignGuides ?? []}
          activeRect={draggingRect}
          bounds={{
            left: 0,
            top: 0,
            width: committedLayout.wPx,
            height: committedLayout.hPx,
          }}
        />
        {marqueeRect && (
          <div
            className="pointer-events-none absolute z-[5000] border border-cyan-400/80 bg-cyan-400/10"
            style={{
              left: Math.min(marqueeRect.x, marqueeRect.x + marqueeRect.w),
              top: Math.min(marqueeRect.y, marqueeRect.y + marqueeRect.h),
              width: Math.abs(marqueeRect.w),
              height: Math.abs(marqueeRect.h),
            }}
          />
        )}
        {crossoverSnapOverlayModel ? (
          <CrossoverSnapOverlay
            width={committedLayout.wPx}
            height={committedLayout.hPx}
            trackGlows={crossoverSnapOverlayModel.trackGlows}
            hooks={crossoverSnapOverlayModel.hooks}
          />
        ) : null}
        {showCenterLabel && (
          <div className="pointer-events-none absolute inset-0 z-[1400] grid place-items-center">
            <div className="max-w-[88%] rounded-xl border border-amber-300/70 bg-amber-950/65 px-4 py-3 text-center shadow-[0_0_20px_rgba(251,191,36,0.35)] backdrop-blur-sm">
              <div className="text-xl font-extrabold tracking-wide text-amber-100 sm:text-2xl">
                {area.customName.trim() || area.id}
              </div>
              <div className="mt-1 text-sm font-medium text-amber-200/95 sm:text-base">
                場域範圍：橫向 {displayDomain.xMinM.toFixed(1)} ~{' '}
                {displayDomain.xMaxM.toFixed(1)} m，縱向 {displayDomain.yMinM.toFixed(1)} ~{' '}
                {displayDomain.yMaxM.toFixed(1)} m
              </div>
              <div className="mt-1 text-sm font-medium text-amber-200/95 sm:text-base">
                像素尺寸：橫向 {Math.round(committedLayout.wPx)} px，縱向{' '}
                {Math.round(committedLayout.hPx)} px
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
