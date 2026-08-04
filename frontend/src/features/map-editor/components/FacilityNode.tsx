import {
  Paintbrush,
  RotateCcw,
  RotateCw,
  RotateCwSquare,
  Trash2,
} from 'lucide-react'
import type { RefObject } from 'react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { MqttLiveEntry } from '../live/mqttLiveTypes'
import type {
  FacilityObject,
  SlotEquipmentState,
  SlotOccupancy,
} from '../types/facility'
import {
  clampSizeMeters,
  facilityNodeWorldSize,
  getFacilitySizeMeters,
  MIN_FACILITY_SIZE_M,
} from '../constants/facilityDimensions'
import {
  metersToWorldPx,
  worldPxToMeters,
} from '../constants/map'
import { useMapExtent } from '../context/MapExtentContext'
import { clamp } from '../utils/dom'
import {
  labelPlacementFromSignalMount,
  resolveSignalDisplay,
} from '../utils/signalFacility'
import {
  resolveDockingPointIconUrl,
  resolveDockingPointMapLabel,
} from '../utils/dockingPointFacility'
import {
  alongToFacilityDockingPoint,
  facilityDockingPointToAlong,
  getFacilityDockingPoint,
  type FacilityDockingPoint,
} from '../utils/facilityDockingPoint'
import { getValidRefFieldBounds } from '../utils/facilityRefFieldBounds'
import { FacilityDraggableLabel } from './FacilityDraggableLabel'
import { FacilityIconLabelLayout } from './FacilityIconLabelLayout'
import { PlatformDoorGraphic } from './PlatformDoorGraphic'
import { resolvePsdDisplay } from '../utils/psdOpenPercent'
import { PALETTE_ICON_BY_NAME } from '../utils/facilityIcons'
import { FACILITY_BACKGROUND_BY_NAME } from '../constants/facilityImages'
import { facilityHitPadMeters, facilityHitPadWorld } from '../utils/facilityHitTest'
import {
  getFacilityLabelStyle,
  labelStyleToParameters,
  mergeFacilityLabelStyle,
  resolveLabelCss,
  resolveLabelOffsetPx,
  resolveLabelPlacement,
  resolveLabelRotationDeg,
  shouldShowFacilityLabel,
} from '../utils/facilityLabelStyle'
import {
  clampTrackCornerRadii,
  getTrackCornerRadiiForFacility,
} from '../utils/trackCornerRadius'
import {
  resolveFacilityAlignSnapThresholdPx,
  snapDragRectWithAlignGuides,
  snapResizeRectWithAlignGuides,
  type AlignGuideLine,
  type SnapRect,
} from '../utils/facilityDragAlign'
import { snapDragPosition } from '../utils/snapDrag'
import { applyEdgeResizePx, resizeCursorForEdge } from '../../../lib/elementResize'
import { normalizeDegrees, resolveRotatedRectAabb } from '../utils/rotation'
import { clientToWorldCoords } from '../utils/pointerCoords'
import {
  areaLocalPxToMeter,
  areaPositionToCssTopLeft,
  clampFacilityMeterPosition,
  clientToAreaLocalPx,
  cssTopLeftToAreaPosition,
  domainHeightM,
  domainWidthM,
  meterToAreaLocalPx,
} from '../utils/areaCoords'
import type { MapAreaDomain, MapAreaLayout } from '../types/area'
import { FacilityTransformOverlay } from './FacilityTransformOverlay'
import {
  getFacilityRemarks,
  resolveFacilityDisplay,
} from '../utils/facilityArea'
import { resolveTrackFillColor } from '../utils/trackFacility'
import {
  parseRoadLineColor,
  parseRoadLineStyle,
  parseRoadLineWidthPx,
} from '../utils/roadLineFacility'
import { RoadLineGraphic } from './RoadLineGraphic'
import {
  TrackCrossoverGraphic,
  portalsToAreaCssPoints,
  strokePxFromWidthHandlePointer,
} from './TrackCrossoverGraphic'
import type { TrackNetworkSegment } from '../vehicles/trackNetwork/types'
import {
  dragCrossoverPortal,
  ensureCrossoverPortals,
  clampTrackCrossoverStrokePx,
  parseTrackCrossoverColor,
  parseTrackCrossoverColorOpacity,
  parseTrackCrossoverStrokePx,
  parseTrackCrossoverCenterGapPct,
  parseTrackCrossoverBgColor,
  parseTrackCrossoverBgOpacity,
  TRACK_CROSSOVER_STROKE_PX_KEY,
  translateCrossoverPortals,
  type CrossoverPortalKey,
  type CrossoverPortals,
} from '../utils/trackCrossoverFacility'
import {
  buildCrossoverSnapUiForPoint,
  mergeCrossoverSnapUi,
  type CrossoverSnapUi,
} from '../utils/crossoverSnapUi'
import {
  clientPointToFieldMeters,
  syncLayoutFromCrossoverPortals,
} from '../utils/trackCrossoverLayout'
import { resolveMapEditorAssetUrl } from '../utils/mapEditorAssetUrl'
import {
  canApplyFacilityFormat,
  type FacilityFormatSnapshot,
} from '../utils/facilityFormatPainter'
import { resolveFacilityAreaSize } from '../utils/facilityAreaCoords'
import { facilityUsesDraggableMapLabel } from '../utils/facilityInspectorUi'

/**
 * 固定工具列螢幕尺寸（與元件大小無關）。
 * 僅補償地圖 CSS scale，讓縮放地圖時仍維持可點的約 48–56px 按鈕。
 */
function facilityToolbarScreenScale(
  mapScale: number,
  meterMode: boolean,
  scaleX: number,
  scaleY: number,
): number {
  const BASE = 0.82
  if (meterMode) {
    const uiScale = clamp(1 / Math.max(0.15, mapScale), 1, 2.75)
    return BASE * uiScale
  }
  const vpScale = Math.min(scaleX > 0 ? scaleX : 1, scaleY > 0 ? scaleY : 1)
  const uiScale = clamp(1 / Math.max(0.15, vpScale), 1, 2.5)
  return BASE * uiScale
}

type FacilityNodeProps = {
  facility: FacilityObject
  /** 畫面上的世界座標（含 MQTT 即時位置） */
  displayPosition: { x: number; y: number }
  mqttLive?: MqttLiveEntry
  /** 編輯預覽：優先於 MQTT／地圖檔顯示 */
  slotPreview?: { occupancy: SlotOccupancy; equipment: SlotEquipmentState } | null
  selected: boolean
  scaleX: number
  scaleY: number
  readOnly?: boolean
  worldRef: RefObject<HTMLDivElement | null>
  onSelect: (id: string, options?: { additive?: boolean }) => void
  /** 雙擊開啟屬性面板 */
  onOpenProperties?: () => void
  onDrag: (
    id: string,
    update:
      | { x: number; y: number }
      | {
          areaPosition: { x: number; y: number }
          position: { x: number; y: number }
        },
  ) => void
  onDragSessionStart?: () => void
  /** 拖曳中通知 Area：略過 MQTT 即時座標、放寬 overflow（僅 Area 內 UI 狀態） */
  onFacilityDragActiveChange?: (active: boolean) => void
  onRotateLeft90: (id: string) => void
  onRotateRight90: (id: string) => void
  onRotateDelta: (id: string, deltaDeg: number) => void
  onPatchParameters?: (id: string, patch: Record<string, unknown>) => void
  onTrackCornerEditStart?: () => void
  /** Area 模式：僅更新圖台區域像素尺寸，不影響參照場域範圍 */
  onResize?: (id: string, areaSizePx: { w: number; h: number }) => void
  onResizeSessionStart?: () => void
  /** 編輯模式：刪除此設施 */
  onDelete?: () => void
  /** 圖層順序（愈大愈在上，可互相覆蓋） */
  stackZIndex?: number
  /** Area 內渲染：尺寸以公尺×scale 換算，position 為局部像素 */
  meterMode?: boolean
  /** meterMode 時 Area 地圖 CSS scale，用於固定工具列螢幕尺寸 */
  mapScale?: number
  /** meterMode 時設施左上角在 Area 內的像素座標（用於拖曳／縮放換算） */
  areaAnchorPx?: { x: number; y: number }
  /** meterMode 時管制範圍（公尺），用於拖曳／縮放邊界 */
  domainBoundsM?: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number }
  /** meterMode 時 Area 座標轉換 */
  areaMeterContext?: {
    domain: MapAreaDomain
    layout: MapAreaLayout
  }
  /** 可捲動地圖 viewport；拖曳期間暫停捲動，避免垂直拖曳被 browser scroll 吃掉 */
  mapViewportRef?: RefObject<HTMLDivElement | null>
  /** meterMode：同 Area 其他設施外框，供拖曳對齊 */
  peerSnapRects?: SnapRect[]
  /** meterMode：拖曳中對齊輔助線（由 Area 層繪製） */
  onAlignGuidesChange?: (guides: AlignGuideLine[] | null) => void
  /** meterMode：縮放中通知 Area 顯示對齊輔助線與外框 */
  onFacilityResizeActiveChange?: (active: boolean) => void
  /** 滑鼠進入／離開（供方向鍵微調） */
  onHoverChange?: (hovered: boolean) => void
  /** 格式複製器：已複製的格式（單次貼上） */
  formatPaintSnapshot?: FacilityFormatSnapshot | null
  onStartFormatPaint?: () => void
  onFormatPaintPick?: () => void
  onCancelFormatPaint?: () => void
  /** 選取時顯示圓形工具列 */
  showFacilityToolbar?: boolean
  /** 導通掃描：問題軌道高亮 */
  connectivityScanHighlight?: boolean
  /** 導通掃描：斷點閃爍三次 */
  connectivityScanFlashing?: boolean
  /** 虛擬渡線：供端點吸附軌道中心 */
  crossoverSegmentById?: Map<string, TrackNetworkSegment> | null
  /** 虛擬渡線拖曳：此軌道為鄰近候選（先標示） */
  crossoverSnapHighlight?: boolean
  /** 虛擬渡線拖曳：此軌道為目前勾子目標 */
  crossoverSnapPrimary?: boolean
  /** 回報 Area：鄰近軌道標示 + 勾子疊層 */
  onCrossoverSnapUiChange?: (ui: CrossoverSnapUi | null) => void
}

export const FacilityNode = memo(function FacilityNode({
  facility,
  displayPosition,
  mqttLive,
  slotPreview = null,
  selected,
  scaleX,
  scaleY,
  readOnly = false,
  worldRef,
  onSelect,
  onOpenProperties,
  onDrag,
  onDragSessionStart,
  onFacilityDragActiveChange,
  onRotateLeft90: _onRotateLeft90,
  onRotateRight90,
  onRotateDelta,
  onPatchParameters,
  onTrackCornerEditStart,
  onResize,
  onResizeSessionStart,
  onDelete,
  stackZIndex = 10,
  meterMode = false,
  mapScale = 1,
  areaAnchorPx,
  domainBoundsM,
  areaMeterContext,
  mapViewportRef,
  peerSnapRects = [],
  onAlignGuidesChange,
  onFacilityResizeActiveChange,
  onHoverChange,
  formatPaintSnapshot = null,
  onStartFormatPaint,
  onFormatPaintPick,
  onCancelFormatPaint,
  showFacilityToolbar = true,
  connectivityScanHighlight = false,
  connectivityScanFlashing = false,
  crossoverSegmentById = null,
  crossoverSnapHighlight = false,
  crossoverSnapPrimary = false,
  onCrossoverSnapUiChange,
}: FacilityNodeProps) {
  const mapExtent = useMapExtent()
  const Icon = PALETTE_ICON_BY_NAME[facility.name]
  const isDockingPoint = facility.type === 'DockingPoint'
  const isWaypoint = facility.type === 'Waypoint'
  const label = isDockingPoint
    ? resolveDockingPointMapLabel(facility)
    : isWaypoint
      ? ''
      : facility.customName.trim() || facility.name
  const showRot =
    mqttLive?.rotationDeg !== undefined
      ? mqttLive.rotationDeg
      : facility.rotation
  const showRotNorm = normalizeDegrees(showRot)
  const angleLabel = `${showRotNorm.toFixed(0)}°`

  const [imageError, setImageError] = useState(false)
  const [facilityIconError, setFacilityIconError] = useState(false)
  const [signalIconError, setSignalIconError] = useState(false)
  const [dockingIconError, setDockingIconError] = useState(false)

  useEffect(() => {
    setImageError(false)
  }, [facility.name])

  const bgUrl = FACILITY_BACKGROUND_BY_NAME[facility.name]

  const sizeMeters = getFacilitySizeMeters(
    facility,
    domainBoundsM
      ? {
          w: domainBoundsM.xMaxM - domainBoundsM.xMinM,
          h: domainBoundsM.yMaxM - domainBoundsM.yMinM,
        }
      : undefined,
  )
  const areaSizePx =
    meterMode && areaMeterContext
      ? resolveFacilityAreaSize(
          facility,
          areaMeterContext.domain,
          areaMeterContext.layout,
          domainBoundsM
            ? {
                w: domainBoundsM.xMaxM - domainBoundsM.xMinM,
                h: domainBoundsM.yMaxM - domainBoundsM.yMinM,
              }
            : undefined,
        )
      : null
  const isTrackCrossoverEarly = facility.type === 'TrackCrossover'
  /** 虛擬渡線：整區疊層自由線（與圍籬／拓撲線相同），不用 AABB 方框尺寸 */
  const { w: nw, h: nh } =
    isTrackCrossoverEarly && meterMode && areaMeterContext
      ? {
          w: areaMeterContext.layout.wPx,
          h: areaMeterContext.layout.hPx,
        }
      : areaSizePx
        ? { w: areaSizePx.w, h: areaSizePx.h }
        : meterMode
          ? { w: sizeMeters.w * scaleX, h: sizeMeters.h * scaleY }
          : facilityNodeWorldSize(facility)
  const minDim = Math.min(nw, nh)
  const widthM = worldPxToMeters(nw)
  const heightM = worldPxToMeters(nh)
  const getTrackCornerRadii = useCallback(
    (f: FacilityObject) =>
      getTrackCornerRadiiForFacility(f, { w: widthM, h: heightM }),
    [heightM, widthM],
  )
  const isPsd = facility.type === 'PSD'
  const isSignal = facility.type === 'Signal'
  const isPole = facility.type === 'Pole'
  const isTrack = facility.type === 'Track'
  const isRoadLine = facility.type === 'RoadLine'
  const isTrackCrossover = facility.type === 'TrackCrossover'
  const isFacilityArea = facility.type === 'Facility'
  const [crossoverPortalPreview, setCrossoverPortalPreview] =
    useState<CrossoverPortals | null>(null)
  const [crossoverStrokePreview, setCrossoverStrokePreview] = useState<
    number | null
  >(null)
  const crossoverWidthDragRef = useRef<{
    pointerId: number
  } | null>(null)
  const facilityDockingBounds = isFacilityArea
    ? getValidRefFieldBounds(facility.parameters)
    : null
  const facilityDockingPoint = isFacilityArea
    ? getFacilityDockingPoint(facility)
    : null
  const [dockingDragPreview, setDockingDragPreview] =
    useState<FacilityDockingPoint | null>(null)
  const [dockingPointActive, setDockingPointActive] = useState(false)
  const [dockingPointHovered, setDockingPointHovered] = useState(false)
  const dockingDragRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startAlongX: number
    startAlongY: number
    bodyW: number
    bodyH: number
    rotDeg: number
  } | null>(null)
  const displayDockingPoint = dockingDragPreview ?? facilityDockingPoint
  const dockingAlong =
    displayDockingPoint && facilityDockingBounds
      ? facilityDockingPointToAlong(displayDockingPoint, facilityDockingBounds)
      : null
  const dockingPointFocused = dockingPointActive || dockingDragPreview != null

  const onFacilityDockingPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (
        readOnly
        || !onPatchParameters
        || !facilityDockingBounds
        || !dockingAlong
      ) {
        return
      }
      e.stopPropagation()
      e.preventDefault()
      onSelect(facility.id)
      setDockingPointActive(true)
      setDockingDragPreview(
        alongToFacilityDockingPoint(
          dockingAlong.alongX,
          dockingAlong.alongY,
          facilityDockingBounds,
        ),
      )
      dockingDragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startAlongX: dockingAlong.alongX,
        startAlongY: dockingAlong.alongY,
        bodyW: nw,
        bodyH: nh,
        rotDeg: showRot,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [
      dockingAlong,
      facility.id,
      facilityDockingBounds,
      nh,
      nw,
      onPatchParameters,
      onSelect,
      readOnly,
      showRot,
    ],
  )

  const onFacilityDockingPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dockingDragRef.current
      if (!drag || drag.pointerId !== e.pointerId || !facilityDockingBounds) return
      e.stopPropagation()
      const dx = e.clientX - drag.startClientX
      const dy = e.clientY - drag.startClientY
      const rad = (drag.rotDeg * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      // 螢幕位移 → 設施本體未旋轉座標系（右、下）
      const localDx = dx * cos + dy * sin
      const localDy = -dx * sin + dy * cos
      const alongX = clamp(
        drag.startAlongX + localDx / Math.max(1, drag.bodyW),
        0,
        1,
      )
      const alongY = clamp(
        drag.startAlongY - localDy / Math.max(1, drag.bodyH),
        0,
        1,
      )
      setDockingDragPreview(
        alongToFacilityDockingPoint(alongX, alongY, facilityDockingBounds),
      )
    },
    [facilityDockingBounds],
  )

  const onFacilityDockingPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dockingDragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      e.stopPropagation()
      dockingDragRef.current = null
      setDockingPointActive(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      setDockingDragPreview((preview) => {
        if (preview && onPatchParameters) {
          const existing = getFacilityDockingPoint(facility)
          onPatchParameters(facility.id, {
            facilityDockingPoint: {
              xM: preview.xM,
              yM: preview.yM,
              ...(existing?.alias ? { alias: existing.alias } : {}),
            },
          })
        }
        return null
      })
    },
    [facility, onPatchParameters],
  )

  const applyCrossoverPortalsUpdate = useCallback(
    (nextPortals: CrossoverPortals) => {
      if (!areaMeterContext || !onPatchParameters) return
      const sync = syncLayoutFromCrossoverPortals(
        nextPortals,
        areaMeterContext.domain,
        areaMeterContext.layout,
      )
      onPatchParameters(facility.id, sync.parametersPatch)
      onResize?.(facility.id, sync.areaSizePx)
      onDrag(facility.id, {
        areaPosition: sync.areaPosition,
        position: sync.position,
      })
    },
    [areaMeterContext, facility.id, onDrag, onPatchParameters, onResize],
  )

  const onCrossoverPortalPointerDown = useCallback(
    (key: CrossoverPortalKey, e: React.PointerEvent<SVGCircleElement>) => {
      if (readOnly || !onPatchParameters || !areaMeterContext) return
      if (!crossoverSegmentById) return
      e.stopPropagation()
      e.preventDefault()
      onSelect(facility.id)
      onDragSessionStart?.()
      const startPortals = ensureCrossoverPortals(facility)
      crossoverPortalDragRef.current = {
        key,
        pointerId: e.pointerId,
        startPortals,
      }
      setCrossoverPortalPreview(startPortals)
      const portal = startPortals[key]
      onCrossoverSnapUiChange?.(
        buildCrossoverSnapUiForPoint(
          portal.xM,
          portal.yM,
          key,
          crossoverSegmentById,
          portal.attachedTrackId,
        ),
      )
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    },
    [
      areaMeterContext,
      crossoverSegmentById,
      facility,
      onCrossoverSnapUiChange,
      onDragSessionStart,
      onPatchParameters,
      onSelect,
      readOnly,
    ],
  )

  const onCrossoverPortalPointerMove = useCallback(
    (e: React.PointerEvent<SVGCircleElement>) => {
      const drag = crossoverPortalDragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      if (!areaMeterContext || !crossoverSegmentById || !worldRef.current) return
      e.stopPropagation()
      const field = clientPointToFieldMeters(
        e.clientX,
        e.clientY,
        worldRef.current,
        mapScale,
        areaMeterContext.domain,
        areaMeterContext.layout,
      )
      const next = dragCrossoverPortal(
        drag.startPortals,
        drag.key,
        field.xM,
        field.yM,
        crossoverSegmentById,
      )
      drag.startPortals = next
      setCrossoverPortalPreview(next)
      const portal = next[drag.key]
      onCrossoverSnapUiChange?.(
        buildCrossoverSnapUiForPoint(
          field.xM,
          field.yM,
          drag.key,
          crossoverSegmentById,
          portal.attachedTrackId,
        ),
      )
    },
    [
      areaMeterContext,
      crossoverSegmentById,
      mapScale,
      onCrossoverSnapUiChange,
      worldRef,
    ],
  )

  const onCrossoverPortalPointerEnd = useCallback(
    (e: React.PointerEvent<SVGCircleElement>) => {
      const drag = crossoverPortalDragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      e.stopPropagation()
      crossoverPortalDragRef.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      onCrossoverSnapUiChange?.(null)
      setCrossoverPortalPreview((preview) => {
        if (preview) applyCrossoverPortalsUpdate(preview)
        return null
      })
    },
    [applyCrossoverPortalsUpdate, onCrossoverSnapUiChange],
  )

  const dockingIconUrl = isDockingPoint ? resolveDockingPointIconUrl(facility) : null
  const facilityDisplay = isFacilityArea
    ? resolveFacilityDisplay(facility, mqttLive)
    : null
  const facilityRemarks = isFacilityArea ? getFacilityRemarks(facility) : ''
  const facilityIconDisplay =
    isFacilityArea &&
    (facility.parameters?.iconDisplay === 'builtin' ||
      facility.parameters?.iconDisplay === 'custom')
      ? facility.parameters.iconDisplay
      : 'none'
  const facilityCustomIconUrl =
    isFacilityArea && typeof facility.parameters?.customIconUrl === 'string'
      ? resolveMapEditorAssetUrl(facility.parameters.customIconUrl.trim())
      : ''
  const isIconOnlyFacilityArea =
    isFacilityArea &&
    facilityIconDisplay === 'custom' &&
    !!facilityCustomIconUrl &&
    facilityDisplay?.fillColor === 'transparent'

  useEffect(() => {
    setFacilityIconError(false)
  }, [facilityCustomIconUrl])

  const trackFillColor = isTrack ? resolveTrackFillColor(facility, mqttLive) : null
  const roadLineStyle = isRoadLine
    ? parseRoadLineStyle(facility.parameters?.roadLineStyle)
    : null
  const roadLineWidthPx = isRoadLine
    ? parseRoadLineWidthPx(facility.parameters?.roadLineWidthPx)
    : 0
  const roadLineColor = isRoadLine
    ? parseRoadLineColor(facility.parameters?.roadLineColor)
    : ''
  const trackCrossoverColor = isTrackCrossover
    ? parseTrackCrossoverColor(facility.parameters?.trackCrossoverColor)
    : ''
  const trackCrossoverColorOpacity = isTrackCrossover
    ? parseTrackCrossoverColorOpacity(
        facility.parameters?.trackCrossoverColorOpacity,
      )
    : 100
  const trackCrossoverStrokePx = isTrackCrossover
    ? parseTrackCrossoverStrokePx(facility.parameters?.trackCrossoverStrokePx)
    : 0
  const trackCrossoverCenterGapPct = isTrackCrossover
    ? parseTrackCrossoverCenterGapPct(
        facility.parameters?.trackCrossoverCenterGapPct,
      )
    : 0
  const trackCrossoverBgColor = isTrackCrossover
    ? parseTrackCrossoverBgColor(facility.parameters?.trackCrossoverBgColor)
    : null
  const trackCrossoverBgOpacity = isTrackCrossover
    ? parseTrackCrossoverBgOpacity(facility.parameters?.trackCrossoverBgOpacity)
    : 35
  const crossoverPortals = isTrackCrossover
    ? (crossoverPortalPreview ?? ensureCrossoverPortals(facility))
    : null
  const crossoverPortalsLocal =
    crossoverPortals && areaMeterContext
      ? portalsToAreaCssPoints(
          crossoverPortals,
          areaMeterContext.layout,
          (xM, yM) =>
            meterToAreaLocalPx(
              xM,
              yM,
              areaMeterContext.domain,
              areaMeterContext.layout,
            ),
        )
      : []
  const trackCrossoverStrokeDisplay =
    crossoverStrokePreview ?? trackCrossoverStrokePx

  const onCrossoverWidthPointerDown = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      if (readOnly || !onPatchParameters) return
      e.stopPropagation()
      e.preventDefault()
      onSelect(facility.id)
      onDragSessionStart?.()
      crossoverWidthDragRef.current = { pointerId: e.pointerId }
      setCrossoverStrokePreview(trackCrossoverStrokePx)
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    },
    [
      facility.id,
      onDragSessionStart,
      onPatchParameters,
      onSelect,
      readOnly,
      trackCrossoverStrokePx,
    ],
  )

  const onCrossoverWidthPointerMove = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const drag = crossoverWidthDragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      if (!worldRef.current) return
      e.stopPropagation()
      const css = clientToAreaLocalPx(
        e.clientX,
        e.clientY,
        worldRef.current,
        mapScale,
      )
      if (crossoverPortalsLocal.length === 0) return
      const raw = strokePxFromWidthHandlePointer(crossoverPortalsLocal, css)
      if (raw == null) return
      setCrossoverStrokePreview(clampTrackCrossoverStrokePx(raw))
    },
    [crossoverPortalsLocal, mapScale, worldRef],
  )

  const onCrossoverWidthPointerEnd = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const drag = crossoverWidthDragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      e.stopPropagation()
      crossoverWidthDragRef.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      setCrossoverStrokePreview((preview) => {
        if (preview != null && onPatchParameters) {
          onPatchParameters(facility.id, {
            [TRACK_CROSSOVER_STROKE_PX_KEY]: preview,
          })
        }
        return null
      })
    },
    [facility.id, onPatchParameters],
  )

  const signalDisplay =
    facility.type === 'Signal' ? resolveSignalDisplay(facility, mqttLive) : null

  useEffect(() => {
    setSignalIconError(false)
  }, [signalDisplay?.iconUrl])

  useEffect(() => {
    setDockingIconError(false)
  }, [dockingIconUrl])

  const useWideRow =
    isPsd ||
    isFacilityArea ||
    facility.type === 'Track' ||
    isRoadLine ||
    isTrackCrossover ||
    (nw >= nh * 4 && nh < 60)
  /** 世界座標邊長；外層 scale(sx,sy) 後，圖示約佔卡片可讀比例 */
  const useDraggableMapLabel = facilityUsesDraggableMapLabel(facility)
  const iconWorld =
    isDockingPoint || isWaypoint || (isFacilityArea && isIconOnlyFacilityArea)
      ? Math.max(18, Math.min(nw * 0.88, nh * 0.88))
      : useWideRow
          ? Math.max(18, Math.min(nh * 0.88, nw * 0.42))
          : Math.max(18, Math.min(minDim * 0.76))
  const signalScale = Math.min(nw / 32, nh / 38) * 0.92
  const dockingDotSize = Math.max(10, Math.min(iconWorld * 0.5, 22))
  const waypointDotSize = Math.round(
    Math.max(4, Math.min(iconWorld * 0.2, 9)) * 1.1,
  )
  const labelStyle = getFacilityLabelStyle(facility)
  const labelCss = resolveLabelCss(labelStyle, minDim, facility.type)
  const showLabel = shouldShowFacilityLabel(labelStyle)
  const labelPlacement =
    isSignal && signalDisplay
      ? labelStyle.labelPlacement ??
        labelPlacementFromSignalMount(signalDisplay.mountDirection)
      : useDraggableMapLabel
        ? resolveLabelPlacement(facility, labelStyle)
        : 'below'
  const labelOffset = resolveLabelOffsetPx(
    labelStyle,
    labelPlacement,
    iconWorld,
    labelCss.fontSize,
    nw,
    nh,
    { mapLabelMode: useDraggableMapLabel },
  )
  const canEditLabel =
    !readOnly && showLabel && !!onPatchParameters && useDraggableMapLabel

  const labelRotationDeg = resolveLabelRotationDeg(labelStyle)

  const patchLabelStyle = useCallback(
    (patch: Parameters<typeof mergeFacilityLabelStyle>[1]) => {
      if (!onPatchParameters) return
      const next = mergeFacilityLabelStyle(labelStyle, patch)
      onPatchParameters(
        facility.id,
        labelStyleToParameters(next) as Record<string, unknown>,
      )
    },
    [facility.id, labelStyle, onPatchParameters],
  )
  const slotSubFontWorld = Math.max(8, Math.min(12, minDim * 0.12))

  const { padX: hitPadX, padY: hitPadY } = isTrackCrossover
    ? { padX: 0, padY: 0 }
    : meterMode
      ? areaSizePx
        ? { padX: 0, padY: 0 }
        : (() => {
            const minHitM = facilityHitPadMeters(facility)
            return {
              padX: Math.max(0, (minHitM * scaleX - nw) / 2),
              padY: Math.max(0, (minHitM * scaleY - nh) / 2),
            }
          })()
      : facilityHitPadWorld(facility)

  /** 固定可點尺寸；僅補償地圖縮放，不隨元件大小變化 */
  const toolbarScreenScale = facilityToolbarScreenScale(
    mapScale,
    meterMode,
    scaleX,
    scaleY,
  )

  const formatPaintActive = !!formatPaintSnapshot
  const formatPaintCanApply =
    formatPaintActive &&
    !!formatPaintSnapshot &&
    canApplyFacilityFormat(formatPaintSnapshot, facility)
  const formatPaintCursor = formatPaintActive
    ? formatPaintCanApply
      ? 'copy'
      : 'not-allowed'
    : undefined
  /** 格式複製模式時內層也需 copy／not-allowed，不可被 cursor-grab 蓋掉 */
  const bodyCursor: string | undefined = formatPaintActive
    ? formatPaintCursor
    : readOnly
      ? 'pointer'
      : 'grab'
  const bodyCursorClass = formatPaintActive
    ? ''
    : readOnly
      ? 'cursor-pointer'
      : 'cursor-grab active:cursor-grabbing'

  const slotOcc: SlotOccupancy | null =
    facility.type === 'Slot'
      ? (slotPreview?.occupancy ??
        mqttLive?.slotOccupancy ??
        facility.slotOccupancy)
      : null
  const slotEq: SlotEquipmentState | null =
    facility.type === 'Slot'
      ? ((slotPreview?.equipment ??
          mqttLive?.slotEquipmentState ??
          facility.slotEquipmentState) as SlotEquipmentState)
      : null

  const slotOccCls =
    slotOcc === 'Occupied'
      ? 'border-amber-500/90 bg-amber-950/35'
      : 'border-zinc-600'
  const slotEqCls =
    slotEq === 'Working'
      ? 'shadow-[0_0_10px_rgba(251,191,36,0.35)]'
      : slotEq === 'Charging'
        ? 'shadow-[0_0_12px_rgba(52,211,153,0.45)]'
        : slotEq === 'Repairing'
          ? 'shadow-[0_0_10px_rgba(251,146,60,0.35)]'
          : slotEq === 'Error'
            ? 'shadow-[0_0_12px_rgba(248,113,113,0.5)]'
            : ''

  const psdDisplay =
    facility.type === 'PSD'
      ? resolvePsdDisplay(facility, mqttLive)
      : null

  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [editingCorner, setEditingCorner] = useState<null | 'tl' | 'tr' | 'br' | 'bl'>(
    null,
  )
  const [showFacilityRemarks, setShowFacilityRemarks] = useState(false)
  const [liveSizeM, setLiveSizeM] = useState({ w: widthM, h: heightM })
  const showTransformSizeOverlay =
    !readOnly &&
    (isDragging ||
      isResizing ||
      (selected && isRoadLine) ||
      (selected && showRotNorm !== 0 && !isTrackCrossover))
  const rotAabb = resolveRotatedRectAabb(nw, nh, showRotNorm)
  const aabbBottomCenterLeft = hitPadX + rotAabb.offsetLeft + rotAabb.w / 2
  const aabbBottomPx = hitPadY + rotAabb.offsetTop + rotAabb.h
  const crossoverMidLocal = (() => {
    if (!isTrackCrossover || crossoverPortalsLocal.length === 0) return null
    let sx = 0
    let sy = 0
    for (const p of crossoverPortalsLocal) {
      sx += p.x
      sy += p.y
    }
    return {
      x: sx / crossoverPortalsLocal.length,
      y: sy / crossoverPortalsLocal.length,
    }
  })()
  const draggingRef = useRef(false)
  const dragHistoryPushedRef = useRef(false)
  const resizingRef = useRef(false)
  const resizeHistoryPushedRef = useRef(false)
  const resizeStartRef = useRef({
    worldX: 0,
    worldY: 0,
    w: 0,
    h: 0,
    x: 0,
    y: 0,
  })
  const resizeEdgeRef = useRef<'left' | 'right' | 'top' | 'bottom'>('right')
  const cornerStartRef = useRef({
    key: 'tl' as 'tl' | 'tr' | 'br' | 'bl',
    pointerX: 0,
    pointerY: 0,
    base: { tl: 0, tr: 0, br: 0, bl: 0 },
  })
  const grabOffsetRef = useRef({ x: 0, y: 0 })
  const dragStartClientRef = useRef({ x: 0, y: 0 })
  const dragStartMeterRef = useRef<{ x: number; y: number } | null>(null)
  const crossoverDragStartPortalsRef = useRef<CrossoverPortals | null>(null)
  const crossoverDragStartFieldRef = useRef<{ xM: number; yM: number } | null>(
    null,
  )
  const crossoverSegmentByIdRef = useRef(crossoverSegmentById)
  crossoverSegmentByIdRef.current = crossoverSegmentById
  const crossoverPortalDragRef = useRef<{
    key: CrossoverPortalKey
    pointerId: number
    startPortals: CrossoverPortals
  } | null>(null)
  const grabOffsetLocalRef = useRef({ x: 0, y: 0 })
  const dragActiveRef = useRef(false)
  const DRAG_START_PX = 4
  const facilityRef = useRef(facility)
  const mqttLiveRef = useRef(mqttLive)
  const displayPosRef = useRef(displayPosition)
  const areaAnchorPxRef = useRef(areaAnchorPx ?? displayPosition)
  const areaMeterContextRef = useRef(areaMeterContext)
  const domainBoundsMRef = useRef(domainBoundsM)
  const mapScaleRef = useRef(mapScale)
  const mapViewportRefRef = useRef(mapViewportRef)
  const dragWindowCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    facilityRef.current = facility
  }, [facility])
  useEffect(() => {
    mqttLiveRef.current = mqttLive
  }, [mqttLive])
  useEffect(() => {
    displayPosRef.current = displayPosition
  }, [displayPosition])

  const resolveShowRot = useCallback(() => {
    const live = mqttLiveRef.current
    const f = facilityRef.current
    return normalizeDegrees(
      live?.rotationDeg !== undefined ? live.rotationDeg : (f.rotation ?? 0),
    )
  }, [])
  useEffect(() => {
    areaAnchorPxRef.current = areaAnchorPx ?? displayPosition
  }, [areaAnchorPx, displayPosition])
  useEffect(() => {
    areaMeterContextRef.current = areaMeterContext
  }, [areaMeterContext])
  useEffect(() => {
    domainBoundsMRef.current = domainBoundsM
  }, [domainBoundsM])
  useEffect(() => {
    mapScaleRef.current = mapScale
  }, [mapScale])
  useEffect(() => {
    mapViewportRefRef.current = mapViewportRef
  }, [mapViewportRef])
  useEffect(
    () => () => {
      dragWindowCleanupRef.current?.()
      dragWindowCleanupRef.current = null
    },
    [],
  )

  useEffect(() => {
    if (!isResizing) {
      setLiveSizeM({ w: widthM, h: heightM })
    }
  }, [widthM, heightM, isResizing])

  const trackCorners = isTrack
    ? getTrackCornerRadii(facility)
    : { tl: 0, tr: 0, br: 0, bl: 0 }
  const trackCornersPx = {
    tl: (meterMode ? trackCorners.tl * scaleX : metersToWorldPx(trackCorners.tl)),
    tr: (meterMode ? trackCorners.tr * scaleX : metersToWorldPx(trackCorners.tr)),
    br: (meterMode ? trackCorners.br * scaleX : metersToWorldPx(trackCorners.br)),
    bl: (meterMode ? trackCorners.bl * scaleX : metersToWorldPx(trackCorners.bl)),
  }
  const trackCornerHandlePos = {
    tl: {
      x: clamp(trackCornersPx.tl, 0, nw),
      y: 0,
    },
    tr: {
      x: clamp(nw - trackCornersPx.tr, 0, nw),
      y: 0,
    },
    br: {
      x: clamp(nw - trackCornersPx.br, 0, nw),
      y: nh,
    },
    bl: {
      x: clamp(trackCornersPx.bl, 0, nw),
      y: nh,
    },
  }

  // 可調框線：用於 Facility / Track（預設 transparent + 0px 不顯示）
  const strokeWidthPx =
    typeof facility.parameters?.strokeWidthPx === 'number'
      ? Math.max(0, facility.parameters?.strokeWidthPx)
      : 0
  const strokeColor =
    typeof facility.parameters?.strokeColor === 'string'
      ? facility.parameters?.strokeColor.trim()
      : 'transparent'
  const strokeStyleRaw = facility.parameters?.strokeStyle
  const strokeStyle =
    strokeStyleRaw === 'dashed' || strokeStyleRaw === 'dotted' || strokeStyleRaw === 'solid'
      ? strokeStyleRaw
      : 'solid'
  const effectiveFrameWidthPx =
    strokeColor === 'transparent' ? 0 : strokeWidthPx

  const [highlightFlash, setHighlightFlash] = useState(false)
  useEffect(() => {
    if (!mqttLive?.highlightSeq) return
    setHighlightFlash(true)
    const t = window.setTimeout(() => setHighlightFlash(false), 850)
    return () => clearTimeout(t)
  }, [mqttLive?.highlightSeq])

  const clearDragWindowListeners = useCallback(() => {
    dragWindowCleanupRef.current?.()
    dragWindowCleanupRef.current = null
  }, [])

  const releaseMapViewportScroll = useCallback(() => {
    const vp = mapViewportRefRef.current?.current
    if (!vp) return
    vp.style.overflow = vp.dataset.prevOverflow ?? ''
    delete vp.dataset.prevOverflow
    vp.style.overscrollBehavior = ''
  }, [])

  const lockMapViewportScroll = useCallback(() => {
    const vp = mapViewportRefRef.current?.current
    if (!vp || vp.dataset.prevOverflow != null) return
    vp.dataset.prevOverflow = vp.style.overflow
    vp.style.overflow = 'hidden'
    vp.style.overscrollBehavior = 'none'
  }, [])

  const peerSnapRectsRef = useRef(peerSnapRects)
  peerSnapRectsRef.current = peerSnapRects
  const onAlignGuidesChangeRef = useRef(onAlignGuidesChange)
  onAlignGuidesChangeRef.current = onAlignGuidesChange
  const onFacilityResizeActiveChangeRef = useRef(onFacilityResizeActiveChange)
  onFacilityResizeActiveChangeRef.current = onFacilityResizeActiveChange

  const endDrag = useCallback(
    (releaseTarget?: HTMLElement | null, pointerId?: number) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      dragActiveRef.current = false
      dragHistoryPushedRef.current = false
      setIsDragging(false)
      dragStartMeterRef.current = null
      crossoverDragStartPortalsRef.current = null
      crossoverDragStartFieldRef.current = null
      grabOffsetLocalRef.current = { x: 0, y: 0 }
      onCrossoverSnapUiChange?.(null)
      onAlignGuidesChangeRef.current?.(null)
      releaseMapViewportScroll()
      onFacilityDragActiveChange?.(false)
      clearDragWindowListeners()
      if (releaseTarget != null && pointerId != null) {
        try {
          releaseTarget.releasePointerCapture(pointerId)
        } catch {
          /* ignore */
        }
      }
    },
    [clearDragWindowListeners, onCrossoverSnapUiChange, onFacilityDragActiveChange, releaseMapViewportScroll],
  )

  const applyDragMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!draggingRef.current) return
      const world = worldRef.current
      if (!world) return

      if (!dragActiveRef.current) {
        const dx = clientX - dragStartClientRef.current.x
        const dy = clientY - dragStartClientRef.current.y
        if (dx * dx + dy * dy < DRAG_START_PX * DRAG_START_PX) return
        dragActiveRef.current = true
      }

      if (!dragHistoryPushedRef.current) {
        dragHistoryPushedRef.current = true
        onDragSessionStart?.()
      }

      const id = facilityRef.current.id
      const meterCtx = areaMeterContextRef.current

      // 虛擬渡線：整組拖移＝平移端點；已接合端點鎖在原軌道
      if (
        meterMode
        && meterCtx
        && facilityRef.current.type === 'TrackCrossover'
        && onPatchParameters
        && crossoverSegmentByIdRef.current
        && crossoverDragStartPortalsRef.current
        && crossoverDragStartFieldRef.current
      ) {
        const { domain, layout } = meterCtx
        const field = clientPointToFieldMeters(
          clientX,
          clientY,
          world,
          mapScaleRef.current,
          domain,
          layout,
        )
        const dxM = field.xM - crossoverDragStartFieldRef.current.xM
        const dyM = field.yM - crossoverDragStartFieldRef.current.yM
        const nextPortals = translateCrossoverPortals(
          crossoverDragStartPortalsRef.current,
          dxM,
          dyM,
          crossoverSegmentByIdRef.current,
        )
        const sync = syncLayoutFromCrossoverPortals(nextPortals, domain, layout)
        onPatchParameters(id, sync.parametersPatch)
        onResize?.(id, sync.areaSizePx)
        onDrag(id, {
          areaPosition: sync.areaPosition,
          position: sync.position,
        })
        onCrossoverSnapUiChange?.(
          mergeCrossoverSnapUi(
            (['a', 'b'] as const).map((key) =>
              buildCrossoverSnapUiForPoint(
                nextPortals[key].xM,
                nextPortals[key].yM,
                key,
                crossoverSegmentByIdRef.current!,
                nextPortals[key].attachedTrackId,
              ),
            ),
          ),
        )
        return
      }

      if (meterMode && meterCtx) {
        const { domain, layout } = meterCtx
        const local = clientToAreaLocalPx(
          clientX,
          clientY,
          world,
          mapScaleRef.current,
        )
        const bounds = domainBoundsMRef.current
        const areaSize = resolveFacilityAreaSize(
          facilityRef.current,
          domain,
          layout,
          bounds
            ? {
                w: bounds.xMaxM - bounds.xMinM,
                h: bounds.yMaxM - bounds.yMinM,
              }
            : undefined,
        )
        const rawTopLeft = {
          x: local.x - grabOffsetLocalRef.current.x,
          y: local.y - grabOffsetLocalRef.current.y,
        }
        const snapThreshold = resolveFacilityAlignSnapThresholdPx(mapScaleRef.current)
        const rot = normalizeDegrees(facilityRef.current.rotation ?? 0)
        const aabb =
          rot !== 0
            ? resolveRotatedRectAabb(areaSize.w, areaSize.h, rot)
            : null
        const dragRect = aabb
          ? {
              left: rawTopLeft.x + aabb.offsetLeft,
              top: rawTopLeft.y + aabb.offsetTop,
              width: aabb.w,
              height: aabb.h,
            }
          : {
              left: rawTopLeft.x,
              top: rawTopLeft.y,
              width: areaSize.w,
              height: areaSize.h,
            }
        const { rect: snappedCss, guides } = snapDragRectWithAlignGuides(
          dragRect,
          peerSnapRectsRef.current,
          { left: 0, top: 0, width: layout.wPx, height: layout.hPx },
          snapThreshold,
        )
        onAlignGuidesChangeRef.current?.(guides.length > 0 ? guides : null)
        const topLeftCss = aabb
          ? {
              x: snappedCss.left - aabb.offsetLeft,
              y: snappedCss.top - aabb.offsetTop,
            }
          : { x: snappedCss.left, y: snappedCss.top }
        const areaPosition = cssTopLeftToAreaPosition(
          { left: topLeftCss.x, top: topLeftCss.y },
          areaSize,
          layout.hPx,
        )
        const raw = areaLocalPxToMeter(
          areaPosition.x,
          areaPosition.y,
          domain,
          layout,
        )
        const sm = {
          w: areaSize.w / scaleX,
          h: areaSize.h / scaleY,
        }
        const field = clampFacilityMeterPosition(raw.x, raw.y, sm, domain)
        onDrag(id, {
          areaPosition,
          position: field,
        })
        return
      }

      const p = clientToWorldCoords(
        clientX,
        clientY,
        world,
        scaleX,
        scaleY,
      )
      const nx = p.x - grabOffsetRef.current.x
      const ny = p.y - grabOffsetRef.current.y
      const { w: cw, h: ch } = facilityNodeWorldSize(facilityRef.current)
      const snapped = snapDragPosition(
        nx,
        ny,
        { w: cw, h: ch },
        { worldW: mapExtent.worldW, worldH: mapExtent.worldH },
      )
      onDrag(id, snapped)
    },
    [
      meterMode,
      onCrossoverSnapUiChange,
      onDrag,
      onDragSessionStart,
      onPatchParameters,
      onResize,
      scaleX,
      scaleY,
      worldRef,
      mapExtent,
    ],
  )

  const attachDragWindowListeners = useCallback(
    (pointerId: number, captureTarget: HTMLElement) => {
      clearDragWindowListeners()
      const onWindowMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        ev.preventDefault()
        applyDragMove(ev.clientX, ev.clientY)
      }
      const onWindowUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        endDrag(captureTarget, pointerId)
      }
      const opts: AddEventListenerOptions = { capture: true, passive: false }
      document.addEventListener('pointermove', onWindowMove, opts)
      document.addEventListener('pointerup', onWindowUp, opts)
      document.addEventListener('pointercancel', onWindowUp, opts)
      dragWindowCleanupRef.current = () => {
        document.removeEventListener('pointermove', onWindowMove, opts)
        document.removeEventListener('pointerup', onWindowUp, opts)
        document.removeEventListener('pointercancel', onWindowUp, opts)
      }
    },
    [applyDragMove, clearDragWindowListeners, endDrag],
  )

  const onDoubleClickOpenProperties = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      onSelect(facilityRef.current.id)
      onOpenProperties?.()
    },
    [onOpenProperties, onSelect],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('[data-facility-toolbar]')) return
      if ((e.target as HTMLElement).closest('[data-facility-resize-handle]'))
        return
      if ((e.target as HTMLElement).closest('[data-facility-edge-resize-handle]'))
        return
      if ((e.target as HTMLElement).closest('[data-track-corner-handle]')) return
      if ((e.target as HTMLElement).closest('[data-facility-label-drag]')) return
      if ((e.target as HTMLElement).closest('[data-facility-label-rotate-handle]'))
        return
      if ((e.target as HTMLElement).closest('[data-crossover-portal-handle]'))
        return
      if ((e.target as HTMLElement).closest('[data-crossover-width-handle]'))
        return

      if (formatPaintSnapshot) {
        e.stopPropagation()
        e.preventDefault()
        if (formatPaintCanApply) {
          onFormatPaintPick?.()
        } else {
          onCancelFormatPaint?.()
        }
        return
      }

      e.stopPropagation()
      e.preventDefault()
      const f = facilityRef.current
      onSelect(f.id, { additive: e.shiftKey })
      if (readOnly) return

      const world = worldRef.current
      if (!world) return

      dragStartClientRef.current = { x: e.clientX, y: e.clientY }
      dragActiveRef.current = false
      draggingRef.current = true
      dragHistoryPushedRef.current = false
      setIsDragging(true)
      onFacilityDragActiveChange?.(true)
      lockMapViewportScroll()

      if (meterMode && areaMeterContext) {
        dragStartMeterRef.current = {
          x: f.position.x,
          y: f.position.y,
        }
        const local = clientToAreaLocalPx(
          e.clientX,
          e.clientY,
          world,
          mapScaleRef.current,
        )
        const areaSize = resolveFacilityAreaSize(
          f,
          areaMeterContext.domain,
          areaMeterContext.layout,
        )
        const cssAnchor = areaPositionToCssTopLeft(
          f.areaPosition,
          areaSize,
          areaMeterContext.layout.hPx,
        )
        grabOffsetLocalRef.current = {
          x: local.x - cssAnchor.left,
          y: local.y - cssAnchor.top,
        }
        if (f.type === 'TrackCrossover' && crossoverSegmentByIdRef.current) {
          crossoverDragStartPortalsRef.current = ensureCrossoverPortals(f)
          const field = clientPointToFieldMeters(
            e.clientX,
            e.clientY,
            world,
            mapScaleRef.current,
            areaMeterContext.domain,
            areaMeterContext.layout,
          )
          crossoverDragStartFieldRef.current = field
        } else {
          crossoverDragStartPortalsRef.current = null
          crossoverDragStartFieldRef.current = null
        }
      } else {
        dragStartMeterRef.current = null
        crossoverDragStartPortalsRef.current = null
        crossoverDragStartFieldRef.current = null
        const p = clientToWorldCoords(e.clientX, e.clientY, world, scaleX, scaleY)
        const dp = displayPosRef.current
        grabOffsetRef.current = { x: p.x - dp.x, y: p.y - dp.y }
      }

      e.currentTarget.setPointerCapture(e.pointerId)
      attachDragWindowListeners(e.pointerId, e.currentTarget)
    },
    [
      onSelect,
      readOnly,
      scaleX,
      scaleY,
      worldRef,
      meterMode,
      areaMeterContext,
      formatPaintSnapshot,
      formatPaintCanApply,
      onFormatPaintPick,
      onCancelFormatPaint,
      attachDragWindowListeners,
      onFacilityDragActiveChange,
      lockMapViewportScroll,
    ],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      e.preventDefault()
      applyDragMove(e.clientX, e.clientY)
    },
    [applyDragMove],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      endDrag(e.currentTarget, e.pointerId)
    },
    [endDrag],
  )

  const onResizePointerDown = useCallback(
    (edge: 'left' | 'right' | 'top' | 'bottom', e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      if (readOnly || !onResize) return
      const world = worldRef.current
      if (!world) return
      if (meterMode && areaMeterContext) {
        const p = clientToAreaLocalPx(e.clientX, e.clientY, world, mapScale)
        const anchor = areaAnchorPxRef.current
        resizeStartRef.current = {
          worldX: p.x,
          worldY: p.y,
          w: nw,
          h: nh,
          x: anchor.x,
          y: anchor.y,
        }
      } else {
        const p = clientToWorldCoords(e.clientX, e.clientY, world, scaleX, scaleY)
        const { w: sw, h: sh } = facilityNodeWorldSize(facilityRef.current)
        const pos = displayPosRef.current
        resizeStartRef.current = {
          worldX: p.x,
          worldY: p.y,
          w: sw,
          h: sh,
          x: pos.x,
          y: pos.y,
        }
      }
      resizeEdgeRef.current = edge
      resizingRef.current = true
      resizeHistoryPushedRef.current = false
      setIsResizing(true)
      onFacilityResizeActiveChangeRef.current?.(true)
      setLiveSizeM({ w: widthM, h: heightM })
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [readOnly, onResize, scaleX, scaleY, worldRef, meterMode, areaMeterContext, nw, nh],
  )

  const onResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!resizingRef.current || !onResize) return
      const world = worldRef.current
      if (!world) return
      if (!resizeHistoryPushedRef.current) {
        resizeHistoryPushedRef.current = true
        onResizeSessionStart?.()
      }

      if (meterMode && areaMeterContext && domainBoundsM) {
        const { domain, layout } = areaMeterContext
        const p = clientToAreaLocalPx(e.clientX, e.clientY, world, mapScale)
        const start = resizeStartRef.current
        const dX = p.x - start.worldX
        const dY = p.y - start.worldY
        const edge = resizeEdgeRef.current
        const minWpx = MIN_FACILITY_SIZE_M * scaleX
        const minHpx = MIN_FACILITY_SIZE_M * scaleY
        const maxWpx = domainWidthM(domain) * scaleX
        const maxHpx = domainHeightM(domain) * scaleY
        const rot = resolveShowRot()
        let newW = start.w
        let newH = start.h
        let newX = start.x
        let newY = start.y
        if (rot % 360 !== 0) {
          const resized = applyEdgeResizePx(
            edge,
            dX,
            dY,
            { w: start.w, h: start.h, x: start.x, y: start.y },
            rot,
          )
          const cx = start.x + start.w / 2
          const cy = start.y + start.h / 2
          newW = clamp(resized.w, minWpx, maxWpx)
          newH = clamp(resized.h, minHpx, maxHpx)
          newX = cx - newW / 2
          newY = cy - newH / 2
        } else if (edge === 'right') {
          newW = clamp(start.w + dX, minWpx, maxWpx)
        } else if (edge === 'left') {
          newW = clamp(start.w - dX, minWpx, maxWpx)
          newX = start.x + (start.w - newW)
        } else if (edge === 'bottom') {
          newH = clamp(start.h + dY, minHpx, maxHpx)
        } else if (edge === 'top') {
          newH = clamp(start.h - dY, minHpx, maxHpx)
          newY = start.y + (start.h - newH)
        }

        if (rot % 360 === 0) {
          const snapThreshold = resolveFacilityAlignSnapThresholdPx(mapScaleRef.current)
          const { rect: snapped, guides } = snapResizeRectWithAlignGuides(
            { left: newX, top: newY, width: newW, height: newH },
            edge,
            peerSnapRectsRef.current,
            { left: 0, top: 0, width: layout.wPx, height: layout.hPx },
            snapThreshold,
            { width: minWpx, height: minHpx },
          )
          newX = snapped.left
          newY = snapped.top
          newW = snapped.width
          newH = snapped.height
          onAlignGuidesChangeRef.current?.(guides.length > 0 ? guides : null)
        } else {
          onAlignGuidesChangeRef.current?.(null)
        }

        const newWM = newW / scaleX
        const newHM = newH / scaleY
        setLiveSizeM({ w: newWM, h: newHM })
        onResize(facilityRef.current.id, { w: newW, h: newH })
        const areaSizePx = { w: newW, h: newH }
        const areaPosition = cssTopLeftToAreaPosition(
          { left: newX, top: newY },
          areaSizePx,
          layout.hPx,
        )
        const raw = areaLocalPxToMeter(
          areaPosition.x,
          areaPosition.y,
          domain,
          layout,
        )
        onDrag(facilityRef.current.id, {
          areaPosition,
          position: clampFacilityMeterPosition(
            raw.x,
            raw.y,
            { w: newWM, h: newHM },
            domain,
          ),
        })
        return
      }

      const p = clientToWorldCoords(e.clientX, e.clientY, world, scaleX, scaleY)
      const start = resizeStartRef.current
      const dX = Math.round(p.x - start.worldX)
      const dY = Math.round(p.y - start.worldY)
      const edge = resizeEdgeRef.current
      const minPx = metersToWorldPx(MIN_FACILITY_SIZE_M)
      const maxWpx = mapExtent.worldW
      const maxHpx = mapExtent.worldH
      const rot = resolveShowRot()
      let newW = start.w
      let newH = start.h
      let newX = start.x
      let newY = start.y
      if (rot % 360 !== 0) {
        const resized = applyEdgeResizePx(
          edge,
          dX,
          dY,
          { w: start.w, h: start.h, x: start.x, y: start.y },
          rot,
        )
        const cx = start.x + start.w / 2
        const cy = start.y + start.h / 2
        newW = clamp(resized.w, minPx, maxWpx)
        newH = clamp(resized.h, minPx, maxHpx)
        newX = cx - newW / 2
        newY = cy - newH / 2
      } else if (edge === 'right') {
        newW = clamp(start.w + dX, minPx, maxWpx)
      } else if (edge === 'left') {
        newW = clamp(start.w - dX, minPx, maxWpx)
        newX = start.x + (start.w - newW)
      } else if (edge === 'bottom') {
        newH = clamp(start.h + dY, minPx, maxHpx)
      } else if (edge === 'top') {
        newH = clamp(start.h - dY, minPx, maxHpx)
        newY = start.y + (start.h - newH)
      }
      const snappedPos = snapDragPosition(newX, newY, { w: newW, h: newH }, {
        worldW: mapExtent.worldW,
        worldH: mapExtent.worldH,
      })
      setLiveSizeM({
        w: worldPxToMeters(newW),
        h: worldPxToMeters(newH),
      })
      onResize(
        facilityRef.current.id,
        clampSizeMeters(
          {
            w: worldPxToMeters(newW),
            h: worldPxToMeters(newH),
          },
          { w: mapExtent.width, h: mapExtent.height },
        ),
      )
      onDrag(facilityRef.current.id, snappedPos)
    },
    [onDrag, onResize, onResizeSessionStart, resolveShowRot, scaleX, scaleY, worldRef, meterMode, areaMeterContext, domainBoundsM, mapExtent],
  )

  const endResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return
    resizingRef.current = false
    resizeHistoryPushedRef.current = false
    setIsResizing(false)
    onFacilityResizeActiveChangeRef.current?.(false)
    onAlignGuidesChangeRef.current?.(null)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  const onTrackCornerPointerDown = useCallback(
    (corner: 'tl' | 'tr' | 'br' | 'bl', e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      if (readOnly || facilityRef.current.type !== 'Track' || !onPatchParameters) return
      onTrackCornerEditStart?.()
      cornerStartRef.current = {
        key: corner,
        pointerX: e.clientX,
        pointerY: e.clientY,
        base: getTrackCornerRadii(facilityRef.current),
      }
      setEditingCorner(corner)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [getTrackCornerRadii, onPatchParameters, onTrackCornerEditStart, readOnly],
  )

  const onTrackCornerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!editingCorner || !onPatchParameters) return
      const start = cornerStartRef.current
      const dxPx = e.clientX - start.pointerX
      const signed =
        start.key === 'tl' || start.key === 'bl'
          ? dxPx
          : -dxPx
      const deltaM = worldPxToMeters(signed)
      const next = clampTrackCornerRadii(
        {
          ...start.base,
          [start.key]: start.base[start.key] + deltaM,
        },
        { w: widthM, h: heightM },
      )
      onPatchParameters(facilityRef.current.id, {
        trackCornerRadiusMeters: next,
      })
    },
    [editingCorner, heightM, onPatchParameters, widthM],
  )

  const onTrackCornerPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!editingCorner) return
    setEditingCorner(null)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [editingCorner])

  return (
    <div
      data-facility
      data-facility-root
        className={`absolute left-0 top-0 touch-none select-none ${
          isTrackCrossover
            ? 'overflow-visible pointer-events-none'
            : isRoadLine
              ? 'overflow-visible pointer-events-auto'
              : ''
        }`}
      title={
        isFacilityArea && facilityRemarks
          ? facilityRemarks
          : mqttLive?.lastReceived
            ? `MQTT 最後：${mqttLive.lastReceived.topic}`
            : isFacilityArea
              ? label
              : undefined
      }
      onPointerEnter={() => {
        if (!readOnly) onHoverChange?.(true)
        if (!isFacilityArea) return
        if (!facilityRemarks) return
        setShowFacilityRemarks(true)
      }}
      onPointerLeave={() => {
        if (!readOnly) onHoverChange?.(false)
        setShowFacilityRemarks(false)
      }}
      style={{
        transform: `translate(${displayPosition.x - hitPadX}px, ${displayPosition.y - hitPadY}px)`,
        width: nw + hitPadX * 2,
        height: nh + hitPadY * 2,
        zIndex: stackZIndex,
        cursor: formatPaintCursor,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onOpenProperties ? onDoubleClickOpenProperties : undefined}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {isFacilityArea &&
        facilityRemarks &&
        showFacilityRemarks &&
        !readOnly &&
        !isDragging &&
        !isResizing && (
          <div
            className="pointer-events-none absolute z-[120] whitespace-pre-wrap rounded-md border border-cyan-500/30 bg-zinc-950/95 px-2 py-1 text-[11px] leading-snug text-cyan-200 shadow-lg"
            style={{
              left: hitPadX + nw / 2,
              top: Math.max(0, hitPadY - 6),
              transform: 'translateX(-50%) translateY(-100%)',
              maxWidth: Math.min(220, nw * 2.5),
            }}
          >
            {facilityRemarks}
          </div>
        )}
      <div
        className={`absolute overflow-visible ${bodyCursorClass} ${
          isTrackCrossover ? 'pointer-events-none' : ''
        }`}
        style={{
          left: hitPadX,
          top: hitPadY,
          width: nw,
          height: nh,
          transform: isTrackCrossover ? undefined : `rotate(${showRot}deg)`,
          transformOrigin: 'center center',
          cursor: bodyCursor,
        }}
      >
        <div
          key={`mqtt-fx-${mqttLive?.blinkSeq ?? 0}-${mqttLive?.highlightSeq ?? 0}`}
          style={{
            width: nw,
            height: nh,
            ...(isFacilityArea && facilityDisplay
              ? { backgroundColor: facilityDisplay.fillColor }
              : {}),
            ...(isFacilityArea || isTrack
              ? {
                  borderWidth: `${effectiveFrameWidthPx}px`,
                  borderColor: strokeColor,
                  borderStyle: strokeStyle,
                  // Facility 預設是 rounded-md；icon-only 狀態可能沒有圓角 class，這裡補齊
                  borderRadius: isTrack ? undefined : '6px',
                }
              : {}),
            ...(isTrack
              ? {
                  backgroundColor: trackFillColor ?? undefined,
                  borderRadius: `${trackCornersPx.tl}px ${trackCornersPx.tr}px ${trackCornersPx.br}px ${trackCornersPx.bl}px`,
                  overflow: 'hidden',
                }
              : {}),
          }}
          className={[
            'min-h-0 overflow-visible transition',
            isPsd || isSignal || isDockingPoint || isWaypoint || isPole || (isFacilityArea && useDraggableMapLabel)
              ? 'flex size-full items-center justify-center border border-transparent bg-transparent p-0 shadow-none'
              : isTrack || isRoadLine
                ? 'flex size-full items-center justify-center border-0 p-0 shadow-none bg-transparent'
                : isTrackCrossover
                  ? 'relative size-full border-0 p-0 shadow-none bg-transparent'
                : isFacilityArea
                  ? 'flex flex-col items-center justify-center rounded-md border border-dashed border-zinc-400/60 p-1 text-zinc-100 shadow-md'
                  : [
                      'overflow-hidden rounded-md border text-zinc-200 shadow-lg',
                      useWideRow
                        ? 'flex flex-row items-center justify-center gap-1 px-2 py-0.5'
                        : 'flex flex-col items-center justify-center gap-0.5 px-1 py-1',
                    ].join(' '),
            facility.type === 'Slot'
              ? [
                  slotOccCls,
                  slotEqCls,
                  selected
                    ? 'ring-2 ring-cyan-400/80 bg-zinc-800/95'
                    : 'bg-zinc-800/90 hover:border-zinc-500',
                ].join(' ')
              : isPsd || isSignal || isDockingPoint || isWaypoint || isPole || (isFacilityArea && useDraggableMapLabel)
                ? selected
                  ? 'ring-2 ring-cyan-400/90 ring-offset-0'
                  : 'hover:ring-1 hover:ring-cyan-500/40'
                : isTrack || isRoadLine
                  ? selected
                    ? 'ring-2 ring-cyan-400/90 ring-offset-0'
                    : 'hover:ring-1 hover:ring-cyan-500/35'
                  : isTrackCrossover
                    ? ''
                  : isFacilityArea
                    ? selected
                      ? 'ring-2 ring-cyan-400/95 ring-offset-0'
                      : 'hover:ring-1 hover:ring-cyan-500/35'
                    : selected
                      ? 'border-cyan-400 bg-zinc-800/95 ring-2 ring-cyan-400/80'
                      : 'border-zinc-600 bg-zinc-800/90 hover:border-zinc-500',
            !isPsd && (mqttLive?.blinkSeq ?? 0) > 0 ? 'animate-mqtt-flash' : '',
            !isPsd && highlightFlash
              ? 'outline outline-2 outline-amber-400/95 outline-offset-1'
              : '',
            isTrack && connectivityScanHighlight
              ? 'ring-2 ring-amber-400/75 ring-offset-0 outline outline-2 outline-amber-400/45'
              : '',
            isTrack && crossoverSnapHighlight
              ? crossoverSnapPrimary
                ? 'ring-2 ring-amber-300 ring-offset-0 outline outline-2 outline-amber-400/80 shadow-[0_0_18px_rgba(250,204,21,0.55)]'
                : 'ring-2 ring-cyan-400/80 ring-offset-0 outline outline-2 outline-cyan-400/50 shadow-[0_0_14px_rgba(56,189,248,0.4)]'
              : '',
            isTrack && connectivityScanFlashing
              ? 'animate-connectivity-scan-flash-loop'
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {!isTrack && isPole && bgUrl && !imageError ? (
            <img
              src={bgUrl}
              alt={label}
              className="pointer-events-none size-full object-contain"
              style={{ opacity: facility.currentState === 'Error' ? 0.55 : 0.95 }}
              onError={() => setImageError(true)}
            />
          ) : isRoadLine && roadLineStyle ? (
            <div className="relative size-full" style={{ isolation: 'isolate' }}>
              <RoadLineGraphic
                width={nw}
                height={nh}
                style={roadLineStyle}
                strokeWidthPx={roadLineWidthPx}
                color={roadLineColor}
              />
            </div>
          ) : isTrackCrossover ? (
            <div
              className="relative size-full overflow-visible pointer-events-none"
              style={{ isolation: 'isolate' }}
            >
              <TrackCrossoverGraphic
                width={nw}
                height={nh}
                portalsLocal={crossoverPortalsLocal}
                color={trackCrossoverColor}
                colorOpacity={trackCrossoverColorOpacity}
                strokeWidthPx={trackCrossoverStrokeDisplay}
                centerGapPct={trackCrossoverCenterGapPct}
                bgColor={trackCrossoverBgColor}
                bgOpacity={trackCrossoverBgOpacity}
                emphasized={selected}
                interactive={!readOnly && !!crossoverSegmentById}
                showWidthHandles={selected && !readOnly}
                onPortalPointerDown={onCrossoverPortalPointerDown}
                onPortalPointerMove={onCrossoverPortalPointerMove}
                onPortalPointerUp={onCrossoverPortalPointerEnd}
                onWidthPointerDown={onCrossoverWidthPointerDown}
                onWidthPointerMove={onCrossoverWidthPointerMove}
                onWidthPointerUp={onCrossoverWidthPointerEnd}
              />
            </div>
          ) : isDockingPoint && dockingIconUrl && !dockingIconError ? (
            <FacilityIconLabelLayout
              icon={
                <div
                  className="shrink-0"
                  style={{ width: iconWorld, height: iconWorld }}
                >
                  <img
                    src={dockingIconUrl}
                    alt={label}
                    className="size-full object-contain pointer-events-none"
                    style={{ opacity: facility.currentState === 'Inactive' ? 0.45 : 0.95 }}
                    onError={() => setDockingIconError(true)}
                  />
                </div>
              }
            />
          ) : isDockingPoint ? (
            <FacilityIconLabelLayout
              icon={
                <div
                  className={[
                    'shrink-0 rounded-full shadow-md ring-2',
                    facility.currentState === 'Inactive'
                      ? 'bg-zinc-500 ring-zinc-400/50'
                      : 'bg-blue-500 ring-blue-300/70',
                  ].join(' ')}
                  style={{ width: dockingDotSize, height: dockingDotSize }}
                  aria-hidden
                />
              }
            />
          ) : isWaypoint ? (
            <FacilityIconLabelLayout
              icon={
                <div
                  className={[
                    'shrink-0 rounded-full',
                    facility.currentState === 'Inactive'
                      ? 'bg-zinc-500'
                      : 'bg-emerald-500',
                  ].join(' ')}
                  style={{ width: waypointDotSize, height: waypointDotSize }}
                  aria-hidden
                />
              }
            />
          ) : isSignal && signalDisplay && !signalIconError ? (
            <FacilityIconLabelLayout
              icon={
                <img
                  src={signalDisplay.iconUrl}
                  alt={label}
                  className="pointer-events-none shrink-0 object-contain"
                  style={{
                    maxHeight: nh * 0.72,
                    maxWidth: nw * 0.72,
                    transform: `scale(${signalScale})`,
                    transformOrigin: 'center center',
                  }}
                  onError={() => setSignalIconError(true)}
                />
              }
            />
          ) : isSignal && Icon ? (
            <FacilityIconLabelLayout
              icon={
                <div
                  className="shrink-0 text-cyan-300"
                  style={{ width: iconWorld, height: iconWorld }}
                >
                  <Icon className="size-full" strokeWidth={1.75} />
                </div>
              }
            />
          ) : isPole && Icon ? (
            <div className="flex size-full items-center justify-center text-cyan-300">
              <Icon className="size-[85%] max-h-full max-w-full" strokeWidth={1.75} />
            </div>
          ) : !isTrack && !isPole && !isSignal && !isDockingPoint && bgUrl && !imageError ? (
            <div
              className="shrink-0"
              style={{ width: iconWorld, height: iconWorld }}
            >
              <img
                src={bgUrl}
                alt={label}
                className="size-full object-contain pointer-events-none"
                style={{ opacity: 0.95 }}
                onError={() => setImageError(true)}
              />
            </div>
          ) : facility.type === 'PSD' && psdDisplay ? (
            <PlatformDoorGraphic
              widthPx={nw}
              heightPx={nh}
              openPercent={psdDisplay.openPercent}
              alarm={psdDisplay.alarm}
            />
          ) : isFacilityArea &&
            facilityIconDisplay === 'custom' &&
            facilityCustomIconUrl &&
            !facilityIconError ? (
            useDraggableMapLabel ? (
              <FacilityIconLabelLayout
                icon={
                  <div
                    className="shrink-0"
                    style={{ width: iconWorld, height: iconWorld }}
                  >
                    <img
                      src={facilityCustomIconUrl}
                      alt={label}
                      className="size-full object-contain pointer-events-none"
                      style={{ opacity: 0.95 }}
                      onError={() => setFacilityIconError(true)}
                    />
                  </div>
                }
              />
            ) : (
              <div
                className="shrink-0"
                style={{ width: iconWorld, height: iconWorld }}
              >
                <img
                  src={facilityCustomIconUrl}
                  alt={label}
                  className="size-full object-contain pointer-events-none"
                  style={{ opacity: 0.95 }}
                  onError={() => setFacilityIconError(true)}
                />
              </div>
            )
          ) : isFacilityArea && facilityIconDisplay === 'builtin' && Icon ? (
            useDraggableMapLabel ? (
              <FacilityIconLabelLayout
                icon={
                  <div
                    className="shrink-0 text-cyan-300"
                    style={{ width: iconWorld, height: iconWorld }}
                  >
                    <Icon className="size-full" strokeWidth={1.75} />
                  </div>
                }
              />
            ) : (
              <div
                className="shrink-0 text-cyan-300"
                style={{ width: iconWorld, height: iconWorld }}
              >
                <Icon className="size-full" strokeWidth={1.75} />
              </div>
            )
          ) : !isTrack && !isRoadLine && !isTrackCrossover && !isFacilityArea ? (
            <div
              className="shrink-0 text-cyan-300"
              style={{ width: iconWorld, height: iconWorld }}
            >
              <Icon className="size-full" strokeWidth={1.75} />
            </div>
          ) : null}
          {!isPsd && !useDraggableMapLabel && showLabel && (
            <span
              className={[
                'min-w-0 leading-tight',
                labelCss.textWrap === 'single' ? 'truncate' : '',
              ].join(' ')}
              style={{
                fontSize: labelCss.fontSize,
                color: labelCss.color,
                fontWeight: labelCss.fontWeight,
                fontStyle: labelCss.fontStyle,
                textAlign: labelCss.textAlign,
                whiteSpace: labelCss.textWrap === 'single' ? 'nowrap' : 'normal',
                alignSelf:
                  labelCss.verticalAlign === 'top'
                    ? 'flex-start'
                    : labelCss.verticalAlign === 'bottom'
                      ? 'flex-end'
                      : 'center',
                width: useWideRow ? '100%' : undefined,
              }}
            >
              {label}
            </span>
          )}
          {facility.type === 'Slot' && slotOcc !== null && slotEq !== null && (
            <span
              className="max-w-full truncate text-center leading-tight text-zinc-500"
              style={{ fontSize: slotSubFontWorld }}
            >
              {slotOcc === 'Vacant' ? '空' : '佔'} · {slotEq}
            </span>
          )}
        </div>
        {isPsd && selected && showLabel && label.trim() && (
          <div
            className="pointer-events-none absolute left-1/2 z-[6] -translate-x-1/2 whitespace-nowrap"
            style={{
              top: nh + 2,
              fontSize: labelCss.fontSize,
              color: labelCss.color,
              fontWeight: labelCss.fontWeight,
              fontStyle: labelCss.fontStyle,
            }}
          >
            {label}
          </div>
        )}
        {selected && !isTrackCrossover && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[74] border-2 border-cyan-400/95"
          />
        )}
        {selected && !readOnly && onResize && !isTrackCrossover && (
          <>
            {([
              ['left', { left: -7, top: 0, width: 14, height: nh }],
              ['right', { right: -7, top: 0, width: 14, height: nh }],
              [
                'top',
                { left: 12, top: -7, width: Math.max(0, nw - 24), height: 14 },
              ],
              [
                'bottom',
                { left: 12, bottom: -7, width: Math.max(0, nw - 24), height: 14 },
              ],
            ] as const).map(([edge, posStyle]) => (
              <div
                key={edge}
                data-facility-resize-handle
                data-facility-edge-resize-handle
                role="presentation"
                className="group absolute z-[78] touch-none"
                style={{
                  ...posStyle,
                  cursor: resizeCursorForEdge(edge, showRot),
                }}
                onPointerDown={(e) => onResizePointerDown(edge, e)}
                onPointerMove={onResizePointerMove}
                onPointerUp={endResize}
                onPointerCancel={endResize}
              >
                <div
                  className={[
                    'absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-cyan-400 bg-zinc-900 shadow-md ring-1 ring-cyan-500/40 transition-opacity',
                    isPole ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  ].join(' ')}
                  title="拖曳此邊調整大小"
                />
              </div>
            ))}
          </>
        )}
        {isTrack && selected && !readOnly && onPatchParameters && (
          <>
            {([
              [
                'tl',
                {
                  left: trackCornerHandlePos.tl.x,
                  top: trackCornerHandlePos.tl.y,
                },
                'cursor-nwse-resize',
              ],
              [
                'tr',
                {
                  left: trackCornerHandlePos.tr.x,
                  top: trackCornerHandlePos.tr.y,
                },
                'cursor-nesw-resize',
              ],
              [
                'br',
                {
                  left: trackCornerHandlePos.br.x,
                  top: trackCornerHandlePos.br.y,
                },
                'cursor-nwse-resize',
              ],
              [
                'bl',
                {
                  left: trackCornerHandlePos.bl.x,
                  top: trackCornerHandlePos.bl.y,
                },
                'cursor-nesw-resize',
              ],
            ] as const).map(([corner, pos]) => (
              <div
                key={corner}
                data-track-corner-handle
                className={`absolute z-[85] touch-none ${formatPaintActive ? '' : 'cursor-grab active:cursor-grabbing'}`}
                style={{
                  ...pos,
                  transform: 'translate(-50%, -50%)',
                  ...(formatPaintActive && formatPaintCursor
                    ? { cursor: formatPaintCursor }
                    : {}),
                }}
                onPointerDown={(e) => onTrackCornerPointerDown(corner, e)}
                onPointerMove={onTrackCornerPointerMove}
                onPointerUp={onTrackCornerPointerEnd}
                onPointerCancel={onTrackCornerPointerEnd}
                title="拖曳調整此角圓角"
              >
                <div className="size-3 rounded-full border border-violet-300 bg-violet-950/95 shadow-md ring-1 ring-violet-500/40" />
              </div>
            ))}
          </>
        )}
        {useDraggableMapLabel && showLabel && label.trim() ? (
          <FacilityDraggableLabel
            label={label}
            labelCss={labelCss}
            anchorX={nw / 2}
            anchorY={nh / 2}
            offset={labelOffset}
            labelRotationDeg={labelRotationDeg}
            boxW={nw}
            boxH={nh}
            bodyRotationDeg={showRot}
            interactive={canEditLabel}
            selected={selected}
            onSelect={() => onSelect(facility.id)}
            onOffsetChange={
              canEditLabel
                ? (off) =>
                    patchLabelStyle({
                      labelOffsetPx: off,
                      labelOffsetCustom: true,
                    })
                : undefined
            }
            onRotationChange={
              canEditLabel
                ? (deg) => patchLabelStyle({ labelRotationDeg: deg })
                : undefined
            }
          />
        ) : null}
        {isFacilityArea && dockingAlong && displayDockingPoint ? (
          <div
            data-facility-docking-point
            className={[
              'absolute z-[90] touch-none',
              readOnly || !onPatchParameters
                ? 'pointer-events-none'
                : 'cursor-grab active:cursor-grabbing',
            ].join(' ')}
            style={{
              left: dockingAlong.alongX * nw,
              top: (1 - dockingAlong.alongY) * nh,
              transform: `translate(-50%, -50%) scale(${
                dockingPointFocused ? 1.2 : dockingPointHovered ? 1.1 : 1
              })`,
              transition: dockingPointFocused ? 'none' : 'transform 120ms ease-out',
            }}
            title={
              readOnly
                ? `設施停靠點 ${displayDockingPoint.xM.toFixed(2)}, ${displayDockingPoint.yM.toFixed(2)} m`
                : `拖曳設施停靠點（${displayDockingPoint.xM.toFixed(2)}, ${displayDockingPoint.yM.toFixed(2)} m）`
            }
            onPointerEnter={() => {
              if (!readOnly) setDockingPointHovered(true)
            }}
            onPointerLeave={() => setDockingPointHovered(false)}
            onPointerDown={onFacilityDockingPointerDown}
            onPointerMove={onFacilityDockingPointerMove}
            onPointerUp={onFacilityDockingPointerEnd}
            onPointerCancel={onFacilityDockingPointerEnd}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onOpenProperties?.()
            }}
          >
            {/* 加大可點熱區，視覺圓點維持 75% 大小 */}
            <div
              className="relative flex items-center justify-center"
              style={{
                width: Math.max(22, Math.min(Math.min(nw, nh) * 0.28, 32)),
                height: Math.max(22, Math.min(Math.min(nw, nh) * 0.28, 32)),
              }}
            >
              {dockingPointFocused || dockingPointHovered ? (
                <span
                  className={[
                    'pointer-events-none absolute inset-0 rounded-full',
                    dockingPointFocused
                      ? 'bg-cyan-400/25 ring-2 ring-cyan-300/90'
                      : 'bg-emerald-400/15 ring-1 ring-emerald-200/70',
                  ].join(' ')}
                  aria-hidden
                />
              ) : null}
              <div
                className={[
                  'rounded-full shadow-md ring-2 transition-colors',
                  dockingPointFocused
                    ? 'bg-emerald-300 ring-cyan-200 shadow-cyan-400/40'
                    : dockingPointHovered
                      ? 'bg-emerald-400 ring-emerald-100'
                      : 'bg-emerald-500 ring-emerald-300/70',
                ].join(' ')}
                style={{
                  width: Math.max(7.5, Math.min(Math.min(nw, nh) * 0.135, 13.5)),
                  height: Math.max(7.5, Math.min(Math.min(nw, nh) * 0.135, 13.5)),
                }}
                aria-hidden
              />
            </div>
            {dockingPointFocused && displayDockingPoint ? (
              <div className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded border border-cyan-500/40 bg-zinc-950/95 px-1.5 py-0.5 font-mono text-[9px] text-cyan-100 shadow-lg">
                {displayDockingPoint.xM.toFixed(2)}, {displayDockingPoint.yM.toFixed(2)} m
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {showTransformSizeOverlay && (
        <FacilityTransformOverlay
          widthM={liveSizeM.w}
          heightM={liveSizeM.h}
          widthPx={isResizing || isDragging ? liveSizeM.w * scaleX : nw}
          heightPx={isResizing || isDragging ? liveSizeM.h * scaleY : nh}
          anchorLeft={aabbBottomCenterLeft}
          anchorTop={aabbBottomPx + 6}
          showSize
          usePx={isRoadLine || isTrackCrossover}
        />
      )}

      {selected && !readOnly && showFacilityToolbar && (
        <div
          data-facility-toolbar
          className="pointer-events-none absolute z-[5020] flex flex-col items-center gap-1 pt-1"
          style={{
            left: crossoverMidLocal
              ? hitPadX + crossoverMidLocal.x
              : aabbBottomCenterLeft,
            top: crossoverMidLocal
              ? hitPadY + crossoverMidLocal.y + 14
              : aabbBottomPx +
                (showTransformSizeOverlay ? 26 : 6) +
                (useDraggableMapLabel ? 28 : 0),
            transform: `translateX(-50%) scale(${toolbarScreenScale})`,
            transformOrigin: 'top center',
          }}
        >
          <div
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-zinc-500/90 bg-zinc-900/98 px-2 py-1.5 shadow-xl ring-1 ring-cyan-500/30"
            role="toolbar"
            aria-label={isTrackCrossover ? '線徑操作' : '旋轉'}
          >
            {!isTrackCrossover ? (
              <>
                <button
                  type="button"
                  title="逆時針微調 1°"
                  onClick={() => onRotateDelta(facility.id, -1)}
                  className="rounded-full p-1.5 text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300"
                >
                  <RotateCcw className="size-4" aria-hidden />
                </button>
                <span className="mx-0.5 min-w-[2rem] text-center font-mono text-xs leading-none text-cyan-400/90">
                  {angleLabel}
                </span>
                <button
                  type="button"
                  title="順時針微調 1°"
                  onClick={() => onRotateDelta(facility.id, 1)}
                  className="rounded-full p-1.5 text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300"
                >
                  <RotateCw className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  title="順時針轉 90°"
                  onClick={() => onRotateRight90(facility.id)}
                  className="rounded-full p-1.5 text-zinc-200 transition hover:bg-zinc-700 hover:text-cyan-300"
                >
                  <RotateCwSquare className="size-4" aria-hidden />
                </button>
              </>
            ) : null}
            {!isTrackCrossover && onStartFormatPaint && (
              <button
                type="button"
                title="複製格式（大小、角度、填色、框線有無與線型、字級；僅可貼到相同元件）"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onStartFormatPaint()
                }}
                className="rounded-full p-1.5 text-violet-200/90 transition hover:bg-zinc-700 hover:text-violet-100"
              >
                <Paintbrush className="size-4" aria-hidden />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                title="刪除此物件（Delete）"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onDelete()
                }}
                className="rounded-full p-1.5 text-red-300/90 transition hover:bg-red-950/80 hover:text-red-200"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
