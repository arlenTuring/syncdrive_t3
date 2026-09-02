import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode, RefObject } from 'react'
import type { MqttLiveEntry } from '../live/mqttLiveTypes'
import type {
  MapAreaLayout,
  MapAreaObject,
  MapPixelOrigin,
  MapPixelSize,
} from '../types/area'
import { DEFAULT_MAP_PIXEL_ORIGIN } from '../types/area'
import type { MapBasemapLayout, MapBasemapObject } from '../types/basemap'
import type { TrackGenResult } from '../utils/trackGenerator'
import type { TrackGenBlockSize } from '../utils/trackGenFacility'
import type { PaletteItem } from '../constants/palette'
import type {
  SlotEquipmentState,
  SlotOccupancy,
} from '../types/facility'
import { decodePaletteDragItem, isAreaPaletteItem, isMapCanvasPaletteItem, PALETTE_DRAG_MIME } from '../utils/paletteDrag'
import { partitionMapBasemaps } from '../utils/basemapFacility'
import { BasemapNode } from './BasemapNode'
import {
  applyWheelToMapPixelZoomLevel,
  computeMapPixelZoomMultipliers,
  interpolateMapPixelZoomMultiplier,
  MAP_PIXEL_ZOOM_DEFAULT_LEVEL,
} from '../utils/mapPixelZoom'
import { MAP_EDITOR_VIEWPORT_PAN_GUTTER_PX } from '../constants/map'
import { isCanvasZoomWheelEvent } from '../utils/mapWheelZoom'
import type { FacilityFormatSnapshot } from '../utils/facilityFormatPainter'
import type { AreaVehicleLive, MapVehicleIconSpec } from '../vehicles/types'
import {
  DEFAULT_MAP_VEHICLE_DISPLAY_HEIGHT_PX,
  DEFAULT_MAP_VEHICLE_DISPLAY_WIDTH_PX,
} from '../vehicles/resolveMapVehicleTrackSizing'
import { MapAreaVehicleOverlay } from '../vehicles/MapAreaVehicleOverlay'
import { AreaNode } from './AreaNode'
import { MapCropModeOverlay } from './MapCropModeOverlay'
import { TrackConnectivityScanOverlay } from './TrackConnectivityScanOverlay'
import type { ConnectivityScanState } from '../hooks/useTrackConnectivityScan'
import type { MapCropRect, MapCropWorkspace } from '../utils/mapCropMode'

export type MapAreaCanvasDisplayMode = 'editor' | 'embedded'

type MapAreaCanvasProps = {
  pixelSize: MapPixelSize
  pixelOrigin?: MapPixelOrigin
  areas: MapAreaObject[]
  basemaps?: MapBasemapObject[]
  onApplyTrackGen?: (
    basemapId: string,
    result: TrackGenResult,
    block: TrackGenBlockSize,
  ) => void
  selectedAreaId: string | null
  selectedBasemapId?: string | null
  selectedFacilityIds: string[]
  geofenceSelectedLabelId?: string | null
  viewportRef: RefObject<HTMLDivElement | null>
  readOnly?: boolean
  editMode?: boolean
  /**
   * embedded：儀表板圖台容器 — 等比縮放至容器內完整顯示，不捲動、不滾輪縮放。
   * 容器與地圖 pixelSize 相同時為 1:1。
   */
  displayMode?: MapAreaCanvasDisplayMode
  /**
   * 滾輪縮放（僅非 embedded）：
   * - pinch：觸控板捏合／Ctrl+滾輪（預設）
   * - wheel：一般滾輪／觸控板捲動皆可縮放
   */
  wheelZoomMode?: 'pinch' | 'wheel'
  /** 即時車輛位置補間毫秒；連續播放給 1200，暫停／逐幀請給 0（瞬間定位）。未傳則依 isEmbedded 預設。 */
  livePositionTweenMs?: number
  /** 1 = 最放大，7 = 一屏看全圖；未傳則使用內建 state（預設 7） */
  zoomLevel?: number
  onZoomLevelChange?: (level: number) => void
  liveById?: Record<string, MqttLiveEntry>
  /** Area 內即時／示範車輛（儀表板圖台） */
  areaVehicles?: AreaVehicleLive[]
  vehicleIconSpec?: MapVehicleIconSpec
  /** 載具編輯器定義（圖台容器） */
  vehicleDefinition?: import('../../vehicle-editor/types').VehicleDefinition | null
  /** 載具橫向顯示尺寸（px，沿軌道） */
  vehicleDisplayWidthPx?: number
  /** 載具縱向顯示尺寸（px，垂直軌道） */
  vehicleDisplayHeightPx?: number
  /** stretch：填滿樣板框；contain：等比縮放 */
  vehicleFitMode?: 'contain' | 'stretch'
  /** 載具樣板作動行為設定 */
  vehicleBehavior?: import('../../dashboard/elements/MapVehicleBehaviorOverlay').MapVehicleBehaviorConfig
  /** 圖台車輛座標／heading 等除錯標籤 */
  showVehicleTelemetry?: boolean
  /** 儀表板編輯：載具顯示校準框（地圖像素座標，與載具同層） */
  vehicleEditSizer?: {
    targetKey: string
    onSizeChange: (width: number, height: number) => void
  } | null
  slotPreview?: {
    facilityId: string
    occupancy: SlotOccupancy
    equipment: SlotEquipmentState
  } | null
  onSelectArea: (areaId: string | null) => void
  onSelectBasemap?: (basemapId: string | null) => void
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
  onSelectGeofenceLabel?: (
    areaId: string,
    facilityId: string,
    labelId: string | null,
  ) => void
  /** 點選畫布／Area 空白（非設施）時：收合側欄抽屜等 */
  onEmptyMapPointerDown?: () => void
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
  onRotateLeft90?: (areaId: string, facilityId: string) => void
  onRotateRight90?: (areaId: string, facilityId: string) => void
  onRotateDelta?: (areaId: string, facilityId: string, deltaDeg: number) => void
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
  onPaletteDropArea?: (item: PaletteItem, mapPointPx: { x: number; y: number }) => void
  onPaletteDropBasemap?: (item: PaletteItem, mapPointPx: { x: number; y: number }) => void
  onPaletteDropFacility?: (
    areaId: string,
    item: PaletteItem,
    areaPositionCenter: { x: number; y: number },
  ) => void
  onPatchAreaLayout?: (areaId: string, layout: MapAreaLayout) => void
  onAreaLayoutSessionStart?: () => void
  onPatchBasemapLayout?: (basemapId: string, layout: MapBasemapLayout) => void
  onPatchBasemapParameters?: (
    basemapId: string,
    patch: Record<string, unknown>,
  ) => void
  onBasemapLayoutSessionStart?: () => void
  onBasemapBringToFront?: (basemapId: string) => void
  onBasemapSendToBack?: (basemapId: string) => void
  formatPaintSnapshot?: FacilityFormatSnapshot | null
  onStartFormatPaint?: (snapshot: FacilityFormatSnapshot) => void
  onFormatPaintTarget?: (areaId: string, facilityId: string) => void
  onCancelFormatPaint?: () => void
  onFacilityHover?: (
    areaId: string,
    facilityId: string,
    hovered: boolean,
  ) => void
  showAreaCenterLabels?: boolean
  /** 編輯模式：選取元件時顯示圓形工具列 */
  showFacilityToolbars?: boolean
  /** 裁減模式：較大工作區承載現有地圖，拖曳裁切框決定輸出解析度 */
  cropMode?: MapCropWorkspace | null
  onCropRectChange?: (rect: MapCropRect) => void
  /** 點選畫布空白後全選 Area，可整體拖曳平移 */
  allAreasSelected?: boolean
  onBulkAreasLayoutSessionStart?: () => void
  onBulkAreasLayoutMove?: (dx: number, dy: number) => void
  onBulkAreasLayoutCommit?: () => void
  /** 導通掃描狀態（雷射 overlay + 軌道高亮） */
  connectivityScan?: ConnectivityScanState | null
  /** 清單跳轉：地圖像素座標（含 origin） */
  facilityFocusTarget?: { x: number; y: number; token: number } | null
  onFacilityDoubleClick?: (areaId: string, facilityId: string) => void
  onBasemapDoubleClick?: (basemapId: string) => void
  /** 路線製作預覽 overlay（地圖 content 像素座標） */
  routePlanningOverlay?: ReactNode
}

export function MapAreaCanvas({
  pixelSize,
  pixelOrigin = DEFAULT_MAP_PIXEL_ORIGIN,
  areas,
  basemaps = [],
  onApplyTrackGen,
  selectedAreaId,
  selectedBasemapId = null,
  selectedFacilityIds,
  geofenceSelectedLabelId = null,
  viewportRef,
  readOnly = false,
  editMode = false,
  displayMode = 'editor',
  wheelZoomMode = 'pinch',
  livePositionTweenMs: livePositionTweenMsProp,
  zoomLevel: zoomLevelProp,
  onZoomLevelChange: onZoomLevelChangeProp,
  liveById,
  areaVehicles,
  vehicleIconSpec,
  vehicleDefinition = null,
  vehicleDisplayWidthPx,
  vehicleDisplayHeightPx,
  vehicleFitMode = 'contain',
  vehicleBehavior,
  showVehicleTelemetry = true,
  vehicleEditSizer = null,
  slotPreview = null,
  onSelectArea,
  onSelectBasemap,
  onSelectFacility,
  onSelectFacilities,
  onSelectGeofenceLabel,
  onEmptyMapPointerDown,
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
  onPaletteDropArea,
  onPaletteDropBasemap,
  onPaletteDropFacility,
  onPatchAreaLayout,
  onAreaLayoutSessionStart,
  onPatchBasemapLayout,
  onPatchBasemapParameters,
  onBasemapLayoutSessionStart,
  onBasemapBringToFront,
  onBasemapSendToBack,
  formatPaintSnapshot = null,
  onStartFormatPaint,
  onFormatPaintTarget,
  onCancelFormatPaint,
  onFacilityHover,
  showAreaCenterLabels = false,
  showFacilityToolbars = true,
  cropMode = null,
  onCropRectChange,
  allAreasSelected = false,
  onBulkAreasLayoutSessionStart,
  onBulkAreasLayoutMove,
  onBulkAreasLayoutCommit,
  connectivityScan = null,
  facilityFocusTarget = null,
  onFacilityDoubleClick,
  onBasemapDoubleClick,
  routePlanningOverlay = null,
}: MapAreaCanvasProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapScaleRef = useRef(1)
  const BULK_MAP_DRAG_START_PX = 4
  const bulkMapDragRef = useRef<{ startX: number; startY: number } | null>(null)
  const bulkMapDragStartedRef = useRef(false)
  const bulkMapDragCleanupRef = useRef<(() => void) | null>(null)
  const zoomLevelRef = useRef<number>(MAP_PIXEL_ZOOM_DEFAULT_LEVEL)
  const [viewportSize, setViewportSize] = useState({ w: 800, h: 600 })
  const [internalZoomLevel, setInternalZoomLevel] = useState(
    MAP_PIXEL_ZOOM_DEFAULT_LEVEL,
  )
  const zoomLevel = zoomLevelProp ?? internalZoomLevel
  const onZoomLevelChange = onZoomLevelChangeProp ?? setInternalZoomLevel
  zoomLevelRef.current = zoomLevel
  const didInitPanScrollRef = useRef(false)

  useLayoutEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (!cr) return
      setViewportSize({ w: cr.width, h: cr.height })
    })
    ro.observe(vp)
    setViewportSize({ w: vp.clientWidth, h: vp.clientHeight })
    return () => ro.disconnect()
  }, [viewportRef])

  const layoutSize = cropMode?.workspace ?? pixelSize
  const inCropMode = !!cropMode

  const contentExtent = useMemo((): MapPixelSize => {
    if (inCropMode && cropMode) return cropMode.contentExtent
    return {
      width: pixelSize.width + pixelOrigin.x,
      height: pixelSize.height + pixelOrigin.y,
    }
  }, [inCropMode, cropMode, pixelSize, pixelOrigin])

  const contentOrigin = useMemo((): MapPixelOrigin => {
    if (inCropMode && cropMode) {
      return {
        x: cropMode.cropRect.x - cropMode.mapOffset.x,
        y: cropMode.cropRect.y - cropMode.mapOffset.y,
      }
    }
    return pixelOrigin
  }, [inCropMode, cropMode, pixelOrigin])

  const viewportSizePx = useMemo((): MapPixelSize => {
    if (inCropMode && cropMode) {
      return {
        width: cropMode.cropRect.width,
        height: cropMode.cropRect.height,
      }
    }
    return pixelSize
  }, [inCropMode, cropMode, pixelSize])

  const clipLeft = inCropMode && cropMode ? cropMode.cropRect.x : 0
  const clipTop = inCropMode && cropMode ? cropMode.cropRect.y : 0

  const isEmbedded = displayMode === 'embedded' && !inCropMode
  const panGutterPx = isEmbedded ? 0 : MAP_EDITOR_VIEWPORT_PAN_GUTTER_PX

  const fitScale = useMemo(() => {
    const vw = Math.max(32, viewportSize.w)
    const vh = Math.max(32, viewportSize.h)
    const raw = Math.min(vw / layoutSize.width, vh / layoutSize.height)
    return isEmbedded ? raw : raw * 0.98
  }, [viewportSize, layoutSize.width, layoutSize.height, isEmbedded])

  const zoomMultipliers = useMemo(
    () =>
      computeMapPixelZoomMultipliers(
        viewportSize.w,
        viewportSize.h,
        layoutSize.width,
        layoutSize.height,
      ),
    [viewportSize, layoutSize.width, layoutSize.height],
  )

  const zoomMultiplier = isEmbedded
    ? 1
    : interpolateMapPixelZoomMultiplier(zoomMultipliers, zoomLevel)
  const mapScale = fitScale * zoomMultiplier
  mapScaleRef.current = mapScale

  const { below: basemapsBelow, above: basemapsAbove } = useMemo(
    () => partitionMapBasemaps(basemaps),
    [basemaps],
  )

  const scaledW = layoutSize.width * mapScale
  const scaledH = layoutSize.height * mapScale
  const scrollSurfaceW = scaledW + panGutterPx * 2
  const scrollSurfaceH = scaledH + panGutterPx * 2
  const areaEditEnabled = editMode && !inCropMode

  useLayoutEffect(() => {
    if (isEmbedded || panGutterPx <= 0 || didInitPanScrollRef.current) return
    const vp = viewportRef.current
    if (!vp) return
    vp.scrollLeft = panGutterPx
    vp.scrollTop = panGutterPx
    didInitPanScrollRef.current = true
  }, [isEmbedded, panGutterPx, scaledW, scaledH, viewportRef])

  useEffect(() => {
    if (!connectivityScan) return
    const { phase, lasers, discoveringTrackId } = connectivityScan
    if (phase !== 'flashing' || !discoveringTrackId || lasers.length === 0 || isEmbedded) {
      return
    }
    const vp = viewportRef.current
    if (!vp) return

    const issueLaser =
      lasers.find((l) => l.discovering) ??
      lasers.find((l) => l.trackId === discoveringTrackId)
    if (!issueLaser) return

    const focusPx = issueLaser.laserPx
    const mapX = focusPx.x - contentOrigin.x + clipLeft
    const mapY = focusPx.y - contentOrigin.y + clipTop
    const targetLeft = mapX * mapScale + panGutterPx - vp.clientWidth / 2
    const targetTop = mapY * mapScale + panGutterPx - vp.clientHeight / 2
    const maxLeft = Math.max(0, scrollSurfaceW - vp.clientWidth)
    const maxTop = Math.max(0, scrollSurfaceH - vp.clientHeight)

    vp.scrollTo({
      left: Math.max(0, Math.min(targetLeft, maxLeft)),
      top: Math.max(0, Math.min(targetTop, maxTop)),
      behavior: 'smooth',
    })
  }, [
    connectivityScan,
    contentOrigin.x,
    contentOrigin.y,
    clipLeft,
    clipTop,
    mapScale,
    panGutterPx,
    scrollSurfaceW,
    scrollSurfaceH,
    isEmbedded,
    viewportRef,
  ])

  useEffect(() => {
    if (!facilityFocusTarget || isEmbedded) return
    const vp = viewportRef.current
    if (!vp) return
    const mapX = facilityFocusTarget.x - contentOrigin.x + clipLeft
    const mapY = facilityFocusTarget.y - contentOrigin.y + clipTop
    const targetLeft = mapX * mapScale + panGutterPx - vp.clientWidth / 2
    const targetTop = mapY * mapScale + panGutterPx - vp.clientHeight / 2
    const maxLeft = Math.max(0, scrollSurfaceW - vp.clientWidth)
    const maxTop = Math.max(0, scrollSurfaceH - vp.clientHeight)
    vp.scrollTo({
      left: Math.max(0, Math.min(targetLeft, maxLeft)),
      top: Math.max(0, Math.min(targetTop, maxTop)),
      behavior: 'smooth',
    })
  }, [
    facilityFocusTarget,
    contentOrigin.x,
    contentOrigin.y,
    clipLeft,
    clipTop,
    mapScale,
    panGutterPx,
    scrollSurfaceW,
    scrollSurfaceH,
    isEmbedded,
    viewportRef,
  ])

  useEffect(() => {
    if (!formatPaintSnapshot) return
    const prev = document.body.style.cursor
    document.body.style.cursor = 'copy'
    return () => {
      document.body.style.cursor = prev
    }
  }, [formatPaintSnapshot])

  const clientToMapPx = useCallback(
    (clientX: number, clientY: number) => {
      const el = mapRef.current
      if (!el) return { x: 0, y: 0 }
      const rect = el.getBoundingClientRect()
      return {
        x: (clientX - rect.left) / mapScale,
        y: (clientY - rect.top) / mapScale,
      }
    },
    [mapScale],
  )

  const handleMapDrop = useCallback(
    (e: React.DragEvent) => {
      if (!areaEditEnabled) return
      e.preventDefault()
      const raw = e.dataTransfer.getData(PALETTE_DRAG_MIME)
      const item = decodePaletteDragItem(raw)
      if (!item || !isMapCanvasPaletteItem(item)) return
      const pt = clientToMapPx(e.clientX, e.clientY)
      if (isAreaPaletteItem(item)) {
        onPaletteDropArea?.(item, pt)
      } else {
        /*
         * 底圖與軌道生成走同一條路：軌道生成元件就是掛了 componentKind 的底圖。
         *
         * 先前這裡只列了 Basemap，軌道生成通過了 isMapCanvasPaletteItem 卻沒有分支
         * 接它，拖進地圖等於什麼都沒發生——從元件庫「點一下新增」有另一條路徑，
         * 所以只有拖曳會沒反應。
         */
        onPaletteDropBasemap?.(item, pt)
      }
    },
    [areaEditEnabled, onPaletteDropArea, onPaletteDropBasemap, clientToMapPx],
  )

  const applyWheelZoom = useCallback(
    (clientX: number, clientY: number, deltaY: number) => {
      const vp = viewportRef.current
      if (!vp) return
      const currentLevel = zoomLevelRef.current
      const nextLevel = applyWheelToMapPixelZoomLevel(currentLevel, deltaY)
      if (Math.abs(nextLevel - currentLevel) < 1e-6) return

      const rect = vp.getBoundingClientRect()
      const oldScale = mapScaleRef.current
      const nextMul = interpolateMapPixelZoomMultiplier(zoomMultipliers, nextLevel)
      const newScale = fitScale * nextMul

      const offsetX = clientX - rect.left + vp.scrollLeft - panGutterPx
      const offsetY = clientY - rect.top + vp.scrollTop - panGutterPx
      const mapX = offsetX / oldScale
      const mapY = offsetY / oldScale

      zoomLevelRef.current = nextLevel
      onZoomLevelChange(nextLevel)

      requestAnimationFrame(() => {
        vp.scrollLeft = mapX * newScale + panGutterPx - (clientX - rect.left)
        vp.scrollTop = mapY * newScale + panGutterPx - (clientY - rect.top)
      })
    },
    [viewportRef, zoomMultipliers, fitScale, onZoomLevelChange, panGutterPx],
  )

  const clearBulkMapDrag = useCallback(
    (commit: boolean) => {
      const hadDrag = bulkMapDragStartedRef.current
      bulkMapDragCleanupRef.current?.()
      bulkMapDragCleanupRef.current = null
      bulkMapDragRef.current = null
      bulkMapDragStartedRef.current = false
      if (commit && hadDrag) onBulkAreasLayoutCommit?.()
    },
    [onBulkAreasLayoutCommit],
  )

  useEffect(() => () => clearBulkMapDrag(false), [clearBulkMapDrag])

  const onBulkMoveLayerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (
        !editMode ||
        !allAreasSelected ||
        !onBulkAreasLayoutMove ||
        e.button !== 0
      ) {
        return
      }
      e.stopPropagation()
      e.preventDefault()
      bulkMapDragRef.current = { startX: e.clientX, startY: e.clientY }
      bulkMapDragStartedRef.current = false
      const pointerId = e.pointerId
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        const drag = bulkMapDragRef.current
        if (!drag) return
        const dx = ev.clientX - drag.startX
        const dy = ev.clientY - drag.startY
        if (!bulkMapDragStartedRef.current) {
          if (dx * dx + dy * dy < BULK_MAP_DRAG_START_PX * BULK_MAP_DRAG_START_PX) {
            return
          }
          bulkMapDragStartedRef.current = true
          onBulkAreasLayoutSessionStart?.()
        }
        const scale = Math.max(0.01, mapScaleRef.current)
        onBulkAreasLayoutMove(dx / scale, dy / scale)
      }
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        clearBulkMapDrag(true)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      bulkMapDragCleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
    },
    [
      editMode,
      allAreasSelected,
      onBulkAreasLayoutMove,
      onBulkAreasLayoutSessionStart,
      clearBulkMapDrag,
    ],
  )

  useEffect(() => {
    if (isEmbedded) return
    const vp = viewportRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent) => {
      if (inCropMode) return
      const allow =
        wheelZoomMode === 'wheel' || isCanvasZoomWheelEvent(e)
      if (!allow) return
      e.preventDefault()
      applyWheelZoom(e.clientX, e.clientY, e.deltaY)
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [viewportRef, applyWheelZoom, inCropMode, isEmbedded, wheelZoomMode])

  return (
    <div
      ref={viewportRef}
      className={
        isEmbedded
          ? 'relative flex h-full w-full items-center justify-center overflow-hidden bg-zinc-950'
          : 'relative h-full w-full overflow-auto bg-zinc-950'
      }
      style={isEmbedded ? undefined : { scrollbarGutter: 'stable both-edges' }}
      onMouseDown={(e) => {
        if (inCropMode) return
        const t = e.target as HTMLElement
        // Portal 工具列掛在 body，但需避免被當成點擊畫布空白
        if (
          t.closest('[data-facility-toolbar]') ||
          t.closest('[data-geofence-toolbar]') ||
          t.closest('[data-basemap-toolbar]')
        ) {
          return
        }
        if (
          t.closest('[data-map-crop-edge]') ||
          t.closest('[data-map-crop-corner]') ||
          t.closest('[data-map-crop-overlay]')
        ) {
          return
        }
        if (
          !t.closest('[data-area-id]') &&
          !t.closest('[data-basemap-root]')
        ) {
          onEmptyMapPointerDown?.()
          onSelectArea(null)
          onSelectBasemap?.(null)
        }
      }}
    >
      <div
        className={isEmbedded ? 'relative shrink-0' : 'relative'}
        style={{
          width: scrollSurfaceW,
          height: scrollSurfaceH,
          ...(isEmbedded
            ? {}
            : { minWidth: scrollSurfaceW, minHeight: scrollSurfaceH }),
        }}
      >
        <div
          className="absolute"
          style={{
            left: panGutterPx,
            top: panGutterPx,
            width: scaledW,
            height: scaledH,
          }}
        >
        <div
          ref={mapRef}
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: layoutSize.width,
            height: layoutSize.height,
            transform: `scale(${mapScale})`,
            background: inCropMode ? '#0a0e16' : '#060a12',
          }}
          onDragOver={(e) => {
            if (
              areaEditEnabled &&
              (onPaletteDropArea || onPaletteDropBasemap)
            ) {
              e.preventDefault()
            }
          }}
          onDrop={handleMapDrop}
        >
          {inCropMode ? (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: `
                  linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
                `,
                backgroundSize: '40px 40px',
              }}
            />
          ) : null}
          <div
            className={
              inCropMode
                ? 'absolute overflow-hidden pointer-events-none [&_*]:!pointer-events-none'
                : 'absolute overflow-hidden'
            }
            style={{
              left: clipLeft,
              top: clipTop,
              width: viewportSizePx.width,
              height: viewportSizePx.height,
            }}
          >
            <div
              className="absolute left-0 top-0"
              style={{
                left: -contentOrigin.x,
                top: -contentOrigin.y,
                width: contentExtent.width,
                height: contentExtent.height,
              }}
            >
            {areaEditEnabled && allAreasSelected && onBulkAreasLayoutMove ? (
              <div
                data-map-bulk-move-layer
                className="absolute inset-0 z-[1] cursor-move"
                title="拖曳以移動所有 Area"
                onPointerDown={onBulkMoveLayerPointerDown}
              />
            ) : null}
            {basemapsBelow.map((basemap, stackOrder) => (
              <BasemapNode
                onApplyTrackGen={onApplyTrackGen}
                key={basemap.id}
                basemap={basemap}
                stackOrder={stackOrder}
                stackCount={basemapsBelow.length}
                selected={selectedBasemapId === basemap.id}
                readOnly={readOnly || inCropMode}
                editMode={areaEditEnabled}
                mapScale={mapScale}
                showToolbar={showFacilityToolbars}
                onSelect={(id) => onSelectBasemap?.(id)}
                onPatchLayout={
                  onPatchBasemapLayout ??
                  (() => {
                    /* noop */
                  })
                }
                onPatchParameters={
                  onPatchBasemapParameters ??
                  (() => {
                    /* noop */
                  })
                }
                onLayoutSessionStart={onBasemapLayoutSessionStart}
                onBringToFront={onBasemapBringToFront}
                onSendToBack={onBasemapSendToBack}
                onDoubleClick={onBasemapDoubleClick}
              />
            ))}
            {areas.map((area, areaStackOrder) => (
              <AreaNode
                key={area.id}
                areaStackOrder={areaStackOrder}
                area={area}
                selected={allAreasSelected || selectedAreaId === area.id}
                selectedFacilityIds={
                  allAreasSelected || selectedAreaId === area.id
                    ? selectedFacilityIds
                    : []
                }
                geofenceSelectedLabelId={
                  allAreasSelected || selectedAreaId === area.id
                    ? geofenceSelectedLabelId
                    : null
                }
                readOnly={readOnly || inCropMode}
                editMode={areaEditEnabled}
                liveById={liveById}
                slotPreview={slotPreview}
                onSelectArea={(id) => onSelectArea(id)}
                onSelectFacility={onSelectFacility}
                onSelectFacilities={onSelectFacilities}
                onEmptyMapPointerDown={onEmptyMapPointerDown}
                onSelectGeofenceLabel={
                  onSelectGeofenceLabel ??
                  ((_a, _f, _l) => {
                    /* noop */
                  })
                }
                onDragFacility={onDragFacility}
                onDragSessionStart={onDragSessionStart}
                onResizeFacility={onResizeFacility}
                onResizeSessionStart={onResizeSessionStart}
                onPatchFacilityParameters={onPatchFacilityParameters}
                onRotateLeft90={onRotateLeft90 ?? (() => {})}
                onRotateRight90={onRotateRight90 ?? (() => {})}
                onRotateDelta={onRotateDelta ?? (() => {})}
                onTrackCornerEditStart={onTrackCornerEditStart}
                onDeleteFacility={onDeleteFacility}
                onUpdateGeofence={onUpdateGeofence}
                onGeofenceEditStart={onGeofenceEditStart}
                onPaletteDrop={onPaletteDropFacility}
                mapScale={mapScale}
                mapViewportRef={viewportRef}
                mapPixelSize={pixelSize}
                onPatchAreaLayout={onPatchAreaLayout}
                onAreaLayoutSessionStart={onAreaLayoutSessionStart}
                allAreasSelected={allAreasSelected}
                onBulkAreasLayoutSessionStart={onBulkAreasLayoutSessionStart}
                onBulkAreasLayoutMove={onBulkAreasLayoutMove}
                onBulkAreasLayoutCommit={onBulkAreasLayoutCommit}
                formatPaintSnapshot={formatPaintSnapshot}
                onStartFormatPaint={onStartFormatPaint}
                onFormatPaintTarget={onFormatPaintTarget}
                onCancelFormatPaint={onCancelFormatPaint}
                onFacilityHover={onFacilityHover}
                onFacilityDoubleClick={onFacilityDoubleClick}
                showCenterLabel={showAreaCenterLabels}
                showFacilityToolbars={showFacilityToolbars}
                allAreas={areas}
                connectivityScanHighlightTrackIds={connectivityScan?.highlightTrackIds ?? null}
              />
            ))}
            {basemapsAbove.map((basemap, stackOrder) => (
              <BasemapNode
                onApplyTrackGen={onApplyTrackGen}
                key={basemap.id}
                basemap={basemap}
                stackOrder={stackOrder}
                stackCount={basemapsAbove.length}
                selected={selectedBasemapId === basemap.id}
                readOnly={readOnly || inCropMode}
                editMode={areaEditEnabled}
                mapScale={mapScale}
                showToolbar={showFacilityToolbars}
                onSelect={(id) => onSelectBasemap?.(id)}
                onPatchLayout={
                  onPatchBasemapLayout ??
                  (() => {
                    /* noop */
                  })
                }
                onPatchParameters={
                  onPatchBasemapParameters ??
                  (() => {
                    /* noop */
                  })
                }
                onLayoutSessionStart={onBasemapLayoutSessionStart}
                onBringToFront={onBasemapBringToFront}
                onSendToBack={onBasemapSendToBack}
                onDoubleClick={onBasemapDoubleClick}
              />
            ))}
            {connectivityScan &&
            (connectivityScan.phase === 'scanning' ||
              connectivityScan.phase === 'flashing') ? (
              <TrackConnectivityScanOverlay scanState={connectivityScan} />
            ) : null}
            {routePlanningOverlay}
            {areaVehicles && areaVehicles.length > 0 ? (
              <MapAreaVehicleOverlay
                areas={areas}
                vehicles={areaVehicles}
                iconSpec={vehicleIconSpec}
                showLabels={showVehicleTelemetry}
                showMqttCoords={showVehicleTelemetry}
                showAnchorDebug={showVehicleTelemetry}
                vehicleDefinition={vehicleDefinition}
                vehicleDisplayWidthPx={vehicleDisplayWidthPx ?? DEFAULT_MAP_VEHICLE_DISPLAY_WIDTH_PX}
                vehicleDisplayHeightPx={vehicleDisplayHeightPx ?? DEFAULT_MAP_VEHICLE_DISPLAY_HEIGHT_PX}
                vehicleFitMode={vehicleFitMode}
                vehicleBehavior={vehicleBehavior}
                vehicleEditSizer={vehicleEditSizer}
                livePositionTweenMs={livePositionTweenMsProp ?? (isEmbedded ? 1200 : 0)}
              />
            ) : null}
            </div>
          </div>
          {inCropMode && cropMode && onCropRectChange ? (
            <MapCropModeOverlay
              workspace={cropMode.workspace}
              mapOffset={cropMode.mapOffset}
              contentExtent={cropMode.contentExtent}
              cropRect={cropMode.cropRect}
              mapScale={mapScale}
              onCropRectChange={onCropRectChange}
            />
          ) : null}
        </div>
        </div>
      </div>
    </div>
  )
}
