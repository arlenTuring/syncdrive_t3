import { Paintbrush, Plus, RotateCw, Trash2 } from 'lucide-react'
import type { RefObject } from 'react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import type { GeofenceFacility } from '../types/facility'
import { metersToWorldPx, worldPxToMeters } from '../constants/map'
import { clientToWorldCoords } from '../utils/pointerCoords'
import {
  areaLocalPxToMeter,
  clientToAreaLocalPx,
  meterToAreaLocalPx,
} from '../utils/areaCoords'
import type { MapAreaDomain, MapAreaLayout } from '../types/area'
import {
  bboxWorldPx,
  bboxMeters,
  GEOFENCE_HIT_FILL,
  geofenceBboxCorner,
  getGeofenceParams,
  insertVertexOnEdge,
  isLabelInsideGeofence,
  midpointOfEdge,
  scaleGeofenceToDraggedCorner,
  strokeDashArray,
  verticesToAreaLocalPx,
  verticesToWorldPx,
  type GeofenceScaleCorner,
  type GeofenceTextLabel,
  type GeofenceVertexMeters,
} from '../utils/geofence'
import {
  resolveTextHorizontalAlign,
  resolveTextVerticalAlign,
  textHorizontalToJustify,
  textVerticalToAlignItems,
} from '../../../lib/textAlignment'
import {
  resolveLabelBoxDimensions,
  resolveTextWrapMode,
  textWrapToWhiteSpace,
} from '../../../lib/textLayout'
import {
  canApplyFacilityFormat,
  type FacilityFormatSnapshot,
} from '../utils/facilityFormatPainter'

const PAD = 20
/** 縮放拖曳啟動門檻（Area 局部 px），避免一碰就跳動 */
const SCALE_DRAG_THRESHOLD_PX = 4
/** 頂點可拖曳 hit area（不顯示，僅擴大點擊範圍） */
const VERTEX_HIT = 22
/** 頂點視覺：實心方塊，與邊中點「＋」區分 */
const VERTEX_DOT = 8

type GeofenceDraft = {
  verticesMeters: GeofenceVertexMeters[]
  labels: GeofenceTextLabel[]
}

type DragMode =
  | {
      kind: 'vertex'
      index: number
      startVerts: GeofenceVertexMeters[]
      startLabels: GeofenceTextLabel[]
    }
  | {
      kind: 'body'
      startVerts: GeofenceVertexMeters[]
      startLabels: GeofenceTextLabel[]
      ox: number
      oy: number
    }
  | {
      kind: 'label'
      id: string
      startLabels: GeofenceTextLabel[]
      ox: number
      oy: number
    }
  | {
      kind: 'rotate'
      id: string
      startLabels: GeofenceTextLabel[]
      startRot: number
      cx: number
      cy: number
      startAngle: number
    }
  | {
      kind: 'scale'
      corner: GeofenceScaleCorner
      startVerts: GeofenceVertexMeters[]
      startLabels: GeofenceTextLabel[]
      startPointerLocal: { x: number; y: number }
      startCornerMeter: GeofenceVertexMeters
    }

type GeofenceNodeProps = {
  facility: GeofenceFacility
  selected: boolean
  selectedLabelId: string | null
  readOnly: boolean
  scaleX: number
  scaleY: number
  stackZIndex: number
  worldRef: RefObject<HTMLDivElement | null>
  onSelect: (id: string) => void
  onSelectLabel: (facilityId: string, labelId: string | null) => void
  onUpdateGeofence?: (
    id: string,
    update: {
      verticesMeters?: GeofenceVertexMeters[]
      parameters?: Record<string, unknown>
    },
  ) => void
  onGeofenceEditStart?: () => void
  onDelete?: () => void
  /** Area 內：頂點為場域公尺，scale 為 px/m */
  meterMode?: boolean
  /** Map 畫布 CSS scale（Area 內座標換算用） */
  mapScale?: number
  areaMeterContext?: {
    domain: MapAreaDomain
    layout: MapAreaLayout
  }
  formatPaintSnapshot?: FacilityFormatSnapshot | null
  onStartFormatPaint?: () => void
  onFormatPaintPick?: () => void
  onCancelFormatPaint?: () => void
  /** 選取時顯示格式／刪除工具列 */
  showFacilityToolbar?: boolean
}

export const GeofenceNode = memo(function GeofenceNode({
  facility,
  selected,
  selectedLabelId,
  readOnly,
  scaleX,
  scaleY,
  stackZIndex,
  worldRef,
  onSelect,
  onSelectLabel,
  onUpdateGeofence,
  onGeofenceEditStart,
  onDelete,
  meterMode = false,
  mapScale = 1,
  areaMeterContext,
  formatPaintSnapshot = null,
  onStartFormatPaint,
  onFormatPaintPick,
  onCancelFormatPaint,
  showFacilityToolbar = true,
}: GeofenceNodeProps) {
  const params = getGeofenceParams(facility)
  const [draft, setDraft] = useState<GeofenceDraft | null>(null)

  const displayVerts = draft?.verticesMeters ?? params.verticesMeters
  const displayLabels = draft?.labels ?? params.labels

  const renderFacility = useMemo(
    (): GeofenceFacility => ({
      ...facility,
      parameters: {
        ...facility.parameters,
        verticesMeters: displayVerts,
        labels: displayLabels,
      },
    }),
    [facility, displayVerts, displayLabels],
  )

  const verticesPx = useMemo(() => {
    if (meterMode && areaMeterContext) {
      return verticesToAreaLocalPx(
        displayVerts,
        areaMeterContext.domain,
        areaMeterContext.layout,
      )
    }
    return verticesToWorldPx(displayVerts)
  }, [displayVerts, meterMode, areaMeterContext])
  const box = useMemo(() => bboxWorldPx(verticesPx), [verticesPx])
  const pointsStr = useMemo(
    () =>
      verticesPx
        .map((v) => `${v.x - box.minX + PAD},${v.y - box.minY + PAD}`)
        .join(' '),
    [verticesPx, box.minX, box.minY],
  )

  const dragModeRef = useRef<DragMode | null>(null)
  const editStartedRef = useRef(false)
  const draftRef = useRef<GeofenceDraft | null>(null)

  const wrapW = box.w + PAD * 2
  const wrapH = box.h + PAD * 2
  const wrapLeft = box.minX - PAD
  const wrapTop = box.minY - PAD

  const currentDraft = useCallback((): GeofenceDraft => {
    return {
      verticesMeters: draft?.verticesMeters ?? params.verticesMeters,
      labels: draft?.labels ?? params.labels,
    }
  }, [draft, params.verticesMeters, params.labels])

  const commitDraft = useCallback(
    (next: GeofenceDraft) => {
      onUpdateGeofence?.(facility.id, {
        verticesMeters: next.verticesMeters,
        parameters: { ...facility.parameters, labels: next.labels },
      })
    },
    [facility.id, facility.parameters, onUpdateGeofence],
  )

  const setDraftBoth = useCallback((next: GeofenceDraft | null) => {
    draftRef.current = next
    setDraft(next)
  }, [])

  const beginEdit = useCallback(() => {
    if (!editStartedRef.current) {
      editStartedRef.current = true
      onGeofenceEditStart?.()
    }
  }, [onGeofenceEditStart])

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      const mode = dragModeRef.current
      const pending = draftRef.current
      if (mode && pending && onUpdateGeofence && editStartedRef.current) {
        commitDraft(pending)
      }
      dragModeRef.current = null
      setDraftBoth(null)
      editStartedRef.current = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    },
    [commitDraft, onUpdateGeofence, setDraftBoth],
  )

  const pointerToMeter = useCallback(
    (clientX: number, clientY: number, world: HTMLDivElement) => {
      if (meterMode && areaMeterContext) {
        const local = clientToAreaLocalPx(clientX, clientY, world, mapScale)
        const m = areaLocalPxToMeter(
          local.x,
          local.y,
          areaMeterContext.domain,
          areaMeterContext.layout,
        )
        return { meter: m, localX: local.x, localY: local.y }
      }
      const p = clientToWorldCoords(clientX, clientY, world, scaleX, scaleY)
      return {
        meter: { x: worldPxToMeters(p.x), y: worldPxToMeters(p.y) },
        localX: p.x,
        localY: p.y,
      }
    },
    [meterMode, areaMeterContext, mapScale, scaleX, scaleY],
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
    : readOnly
      ? 'default'
      : 'grab'

  const tryFormatPaintPointer = useCallback(
    (e: React.PointerEvent) => {
      if (!formatPaintSnapshot) return false
      e.stopPropagation()
      e.preventDefault()
      if (formatPaintCanApply) {
        onFormatPaintPick?.()
      } else {
        onCancelFormatPaint?.()
      }
      return true
    },
    [
      formatPaintSnapshot,
      formatPaintCanApply,
      onFormatPaintPick,
      onCancelFormatPaint,
    ],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const mode = dragModeRef.current
      if (!mode) return
      if (!editStartedRef.current) {
        beginEdit()
      }
      const world = worldRef.current
      if (!world) return
      const ptr = pointerToMeter(e.clientX, e.clientY, world)

      if (mode.kind === 'vertex') {
        const nextVerts = [...mode.startVerts]
        nextVerts[mode.index] = { x: ptr.meter.x, y: ptr.meter.y }
        setDraftBoth({ verticesMeters: nextVerts, labels: mode.startLabels })
        return
      }

      if (mode.kind === 'body') {
        const startPtr = pointerToMeter(mode.ox, mode.oy, world)
        const dmx = ptr.meter.x - startPtr.meter.x
        const dmy = ptr.meter.y - startPtr.meter.y
        setDraftBoth({
          verticesMeters: mode.startVerts.map((v) => ({
            x: v.x + dmx,
            y: v.y + dmy,
          })),
          labels: mode.startLabels.map((lb) => ({
            ...lb,
            x: lb.x + dmx,
            y: lb.y + dmy,
          })),
        })
        return
      }

      if (mode.kind === 'label') {
        const baseVerts = currentDraft().verticesMeters
        if (meterMode && areaMeterContext) {
          const lx = ptr.localX - mode.ox
          const ly = ptr.localY - mode.oy
          const m = areaLocalPxToMeter(
            lx,
            ly,
            areaMeterContext.domain,
            areaMeterContext.layout,
          )
          setDraftBoth({
            verticesMeters: baseVerts,
            labels: mode.startLabels.map((lb) =>
              lb.id === mode.id ? { ...lb, x: m.x, y: m.y } : lb,
            ),
          })
          return
        }
        setDraftBoth({
          verticesMeters: baseVerts,
          labels: mode.startLabels.map((lb) =>
            lb.id === mode.id
              ? {
                  ...lb,
                  x: ptr.meter.x - mode.ox,
                  y: ptr.meter.y - mode.oy,
                }
              : lb,
          ),
        })
        return
      }

      if (mode.kind === 'rotate') {
        const ang =
          (Math.atan2(ptr.localY - mode.cy, ptr.localX - mode.cx) * 180) / Math.PI
        setDraftBoth({
          verticesMeters: currentDraft().verticesMeters,
          labels: mode.startLabels.map((lb) =>
            lb.id === mode.id
              ? {
                  ...lb,
                  rotationDeg: Math.round(mode.startRot + ang - mode.startAngle),
                }
              : lb,
          ),
        })
        return
      }

      if (mode.kind === 'scale') {
        const deltaLocalX = ptr.localX - mode.startPointerLocal.x
        const deltaLocalY = ptr.localY - mode.startPointerLocal.y
        if (
          Math.hypot(deltaLocalX, deltaLocalY) < SCALE_DRAG_THRESHOLD_PX
        ) {
          return
        }
        const pxPerMeterX = scaleX > 0 ? scaleX : 1
        const pxPerMeterY = scaleY > 0 ? scaleY : 1
        const scaled = scaleGeofenceToDraggedCorner(
          mode.startVerts,
          mode.startLabels,
          mode.corner,
          {
            x: mode.startCornerMeter.x + deltaLocalX / pxPerMeterX,
            y: mode.startCornerMeter.y + deltaLocalY / pxPerMeterY,
          },
        )
        setDraftBoth(scaled)
      }
    },
    [
      worldRef,
      beginEdit,
      currentDraft,
      setDraftBoth,
      pointerToMeter,
      scaleX,
      scaleY,
    ],
  )

  const onRootPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (tryFormatPaintPointer(e)) return
      if (e.button !== 0) return
      const target = e.target
      if (target instanceof Element) {
        if (target.closest('[data-geofence-label]')) return
        if (!readOnly && target.closest('[data-geofence-handle]')) return
        if (!readOnly && target.closest('[data-geofence-edge-add]')) return
        if (!readOnly && target.closest('[data-geofence-scale-handle]')) return
        if (!readOnly && target.closest('[data-geofence-toolbar]')) return
      }

      e.stopPropagation()
      e.preventDefault()
      onSelect(facility.id)
      onSelectLabel(facility.id, null)

      if (readOnly) return

      const world = worldRef.current
      if (!world) return
      const base = currentDraft()

      dragModeRef.current = {
        kind: 'body',
        startVerts: base.verticesMeters,
        startLabels: base.labels,
        ox: e.clientX,
        oy: e.clientY,
      }
      setDraftBoth(base)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [
      readOnly,
      onSelect,
      facility.id,
      onSelectLabel,
      worldRef,
      currentDraft,
      setDraftBoth,
      tryFormatPaintPointer,
    ],
  )

  const stopMouseBubble = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  const onVertexPointerDown = useCallback(
    (index: number, e: React.PointerEvent) => {
      if (tryFormatPaintPointer(e)) return
      if (readOnly) return
      e.stopPropagation()
      onSelect(facility.id)
      const base = currentDraft()
      dragModeRef.current = {
        kind: 'vertex',
        index,
        startVerts: base.verticesMeters,
        startLabels: base.labels,
      }
      setDraftBoth(base)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [tryFormatPaintPointer, readOnly, onSelect, facility.id, currentDraft, setDraftBoth],
  )

  const onAddVertex = useCallback(
    (edgeIndex: number, e: React.PointerEvent) => {
      if (readOnly) return
      e.stopPropagation()
      e.preventDefault()
      beginEdit()
      const base = currentDraft()
      const nextVerts = insertVertexOnEdge(base.verticesMeters, edgeIndex)
      commitDraft({ verticesMeters: nextVerts, labels: base.labels })
      editStartedRef.current = false
    },
    [readOnly, beginEdit, currentDraft, commitDraft],
  )

  const onScaleHandlePointerDown = useCallback(
    (corner: GeofenceScaleCorner, e: React.PointerEvent) => {
      if (readOnly) return
      e.stopPropagation()
      e.preventDefault()
      onSelect(facility.id)
      const base = currentDraft()
      const world = worldRef.current
      if (!world) return
      const ptr = pointerToMeter(e.clientX, e.clientY, world)
      const startBox = bboxMeters(base.verticesMeters)
      dragModeRef.current = {
        kind: 'scale',
        corner,
        startVerts: base.verticesMeters,
        startLabels: base.labels,
        startPointerLocal: { x: ptr.localX, y: ptr.localY },
        startCornerMeter: geofenceBboxCorner(startBox, corner),
      }
      setDraftBoth(base)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [readOnly, onSelect, facility.id, currentDraft, setDraftBoth, worldRef, pointerToMeter],
  )

  const scaleCornerPx = useMemo(
    (): Record<GeofenceScaleCorner, { x: number; y: number; cursor: string }> => ({
      nw: { x: box.minX, y: box.minY, cursor: 'nwse-resize' },
      ne: { x: box.maxX, y: box.minY, cursor: 'nesw-resize' },
      se: { x: box.maxX, y: box.maxY, cursor: 'nwse-resize' },
      sw: { x: box.minX, y: box.maxY, cursor: 'nesw-resize' },
    }),
    [box.minX, box.minY, box.maxX, box.maxY],
  )

  const labelAnchorPx = useCallback(
    (lb: GeofenceTextLabel) => {
      if (meterMode && areaMeterContext) {
        return meterToAreaLocalPx(
          lb.x,
          lb.y,
          areaMeterContext.domain,
          areaMeterContext.layout,
        )
      }
      return { x: metersToWorldPx(lb.x), y: metersToWorldPx(lb.y) }
    },
    [meterMode, areaMeterContext],
  )

  const labelRotateCenterPx = useCallback(
    (lb: GeofenceTextLabel) => {
      const a = labelAnchorPx(lb)
      const w = Math.max(24, lb.text.length * lb.fontSizePx * 0.55)
      const h = lb.fontSizePx * 1.35
      return { x: a.x + w / 2, y: a.y + h / 2 }
    },
    [labelAnchorPx],
  )

  const dash = strokeDashArray(params.strokeStyle, params.strokeWidthPx)

  return (
    <div
      data-facility
      data-geofence
      className="pointer-events-none absolute left-0 top-0 touch-none select-none"
      style={{
        transform: `translate(${wrapLeft}px, ${wrapTop}px)`,
        width: wrapW,
        height: wrapH,
        zIndex: stackZIndex,
      }}
    >
      <svg
        className="absolute left-0 top-0 overflow-visible"
        width={wrapW}
        height={wrapH}
        onMouseDown={stopMouseBubble}
      >
        <polygon
          points={pointsStr}
          fill={params.fillEnabled ? params.resolvedFillColor : GEOFENCE_HIT_FILL}
          stroke="none"
          style={{
            pointerEvents: readOnly ? 'none' : 'auto',
            cursor: formatPaintCursor,
          }}
          onPointerDown={readOnly ? undefined : onRootPointerDown}
          onPointerMove={readOnly ? undefined : onPointerMove}
          onPointerUp={readOnly ? undefined : endDrag}
          onPointerCancel={readOnly ? undefined : endDrag}
        />
        <polygon
          points={pointsStr}
          fill={params.fillEnabled ? params.resolvedFillColor : 'transparent'}
          stroke={params.strokeColor}
          strokeWidth={params.strokeWidthPx}
          strokeDasharray={dash}
          strokeLinejoin="round"
          strokeLinecap="round"
          pointerEvents="none"
          className={
            selected && !readOnly
              ? 'drop-shadow-[0_0_6px_rgba(34,211,238,0.35)]'
              : ''
          }
        />
      </svg>

      {selected &&
        !readOnly &&
        verticesPx.length >= 2 &&
        verticesPx.map((_, i) => {
          const mid = midpointOfEdge(verticesPx, i)
          return (
            <button
              key={`edge-add-${i}`}
              type="button"
              data-geofence-edge-add
              className="pointer-events-auto absolute z-[72] flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-300/90 bg-zinc-950/95 text-cyan-200 shadow-[0_0_6px_rgba(34,211,238,0.45)] ring-1 ring-cyan-400/30 hover:border-cyan-200 hover:bg-cyan-950 hover:text-white"
              style={{
                left: mid.x - wrapLeft,
                top: mid.y - wrapTop,
              }}
              title="在此邊新增頂點"
              onPointerDown={(e) => onAddVertex(i, e)}
            >
              <Plus className="size-3.5" strokeWidth={2.75} aria-hidden />
            </button>
          )
        })}

      {selected &&
        !readOnly &&
        verticesPx.map((v, i) => (
          <div
            key={`v-${i}`}
            data-geofence-handle
            role="presentation"
            className="pointer-events-auto absolute z-[75] -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing"
            style={{ left: v.x - wrapLeft, top: v.y - wrapTop }}
            onPointerDown={(e) => onVertexPointerDown(i, e)}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ width: VERTEX_HIT, height: VERTEX_HIT }}
            />
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-white bg-cyan-400 shadow-sm"
              style={{ width: VERTEX_DOT, height: VERTEX_DOT }}
            />
          </div>
        ))}

      {selected &&
        !readOnly &&
        (Object.entries(scaleCornerPx) as [GeofenceScaleCorner, { x: number; y: number; cursor: string }][]).map(
          ([corner, pos]) => (
            <div
              key={`scale-${corner}`}
              data-geofence-scale-handle
              role="presentation"
              className="pointer-events-auto absolute z-[78] -translate-x-1/2 -translate-y-1/2"
              style={{
                left: pos.x - wrapLeft,
                top: pos.y - wrapTop,
                cursor: pos.cursor,
              }}
              title="拖曳以縮放圍籬"
              onPointerDown={(e) => onScaleHandlePointerDown(corner, e)}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <div
                className="size-3.5 rounded-sm border-2 border-white bg-amber-400 shadow-sm"
                aria-hidden
              />
            </div>
          ),
        )}

      {displayLabels.map((lb) => {
        const anchor = labelAnchorPx(lb)
        return (
        <GeofenceLabelView
          key={lb.id}
          label={lb}
          left={anchor.x - wrapLeft}
          top={anchor.y - wrapTop}
          invalid={!isLabelInsideGeofence(renderFacility, lb)}
          selected={selectedLabelId === lb.id}
          readOnly={readOnly}
          facilityId={facility.id}
          onSelect={onSelect}
          onSelectLabel={onSelectLabel}
          onBeginLabelDrag={(e, label) => {
            if (readOnly) return
            e.stopPropagation()
            onSelect(facility.id)
            onSelectLabel(facility.id, label.id)
            const base = currentDraft()
            const world = worldRef.current
            if (!world) return
            const ptr = pointerToMeter(e.clientX, e.clientY, world)
            const anchor = labelAnchorPx(label)
            dragModeRef.current = {
              kind: 'label',
              id: label.id,
              startLabels: base.labels,
              ox: ptr.localX - anchor.x,
              oy: ptr.localY - anchor.y,
            }
            setDraftBoth(base)
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          }}
          onBeginRotate={(e, label) => {
            if (readOnly) return
            e.stopPropagation()
            const base = currentDraft()
            const world = worldRef.current
            if (!world) return
            const ptr = pointerToMeter(e.clientX, e.clientY, world)
            const c = labelRotateCenterPx(label)
            dragModeRef.current = {
              kind: 'rotate',
              id: label.id,
              startLabels: base.labels,
              startRot: label.rotationDeg,
              cx: c.x,
              cy: c.y,
              startAngle: (Math.atan2(ptr.localY - c.y, ptr.localX - c.x) * 180) / Math.PI,
            }
            setDraftBoth(base)
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          }}
          onPointerMove={onPointerMove}
          onPointerEnd={endDrag}
        />
        )
      })}

      {selected && !readOnly && showFacilityToolbar && (onStartFormatPaint || onDelete) && (
        <div
          data-geofence-toolbar
          className="pointer-events-auto absolute -top-9 right-0 z-[5020] flex gap-1"
        >
          {onStartFormatPaint && (
            <button
              type="button"
              className="rounded border border-violet-700/80 bg-violet-950/90 p-1 text-violet-200 hover:bg-violet-900"
              title="複製格式（大小、角度、框線、填色、字級；僅可貼到相同圍籬）"
              onClick={(e) => {
                e.stopPropagation()
                onStartFormatPaint()
              }}
            >
              <Paintbrush className="size-3.5" />
            </button>
          )}
          {onDelete && (
          <button
            type="button"
            className="rounded border border-red-800/80 bg-red-950/90 p-1 text-red-300 hover:bg-red-900"
            title="刪除圍籬"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 className="size-3.5" />
          </button>
          )}
        </div>
      )}
    </div>
  )
})

type LabelViewProps = {
  label: GeofenceTextLabel
  left: number
  top: number
  invalid: boolean
  selected: boolean
  readOnly: boolean
  facilityId: string
  onSelect: (id: string) => void
  onSelectLabel: (facilityId: string, labelId: string | null) => void
  onBeginLabelDrag: (e: React.PointerEvent, lb: GeofenceTextLabel) => void
  onBeginRotate: (e: React.PointerEvent, lb: GeofenceTextLabel) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerEnd: (e: React.PointerEvent) => void
}

function GeofenceLabelView({
  label,
  left,
  top,
  invalid,
  selected,
  readOnly,
  facilityId,
  onSelect,
  onSelectLabel,
  onBeginLabelDrag,
  onBeginRotate,
  onPointerMove,
  onPointerEnd,
}: LabelViewProps) {
  const labelChrome = readOnly
    ? ''
    : invalid
      ? 'rounded border-2 border-red-500 bg-red-950/40'
      : selected
        ? 'rounded border-2 border-cyan-400 bg-zinc-900/80'
        : 'rounded border border-transparent bg-zinc-900/50'

  if (readOnly && !label.text.trim()) return null

  const textAlign = resolveTextHorizontalAlign(label.textAlign)
  const verticalAlign = resolveTextVerticalAlign(label.verticalAlign)
  const textWrap = resolveTextWrapMode(label.textWrap)
  const boxDims = resolveLabelBoxDimensions({
    fontSize: label.fontSizePx,
    facilityBoxW: 320,
    customWidth: label.labelBoxWidthPx,
    customHeight: label.labelBoxHeightPx,
    textWrap,
    maxWidth: 480,
  })
  const whiteSpace = textWrapToWhiteSpace(textWrap)

  return (
    <div
      data-geofence-label
      className={`absolute z-[65] px-1 py-0.5 ${labelChrome} ${
        readOnly ? '' : 'cursor-grab active:cursor-grabbing'
      }`}
      style={{
        left,
        top,
        width: boxDims.width,
        height: boxDims.height,
        minWidth: boxDims.minWidth,
        maxWidth: boxDims.maxWidth,
        transform: `rotate(${label.rotationDeg}deg)`,
        transformOrigin: 'top left',
        fontSize: label.fontSizePx,
        fontWeight: label.fontWeight,
        color: readOnly ? '#e4e4e7' : invalid ? '#fca5a5' : '#e4e4e7',
        pointerEvents: readOnly ? 'none' : 'auto',
        display: 'flex',
        alignItems: textVerticalToAlignItems(verticalAlign),
        justifyContent: textHorizontalToJustify(textAlign),
        textAlign,
        whiteSpace,
        overflow: textWrap === 'single' ? 'hidden' : undefined,
        textOverflow: textWrap === 'single' ? 'ellipsis' : undefined,
      }}
      onPointerDown={
        readOnly
          ? undefined
          : (e) => {
              e.stopPropagation()
              onSelect(facilityId)
              onSelectLabel(facilityId, label.id)
              onBeginLabelDrag(e, label)
            }
      }
      onMouseDown={readOnly ? undefined : (e) => e.stopPropagation()}
      onPointerMove={readOnly ? undefined : onPointerMove}
      onPointerUp={readOnly ? undefined : onPointerEnd}
      onPointerCancel={readOnly ? undefined : onPointerEnd}
    >
      {label.text || (readOnly ? '' : '文字')}
      {selected && !readOnly && (
        <button
          type="button"
          className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full border border-cyan-500 bg-zinc-900 text-cyan-300"
          title="旋轉文字"
          onPointerDown={(e) => onBeginRotate(e, label)}
        >
          <RotateCw className="size-2.5" />
        </button>
      )}
    </div>
  )
}
