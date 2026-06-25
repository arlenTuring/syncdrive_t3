import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { MapAreaObject, MapPixelSize } from '../types/area'
import {
  cursorForMapPixelEdge,
  MAP_PIXEL_FRAME_TRACK_PX,
  mapPixelSizeFromEdgeDrag,
  minMapPixelSizeFromAreas,
  type MapPixelResizeEdge,
} from '../utils/mapPixelResize'

type Props = {
  pixelSize: MapPixelSize
  areas: MapAreaObject[]
  active: boolean
  mapScale: number
  onSessionStart?: () => void
  onLiveChange?: (result: {
    pixelSize: MapPixelSize
    areaOffsetPx: { dx: number; dy: number }
  }) => void
  onCommit: (result: {
    pixelSize: MapPixelSize
    areaOffsetPx: { dx: number; dy: number }
  }) => void
}

const trackBase =
  'pointer-events-auto absolute z-[6000] transition-colors duration-150'

function trackColors(active: boolean) {
  return {
    background: active
      ? 'rgba(251, 191, 36, 0.14)'
      : 'rgba(251, 191, 36, 0.07)',
    borderColor: active
      ? 'rgba(251, 191, 36, 0.5)'
      : 'rgba(251, 191, 36, 0.28)',
  }
}

/** 監控畫布外框：拖曳邊／角調整 pixelSize（解析度） */
export function MapPixelFrameOverlay({
  pixelSize,
  areas,
  active,
  mapScale,
  onSessionStart,
  onLiveChange,
  onCommit,
}: Props) {
  const t = MAP_PIXEL_FRAME_TRACK_PX
  const colors = trackColors(active)
  const minSize = minMapPixelSizeFromAreas(areas)

  const dragRef = useRef<{
    edge: MapPixelResizeEdge
    startX: number
    startY: number
    startSize: MapPixelSize
  } | null>(null)
  const pendingResultRef = useRef<ReturnType<typeof mapPixelSizeFromEdgeDrag> | null>(
    null,
  )
  const sessionStartedRef = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [liveSize, setLiveSize] = useState<MapPixelSize | null>(null)
  const displaySize = liveSize ?? pixelSize

  const clearWindowListeners = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
  }, [])

  const finishDrag = useCallback(
    (commit: boolean) => {
      clearWindowListeners()
      const pending = pendingResultRef.current
      dragRef.current = null
      pendingResultRef.current = null
      setLiveSize(null)
      if (commit && pending) onCommit(pending)
      sessionStartedRef.current = false
    },
    [clearWindowListeners, onCommit],
  )

  useEffect(() => () => finishDrag(false), [finishDrag])

  const applyPointer = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current
      if (!drag) return
      const scale = Math.max(0.01, mapScale)
      const dx = (clientX - drag.startX) / scale
      const dy = (clientY - drag.startY) / scale
      const result = mapPixelSizeFromEdgeDrag(
        drag.startSize,
        drag.edge,
        dx,
        dy,
        minSize,
      )
      pendingResultRef.current = result
      setLiveSize(result.pixelSize)
      onLiveChange?.(result)
    },
    [mapScale, minSize, onLiveChange],
  )

  const onResizeDown =
    (edge: MapPixelResizeEdge) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      if (!sessionStartedRef.current) {
        sessionStartedRef.current = true
        onSessionStart?.()
      }
      dragRef.current = {
        edge,
        startX: e.clientX,
        startY: e.clientY,
        startSize: { ...pixelSize },
      }
      pendingResultRef.current = null
      setLiveSize({ ...pixelSize })

      const onMove = (ev: PointerEvent) => applyPointer(ev.clientX, ev.clientY)
      const onUp = () => finishDrag(true)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
    }

  const dw = displaySize.width
  const dh = displaySize.height

  const corners: { edge: MapPixelResizeEdge; left: number; top: number }[] = [
    { edge: 'tl', left: -t, top: -t },
    { edge: 'tr', left: dw, top: -t },
    { edge: 'bl', left: -t, top: dh },
    { edge: 'br', left: dw, top: dh },
  ]

  const edges: {
    edge: MapPixelResizeEdge
    style: CSSProperties
    title: string
  }[] = [
    {
      edge: 'top',
      title: '拖曳調整畫布高度（上）',
      style: {
        left: -t,
        top: -t,
        width: dw + t * 2,
        height: t,
        borderBottom: `1px solid ${colors.borderColor}`,
        cursor: 'ns-resize',
      },
    },
    {
      edge: 'bottom',
      title: '拖曳調整畫布高度（下）',
      style: {
        left: -t,
        top: dh,
        width: dw + t * 2,
        height: t,
        borderTop: `1px solid ${colors.borderColor}`,
        cursor: 'ns-resize',
      },
    },
    {
      edge: 'left',
      title: '拖曳調整畫布寬度（左）',
      style: {
        left: -t,
        top: 0,
        width: t,
        height: dh,
        borderRight: `1px solid ${colors.borderColor}`,
        cursor: 'ew-resize',
      },
    },
    {
      edge: 'right',
      title: '拖曳調整畫布寬度（右）',
      style: {
        left: dw,
        top: 0,
        width: t,
        height: dh,
        borderLeft: `1px solid ${colors.borderColor}`,
        cursor: 'ew-resize',
      },
    },
  ]

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-[5990]"
      style={{ width: dw, height: dh }}
      aria-hidden={!active}
    >
      <div
        className="pointer-events-none absolute inset-0 border border-amber-500/35"
        style={{
          boxShadow: active ? '0 0 0 1px rgba(251,191,36,0.2)' : undefined,
        }}
      />
      {active ? (
        <>
          {edges.map(({ edge, style, title }) => (
            <div
              key={edge}
              data-map-pixel-frame-edge
              className={trackBase}
              style={{
                ...style,
                background: colors.background,
                pointerEvents: 'auto',
              }}
              onPointerDown={onResizeDown(edge)}
              title={title}
            />
          ))}
          {corners.map(({ edge, left, top }) => (
            <div
              key={edge}
              data-map-pixel-frame-corner
              className={`${trackBase} rounded-sm`}
              style={{
                left,
                top,
                width: t,
                height: t,
                background: active
                  ? 'rgba(251, 191, 36, 0.35)'
                  : 'rgba(251, 191, 36, 0.2)',
                border: `1px solid ${colors.borderColor}`,
                cursor: cursorForMapPixelEdge(edge),
                pointerEvents: 'auto',
                zIndex: 6001,
              }}
              onPointerDown={onResizeDown(edge)}
              title="拖曳調整畫布解析度（寬×高）"
            />
          ))}
          <div className="pointer-events-none absolute left-2 top-2 z-[6002] rounded bg-amber-950/80 px-2 py-0.5 font-mono text-[10px] text-amber-200/90">
            畫布 {Math.round(dw)}×{Math.round(dh)} px
          </div>
        </>
      ) : null}
    </div>
  )
}
