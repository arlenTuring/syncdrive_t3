import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { MapPixelSize } from '../types/area'
import {
  cropRectFromDrag,
  cursorForCropEdge,
  type MapCropRect,
  type MapCropResizeEdge,
} from '../utils/mapCropMode'
import { useTranslation } from 'react-i18next'

/** 螢幕上希望至少多寬（px），會依 mapScale 放大命中區 */
const EDGE_HIT_SCREEN_PX = 14
const CORNER_HIT_SCREEN_PX = 16

type Props = {
  workspace: MapPixelSize
  mapOffset: { x: number; y: number }
  contentExtent: MapPixelSize
  cropRect: MapCropRect
  mapScale: number
  onCropRectChange: (rect: MapCropRect) => void
}

export function MapCropModeOverlay({
  workspace,
  mapOffset,
  contentExtent,
  cropRect,
  mapScale,
  onCropRectChange,
}: Props) {
  const { t } = useTranslation()
  const mapScaleRef = useRef(mapScale)
  mapScaleRef.current = mapScale

  const dragRef = useRef<{
    edge: MapCropResizeEdge
    startX: number
    startY: number
    startCrop: MapCropRect
  } | null>(null)
  const liveCropRef = useRef<MapCropRect | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [liveCrop, setLiveCrop] = useState<MapCropRect | null>(null)
  const display = liveCrop ?? cropRect

  const hitPx = useCallback(
    (screenPx: number) => Math.max(screenPx / Math.max(0.05, mapScale), 8),
    [mapScale],
  )
  const edgeHit = hitPx(EDGE_HIT_SCREEN_PX)
  const cornerHit = hitPx(CORNER_HIT_SCREEN_PX)
  const labelScreenScale = 1 / Math.max(0.05, mapScale)

  const clearListeners = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
  }, [])

  const commitCrop = useCallback(
    (rect: MapCropRect | null) => {
      if (rect) onCropRectChange(rect)
    },
    [onCropRectChange],
  )

  const finishDrag = useCallback(
    (commit: boolean, finalRect?: MapCropRect | null) => {
      clearListeners()
      const pending = finalRect ?? liveCropRef.current
      dragRef.current = null
      liveCropRef.current = null
      setLiveCrop(null)
      if (commit && pending) commitCrop(pending)
    },
    [clearListeners, commitCrop],
  )

  useEffect(() => () => finishDrag(false), [finishDrag])

  const resolveCropFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current
      if (!drag) return null
      const scale = Math.max(0.05, mapScaleRef.current)
      const dx = (clientX - drag.startX) / scale
      const dy = (clientY - drag.startY) / scale
      return cropRectFromDrag(
        drag.startCrop,
        drag.edge,
        dx,
        dy,
        workspace,
      )
    },
    [workspace],
  )

  const applyPointer = useCallback(
    (clientX: number, clientY: number) => {
      const next = resolveCropFromPointer(clientX, clientY)
      if (!next) return
      liveCropRef.current = next
      setLiveCrop(next)
    },
    [resolveCropFromPointer],
  )

  const onPointerDown =
    (edge: MapCropResizeEdge) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      const el = e.currentTarget
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      dragRef.current = {
        edge,
        startX: e.clientX,
        startY: e.clientY,
        startCrop: { ...display },
      }
      liveCropRef.current = { ...display }
      setLiveCrop({ ...display })

      const pointerId = e.pointerId
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        applyPointer(ev.clientX, ev.clientY)
      }
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        const final = resolveCropFromPointer(ev.clientX, ev.clientY)
        try {
          el.releasePointerCapture(pointerId)
        } catch {
          /* ignore */
        }
        finishDrag(true, final)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
    }

  const { x, y, width: cw, height: ch } = display
  const wsW = workspace.width
  const wsH = workspace.height
  const viewW = cropRect.width
  const viewH = cropRect.height
  const isStretched =
    cw > viewW + 1 || ch > viewH + 1
  const isShrunk =
    cw < viewW - 1 || ch < viewH - 1

  const dim = 'rgba(0,0,0,0.55)'
  const masks: { style: CSSProperties }[] = [
    { style: { left: 0, top: 0, width: wsW, height: y } },
    { style: { left: 0, top: y + ch, width: wsW, height: wsH - y - ch } },
    { style: { left: 0, top: y, width: x, height: ch } },
    { style: { left: x + cw, top: y, width: wsW - x - cw, height: ch } },
  ]

  const edges: {
    edge: MapCropResizeEdge
    style: CSSProperties
    title: string
  }[] = [
    {
      edge: 'top',
      title: t('mapEditor.cropMode.edgeTop'),
      style: {
        left: x,
        top: y - edgeHit,
        width: cw,
        height: edgeHit,
        cursor: 'ns-resize',
      },
    },
    {
      edge: 'bottom',
      title: t('mapEditor.cropMode.edgeBottom'),
      style: {
        left: x,
        top: y + ch,
        width: cw,
        height: edgeHit,
        cursor: 'ns-resize',
      },
    },
    {
      edge: 'left',
      title: t('mapEditor.cropMode.edgeLeft'),
      style: {
        left: x - edgeHit,
        top: y,
        width: edgeHit,
        height: ch,
        cursor: 'ew-resize',
      },
    },
    {
      edge: 'right',
      title: t('mapEditor.cropMode.edgeRight'),
      style: {
        left: x + cw,
        top: y,
        width: edgeHit,
        height: ch,
        cursor: 'ew-resize',
      },
    },
  ]

  const corners: { edge: MapCropResizeEdge; left: number; top: number }[] = [
    { edge: 'tl', left: x - cornerHit, top: y - cornerHit },
    { edge: 'tr', left: x + cw, top: y - cornerHit },
    { edge: 'bl', left: x - cornerHit, top: y + ch },
    { edge: 'br', left: x + cw, top: y + ch },
  ]

  return (
    <div
      className="absolute left-0 top-0 z-[20000]"
      style={{ width: wsW, height: wsH, pointerEvents: 'none' }}
      data-map-crop-overlay
    >
      {masks.map((m, i) => (
        <div
          key={i}
          className="absolute"
          style={{ ...m.style, background: dim, pointerEvents: 'none' }}
        />
      ))}

      <div
        className="absolute border border-dashed border-zinc-500/50"
        style={{
          left: mapOffset.x,
          top: mapOffset.y,
          width: contentExtent.width,
          height: contentExtent.height,
          pointerEvents: 'none',
        }}
        title={t('mapEditor.cropMode.contentExtent')}
      />

      <div
        className="absolute border-2 border-amber-400 shadow-[0_0_0_1px_rgba(251,191,36,0.4)]"
        style={{
          left: x,
          top: y,
          width: cw,
          height: ch,
          pointerEvents: 'none',
        }}
      >
        <div
          className="absolute left-2 top-2 rounded-md border border-amber-600/50 bg-amber-950/95 px-3 py-1.5 font-mono text-amber-50 shadow-md"
          style={{
            transform: `scale(${labelScreenScale})`,
            transformOrigin: 'top left',
          }}
        >
          <span className="text-xs font-medium text-amber-200/90">{t('mapEditor.cropMode.outputResolution')}</span>
          <div className="mt-0.5 text-lg font-semibold leading-none tracking-tight tabular-nums">
            {Math.round(cw)}×{Math.round(ch)}
            <span className="ml-1 text-sm font-medium text-amber-200/80">px</span>
          </div>
          {isStretched || isShrunk ? (
            <span className="mt-1 block text-xs text-amber-300/80">
              {isStretched ? t('mapEditor.cropMode.stretched') : t('mapEditor.cropMode.cropped')}
            </span>
          ) : null}
        </div>
        <p className="absolute bottom-2 left-2 max-w-[90%] text-[9px] leading-snug text-amber-200/70">
          {t('mapEditor.cropMode.dragHint')}
        </p>
      </div>

      {edges.map(({ edge, style, title }) => (
        <div
          key={edge}
          data-map-crop-edge
          className="absolute bg-amber-500/30 hover:bg-amber-500/45"
          style={{ ...style, pointerEvents: 'auto', touchAction: 'none' }}
          onPointerDown={onPointerDown(edge)}
          title={title}
        />
      ))}
      {corners.map(({ edge, left, top }) => (
        <div
          key={edge}
          data-map-crop-corner
          className="absolute rounded-sm border-2 border-amber-300 bg-amber-500/60 hover:bg-amber-400/70"
          style={{
            left,
            top,
            width: cornerHit,
            height: cornerHit,
            cursor: cursorForCropEdge(edge),
            pointerEvents: 'auto',
            touchAction: 'none',
            zIndex: 20001,
          }}
          onPointerDown={onPointerDown(edge)}
          title={t('mapEditor.cropMode.cornerTitle')}
        />
      ))}

      <div
        className="absolute bottom-2 right-2 rounded bg-zinc-950/85 px-2 py-1 font-mono text-[10px] text-zinc-400"
        style={{ pointerEvents: 'none' }}
      >
        {t('mapEditor.cropMode.workspaceStats', { wsW, wsH, cW: contentExtent.width, cH: contentExtent.height })}
      </div>
    </div>
  )
}
