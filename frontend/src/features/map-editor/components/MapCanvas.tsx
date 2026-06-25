import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { RefObject } from 'react'
import { facilityNodeWorldSize } from '../constants/facilityDimensions'
import { metersToWorldPx, worldPxToMeters } from '../constants/map'
import { useMapExtent } from '../context/MapExtentContext'
import type { MqttLiveEntry } from '../live/mqttLiveTypes'
import { getMqttEntityId } from '../live/mqttEntityId'
import type {
  FacilityObject,
  GeofenceFacility,
  SlotEquipmentState,
  SlotOccupancy,
} from '../types/facility'
import type { ParsedTrajectory } from '../types/trajectoryFile'
import type { PaletteItem } from '../constants/palette'
import {
  facilityWorldCullBounds,
  findFacilityAtWorldPoint,
} from '../utils/facilityHitTest'
import { isCanvasZoomWheelEvent } from '../utils/mapWheelZoom'
import { clientToWorldCoords } from '../utils/pointerCoords'
import { decodePaletteDragItem, PALETTE_DRAG_MIME } from '../utils/paletteDrag'
import { FacilityNode } from './FacilityNode'
import { GeofenceNode } from './GeofenceNode'
import { HorizontalRuler, VerticalRuler } from './MapRulers'
import { MapAuxiliaryLinesOverlay } from './MapAuxiliaryLinesOverlay'
import { TrajectoryHud } from './TrajectoryHud'
import { TrajectoryLayer } from './TrajectoryLayer'

export type MapInteractionMode = 'map' | 'trajectory'

/** 視窗外多裁切的世界座標邊距（px）；過大會在縮小看全圖時仍掛載過多節點 */
const VIEWPORT_CULL_MARGIN_WORLD_PX = 64

type WorldBounds = { l: number; t: number; r: number; b: number }

type MapCanvasProps = {
  facilities: FacilityObject[]
  selectedId: string | null
  viewportRef: RefObject<HTMLDivElement | null>
  /** 世界座標 → 螢幕像素：X／Y 可不同（顯示比例 × 縮放列） */
  scaleX: number
  scaleY: number
  readOnly?: boolean
  /** 軌跡分頁：不選取設施、僅平移縮放 */
  interactionMode?: MapInteractionMode
  trajectory?: ParsedTrajectory | null
  trajectoryReplayHeadIndex?: number | null
  /** 圖台外緣座標標尺 */
  showRulers?: boolean
  onViewportCenterMeters?: (m: { x: number; y: number }) => void
  onSelect: (id: string | null) => void
  onDragFacility: (id: string, position: { x: number; y: number }) => void
  onDragSessionStart?: () => void
  onResizeFacility?: (id: string, sizeMeters: { w: number; h: number }) => void
  onResizeSessionStart?: () => void
  onRotateLeft90: (id: string) => void
  onRotateRight90: (id: string) => void
  onRotateDelta: (id: string, deltaDeg: number) => void
  onPatchFacilityParameters?: (id: string, patch: Record<string, unknown>) => void
  onTrackCornerEditStart?: () => void
  /** MQTT mock 即時狀態（key = mqttEntityId） */
  liveById?: Record<string, MqttLiveEntry>
  /** 編輯模式：整備格預覽（覆寫圖示顯示，不寫入地圖檔） */
  slotPreview?: {
    facilityId: string
    occupancy: SlotOccupancy
    equipment: SlotEquipmentState
  } | null
  /** 編輯模式：刪除目前選取設施 */
  onDeleteSelected?: () => void
  /** 編輯模式：從資產列拖放至地圖 */
  onPaletteDrop?: (
    item: PaletteItem,
    worldPoint: { x: number; y: number },
  ) => void
  geofenceSelectedLabelId?: string | null
  onSelectGeofenceLabel?: (facilityId: string, labelId: string | null) => void
  onUpdateGeofence?: (
    id: string,
    update: {
      verticesMeters?: { x: number; y: number }[]
      parameters?: Record<string, unknown>
    },
  ) => void
  onGeofenceEditStart?: () => void
  /** 觸控板捏合／Ctrl+滾輪：圖台縮放（不影響側欄與工具列） */
  onWheelZoom?: (
    delta: number,
    clientX: number,
    clientY: number,
  ) => void
}

export function MapCanvas({
  facilities,
  selectedId,
  viewportRef,
  scaleX,
  scaleY,
  readOnly = false,
  interactionMode = 'map',
  trajectory = null,
  trajectoryReplayHeadIndex = null,
  showRulers = true,
  onViewportCenterMeters,
  onSelect,
  onDragFacility,
  onDragSessionStart,
  onResizeFacility,
  onResizeSessionStart,
  onRotateLeft90,
  onRotateRight90,
  onRotateDelta,
  onPatchFacilityParameters,
  onTrackCornerEditStart,
  liveById,
  slotPreview = null,
  onDeleteSelected,
  onPaletteDrop,
  onWheelZoom,
  geofenceSelectedLabelId = null,
  onSelectGeofenceLabel,
  onUpdateGeofence,
  onGeofenceEditStart,
}: MapCanvasProps) {
  const { worldW: mapWorldW, worldH: mapWorldH } = useMapExtent()
  const worldRef = useRef<HTMLDivElement>(null)
  const sx = scaleX > 0 ? scaleX : 1
  const sy = scaleY > 0 ? scaleY : 1

  const noopSelect = useCallback(() => {}, [])
  const handleSelect = interactionMode === 'trajectory' ? noopSelect : onSelect

  /** 量測完成前不渲染設施，避免首幀以「全圖」邊界掛載數百個節點 */
  const [worldBounds, setWorldBounds] = useState<WorldBounds | null>(null)

  useLayoutEffect(() => {
    const margin = VIEWPORT_CULL_MARGIN_WORLD_PX
    const vp = viewportRef.current
    if (!vp) return

    const measure = () => {
      return {
        l: vp.scrollLeft / sx - margin,
        t: vp.scrollTop / sy - margin,
        r: (vp.scrollLeft + vp.clientWidth) / sx + margin,
        b: (vp.scrollTop + vp.clientHeight) / sy + margin,
      }
    }

    setWorldBounds(measure())

    let rafScheduled = false
    const scheduleBounds = () => {
      if (rafScheduled) return
      rafScheduled = true
      requestAnimationFrame(() => {
        rafScheduled = false
        setWorldBounds(measure())
      })
    }

    vp.addEventListener('scroll', scheduleBounds, { passive: true })
    const ro = new ResizeObserver(scheduleBounds)
    ro.observe(vp)
    window.addEventListener('resize', scheduleBounds)
    return () => {
      vp.removeEventListener('scroll', scheduleBounds)
      ro.disconnect()
      window.removeEventListener('resize', scheduleBounds)
    }
  }, [viewportRef, sx, sy])

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || !onViewportCenterMeters) return
    const emit = () => {
      const cx = (vp.scrollLeft + vp.clientWidth / 2) / sx
      const cy = (vp.scrollTop + vp.clientHeight / 2) / sy
      onViewportCenterMeters({
        x: worldPxToMeters(cx),
        y: worldPxToMeters(cy),
      })
    }
    emit()
    let rafScheduled = false
    const scheduleEmit = () => {
      if (rafScheduled) return
      rafScheduled = true
      requestAnimationFrame(() => {
        rafScheduled = false
        emit()
      })
    }
    vp.addEventListener('scroll', scheduleEmit, { passive: true })
    const ro = new ResizeObserver(scheduleEmit)
    ro.observe(vp)
    return () => {
      vp.removeEventListener('scroll', scheduleEmit)
      ro.disconnect()
    }
  }, [sx, sy, onViewportCenterMeters, viewportRef])

  const live = liveById ?? {}

  const getDisplayPosition = useCallback(
    (f: (typeof facilities)[0]) => {
      const eid = getMqttEntityId(f)
      const lv = live[eid]
      if (lv?.positionMeters) {
        return {
          x: metersToWorldPx(lv.positionMeters.x),
          y: metersToWorldPx(lv.positionMeters.y),
        }
      }
      return f.position
    },
    [live],
  )

  const facilitiesToRender = useMemo(() => {
    if (!worldBounds) return []
    const wb = worldBounds
    const visible = facilities.filter((f) => {
      if (selectedId !== null && f.id === selectedId) return true
      const pos = getDisplayPosition(f)
      const { fx, fy, fr, fb } = facilityWorldCullBounds(f, pos)
      return !(fr < wb.l || fx > wb.r || fb < wb.t || fy > wb.b)
    })
    if (!selectedId) return visible
    const selected = visible.find((f) => f.id === selectedId)
    if (!selected) return visible
    return [
      ...visible.filter((f) => f.id !== selectedId),
      selected,
    ]
  }, [facilities, selectedId, worldBounds, getDisplayPosition])

  /** 選取設施中心（世界單位）與公尺讀數，供十字線與標尺對齊 */
  const selectionCrosshair = useMemo(() => {
    if (interactionMode !== 'map' || !selectedId) return null
    const f = facilities.find((x) => x.id === selectedId)
    if (!f) return null
    const pos = getDisplayPosition(f)
    const { w, h } = facilityNodeWorldSize(f)
    const cx = pos.x + w / 2
    const cy = pos.y + h / 2
    return {
      cx,
      cy,
      meterX: worldPxToMeters(cx),
      meterY: worldPxToMeters(cy),
    }
  }, [facilities, selectedId, interactionMode, getDisplayPosition])

  const [isPanning, setIsPanning] = useState(false)
  const panningRef = useRef(false)
  const panStartRef = useRef({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0,
  })

  const endPan = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panningRef.current) return
    panningRef.current = false
    setIsPanning(false)
    try {
      viewportRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [viewportRef])

  const facilityReadOnly = readOnly || interactionMode === 'trajectory'

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || !onWheelZoom || interactionMode === 'trajectory') return

    const onWheel = (e: WheelEvent) => {
      if (!isCanvasZoomWheelEvent(e)) return
      e.preventDefault()
      e.stopPropagation()
      /** 與 Figma 一致：兩指外擴 → 倍率降低 → 物件放大 */
      const delta = e.deltaY * 0.004
      if (Math.abs(delta) < 1e-6) return
      onWheelZoom(delta, e.clientX, e.clientY)
    }

    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [viewportRef, onWheelZoom, interactionMode])

  const onViewportPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      const el = e.target as HTMLElement
      // 電子圍籬由 GeofenceNode 處理；未命中時仍走下方 findFacilityAtWorldPoint 後援
      if (el.closest('[data-facility]') && !el.closest('[data-geofence]')) return

      const vp = viewportRef.current
      const world = worldRef.current
      if (!vp || !world) return

      if (
        !facilityReadOnly &&
        interactionMode === 'map' &&
        facilities.length > 0
      ) {
        const p = clientToWorldCoords(e.clientX, e.clientY, world, sx, sy)
        const hit = findFacilityAtWorldPoint(
          facilities,
          getDisplayPosition,
          p.x,
          p.y,
        )
        if (hit) {
          handleSelect(hit.id)
          return
        }
      }

      handleSelect(null)
      panningRef.current = true
      setIsPanning(true)
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: vp.scrollLeft,
        scrollTop: vp.scrollTop,
      }
      vp.setPointerCapture(e.pointerId)
      e.preventDefault()
    },
    [
      facilityReadOnly,
      facilities,
      getDisplayPosition,
      handleSelect,
      interactionMode,
      sx,
      sy,
      viewportRef,
    ],
  )

  const onViewportPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!panningRef.current) return
      const vp = viewportRef.current
      if (!vp) return
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      vp.scrollLeft = panStartRef.current.scrollLeft - dx
      vp.scrollTop = panStartRef.current.scrollTop - dy
    },
    [viewportRef],
  )

  const canResize =
    !facilityReadOnly &&
    interactionMode === 'map' &&
    typeof onResizeFacility === 'function'

  const canPaletteDrop =
    !facilityReadOnly &&
    interactionMode === 'map' &&
    typeof onPaletteDrop === 'function'

  const onViewportDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!canPaletteDrop) return
      if (!e.dataTransfer.types.includes(PALETTE_DRAG_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [canPaletteDrop],
  )

  const onViewportDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!canPaletteDrop || !onPaletteDrop) return
      e.preventDefault()
      const item = decodePaletteDragItem(
        e.dataTransfer.getData(PALETTE_DRAG_MIME),
      )
      if (!item) return
      const world = worldRef.current
      if (!world) return
      const p = clientToWorldCoords(e.clientX, e.clientY, world, sx, sy)
      onPaletteDrop(item, p)
    },
    [canPaletteDrop, onPaletteDrop, sx, sy],
  )

  const viewportEl = (
    <div
      ref={viewportRef}
      className={`relative min-h-0 min-w-0 overflow-auto bg-zinc-950 ${
        showRulers ? 'h-full' : 'flex-1'
      } ${isPanning ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
      onPointerDown={onViewportPointerDown}
      onPointerMove={onViewportPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onDragOver={onViewportDragOver}
      onDrop={onViewportDrop}
      onLostPointerCapture={() => {
        panningRef.current = false
        setIsPanning(false)
      }}
    >
      <MapAuxiliaryLinesOverlay
        viewportRef={viewportRef}
        scaleX={sx}
        scaleY={sy}
      />
      <div
        className="relative z-[1]"
        style={{
          width: mapWorldW * sx,
          height: mapWorldH * sy,
        }}
      >
        <div
          ref={worldRef}
          className="absolute left-0 top-0 touch-none"
          style={{
            width: mapWorldW,
            height: mapWorldH,
            transform: `scale(${sx}, ${sy})`,
            transformOrigin: '0 0',
            backgroundColor: '#18181b',
          }}
        >
          {selectionCrosshair && (
            <div className="pointer-events-none absolute inset-0 z-[5]">
              <div
                className="absolute bg-cyan-400/35"
                style={{
                  left: selectionCrosshair.cx - 0.5,
                  top: 0,
                  width: 1,
                  height: mapWorldH,
                  boxShadow: '0 0 4px rgba(34,211,238,0.35)',
                }}
              />
              <div
                className="absolute bg-cyan-400/35"
                style={{
                  left: 0,
                  top: selectionCrosshair.cy - 0.5,
                  width: mapWorldW,
                  height: 1,
                  boxShadow: '0 0 4px rgba(34,211,238,0.35)',
                }}
              />
            </div>
          )}
          {facilitiesToRender.map((f, index) =>
            f.type === 'Geofence' ? (
              <GeofenceNode
                key={f.id}
                stackZIndex={
                  interactionMode === 'map' && selectedId === f.id
                    ? 1000
                    : 10 + index
                }
                facility={f as GeofenceFacility}
                selected={interactionMode === 'map' && selectedId === f.id}
                selectedLabelId={
                  selectedId === f.id ? geofenceSelectedLabelId : null
                }
                scaleX={sx}
                scaleY={sy}
                readOnly={facilityReadOnly}
                worldRef={worldRef}
                onSelect={handleSelect}
                onSelectLabel={
                  onSelectGeofenceLabel ??
                  (() => {
                    /* noop */
                  })
                }
                onUpdateGeofence={onUpdateGeofence}
                onGeofenceEditStart={onGeofenceEditStart}
                onDelete={
                  !facilityReadOnly &&
                  interactionMode === 'map' &&
                  selectedId === f.id &&
                  onDeleteSelected
                    ? onDeleteSelected
                    : undefined
                }
              />
            ) : (
              <FacilityNode
                key={f.id}
                stackZIndex={
                  interactionMode === 'map' && selectedId === f.id
                    ? 1000
                    : 10 + index
                }
                facility={f}
                displayPosition={getDisplayPosition(f)}
                mqttLive={live[getMqttEntityId(f)]}
                slotPreview={
                  f.type === 'Slot' &&
                  slotPreview !== null &&
                  slotPreview.facilityId === f.id
                    ? {
                        occupancy: slotPreview.occupancy,
                        equipment: slotPreview.equipment,
                      }
                    : null
                }
                selected={interactionMode === 'map' && selectedId === f.id}
                scaleX={sx}
                scaleY={sy}
                readOnly={facilityReadOnly}
                worldRef={worldRef}
                onSelect={handleSelect}
                onDrag={(id, update) => {
                  if ('areaPosition' in update) return
                  onDragFacility(id, update)
                }}
                onDragSessionStart={onDragSessionStart}
                onRotateLeft90={onRotateLeft90}
                onRotateRight90={onRotateRight90}
                onRotateDelta={onRotateDelta}
                onPatchParameters={onPatchFacilityParameters}
                onTrackCornerEditStart={onTrackCornerEditStart}
                onResize={canResize ? onResizeFacility : undefined}
                onResizeSessionStart={
                  canResize ? onResizeSessionStart : undefined
                }
                onDelete={
                  !facilityReadOnly &&
                  interactionMode === 'map' &&
                  selectedId === f.id &&
                  onDeleteSelected
                    ? onDeleteSelected
                    : undefined
                }
              />
            ),
          )}
          <TrajectoryLayer
            trajectory={trajectory}
            replayHeadIndex={trajectoryReplayHeadIndex}
          />
        </div>
      </div>
    </div>
  )

  const trajectoryHud =
    interactionMode === 'trajectory' &&
    trajectory &&
    trajectory.points.length > 0 ? (
      <TrajectoryHud
        trajectory={trajectory}
        replayHeadIndex={trajectoryReplayHeadIndex ?? null}
      />
    ) : null

  if (!showRulers) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {viewportEl}
        {trajectoryHud}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[2.25rem_1fr] grid-rows-[1.75rem_1fr] gap-px bg-zinc-700/70">
        <div
          className="min-h-0 min-w-0 bg-zinc-950"
          aria-hidden
        />
        <div className="relative min-h-0 min-w-0 overflow-hidden bg-zinc-950">
          <HorizontalRuler
            viewportRef={viewportRef}
            scaleX={scaleX}
            selectionMeterX={selectionCrosshair?.meterX ?? null}
          />
        </div>
        <div className="relative min-h-0 min-w-0 overflow-hidden bg-zinc-950">
          <VerticalRuler
            viewportRef={viewportRef}
            scaleY={scaleY}
            selectionMeterY={selectionCrosshair?.meterY ?? null}
          />
        </div>
        <div className="relative min-h-0 h-full min-w-0">
          {viewportEl}
          {trajectoryHud}
        </div>
      </div>
    </div>
  )
}
