import { useCallback, useMemo, useRef, type CSSProperties } from 'react'
import { Grid2x2 } from 'lucide-react'
import type {
  BasemapLockedResizeHandle,
  BasemapNormRect,
  BasemapPartition,
  BasemapSharedDivider,
} from '../utils/basemapPartition'
import {
  collectSharedPartitionDividers,
  getBasemapCellNormRect,
  isBasemapPartitionConfirmed,
  partitionCellsToPx,
} from '../utils/basemapPartition'

const DIVIDER_HIT_PX = 6
const HANDLE_SCREEN_PX = 12
const EDGE_HIT_SCREEN_PX = 10

type Props = {
  partition: BasemapPartition
  widthPx: number
  heightPx: number
  mapScale: number
  selectedCellId: string | null
  readOnly?: boolean
  onCellSelect?: (cellId: string) => void
  onDividerDrag: (divider: BasemapSharedDivider, localX: number, localY: number) => void
  onDividerSessionStart?: () => void
  onLockedCellResize: (
    cellId: string,
    handle: BasemapLockedResizeHandle,
    originRect: BasemapNormRect,
    totalDxNorm: number,
    totalDyNorm: number,
  ) => void
  onLockedResizeSessionStart?: () => void
}

const CORNER_HANDLES: {
  handle: BasemapLockedResizeHandle
  cursor: string
  style: (w: number, h: number, handlePx: number) => CSSProperties
}[] = [
  {
    handle: 'nw',
    cursor: 'nwse-resize',
    style: (_w, _h, t) => ({ left: -t / 2, top: -t / 2 }),
  },
  {
    handle: 'ne',
    cursor: 'nesw-resize',
    style: (w, _h, t) => ({ left: w - t / 2, top: -t / 2 }),
  },
  {
    handle: 'sw',
    cursor: 'nesw-resize',
    style: (_w, h, t) => ({ left: -t / 2, top: h - t / 2 }),
  },
  {
    handle: 'se',
    cursor: 'nwse-resize',
    style: (w, h, t) => ({ left: w - t / 2, top: h - t / 2 }),
  },
]

const EDGE_HANDLES: {
  handle: BasemapLockedResizeHandle
  cursor: string
  style: (w: number, h: number, edge: number) => CSSProperties
}[] = [
  {
    handle: 'n',
    cursor: 'ns-resize',
    style: (w, _h, edge) => ({ left: 0, top: -edge / 2, width: w, height: edge }),
  },
  {
    handle: 's',
    cursor: 'ns-resize',
    style: (w, h, edge) => ({ left: 0, top: h - edge / 2, width: w, height: edge }),
  },
  {
    handle: 'w',
    cursor: 'ew-resize',
    style: (_w, h, edge) => ({ left: -edge / 2, top: 0, width: edge, height: h }),
  },
  {
    handle: 'e',
    cursor: 'ew-resize',
    style: (w, h, edge) => ({ left: w - edge / 2, top: 0, width: edge, height: h }),
  },
]

export function BasemapCellOverlay({
  partition,
  widthPx,
  heightPx,
  mapScale,
  selectedCellId,
  readOnly = false,
  onCellSelect,
  onDividerDrag,
  onDividerSessionStart,
  onLockedCellResize,
  onLockedResizeSessionStart,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const scale = Math.max(0.01, mapScale)
  const hitPad = DIVIDER_HIT_PX / scale
  const handlePx = Math.max(HANDLE_SCREEN_PX / scale, 8)
  const edgeHitPx = Math.max(EDGE_HIT_SCREEN_PX / scale, 6)
  const cutsConfirmed = isBasemapPartitionConfirmed(partition)

  const leafRects = useMemo(
    () => partitionCellsToPx(partition, widthPx, heightPx),
    [partition, widthPx, heightPx],
  )

  const structuralCells = useMemo(
    () =>
      cutsConfirmed
        ? []
        : leafRects.filter((cell) => {
            const meta = partition.cells.find((c) => c.id === cell.id)
            return meta && !meta.locked
          }),
    [cutsConfirmed, leafRects, partition.cells],
  )

  const independentCells = useMemo(
    () =>
      cutsConfirmed
        ? leafRects
        : leafRects.filter((cell) => {
            const meta = partition.cells.find((c) => c.id === cell.id)
            return meta?.locked
          }),
    [cutsConfirmed, leafRects, partition.cells],
  )

  const dividers = useMemo(
    () => collectSharedPartitionDividers(partition, widthPx, heightPx),
    [partition, widthPx, heightPx],
  )

  const showMultiCell = leafRects.length > 1

  const toNorm = useCallback((clientX: number, clientY: number) => {
    const el = overlayRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return {
      x: (clientX - r.left) / Math.max(1, r.width),
      y: (clientY - r.top) / Math.max(1, r.height),
    }
  }, [])

  const onDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, divider: BasemapSharedDivider) => {
      if (e.button !== 0 || readOnly) return
      e.stopPropagation()
      e.preventDefault()
      let historyStarted = false

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return
        const el = overlayRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const lx = (ev.clientX - r.left) / scale
        const ly = (ev.clientY - r.top) / scale
        if (!historyStarted) {
          historyStarted = true
          onDividerSessionStart?.()
        }
        onDividerDrag(divider, lx, ly)
      }

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [onDividerDrag, onDividerSessionStart, readOnly, scale],
  )

  const onResizeHandlePointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      cellId: string,
      handle: BasemapLockedResizeHandle,
    ) => {
      if (e.button !== 0 || readOnly) return
      e.stopPropagation()
      e.preventDefault()
      const meta = partition.cells.find((c) => c.id === cellId)
      if (!meta) return
      if (!cutsConfirmed && !meta.locked) return
      const originRect = getBasemapCellNormRect(partition, meta)
      const startNorm = toNorm(e.clientX, e.clientY)
      let historyStarted = false

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return
        const cur = toNorm(ev.clientX, ev.clientY)
        const totalDxNorm = cur.x - startNorm.x
        const totalDyNorm = cur.y - startNorm.y
        if (totalDxNorm === 0 && totalDyNorm === 0) return
        if (!historyStarted) {
          historyStarted = true
          onLockedResizeSessionStart?.()
        }
        onLockedCellResize(cellId, handle, originRect, totalDxNorm, totalDyNorm)
      }

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [
      cutsConfirmed,
      onLockedCellResize,
      onLockedResizeSessionStart,
      partition,
      readOnly,
      toNorm,
    ],
  )

  const renderCellChrome = (
    cell: (typeof leafRects)[number],
    layer: 'structural' | 'independent',
  ) => {
    const isSelected = selectedCellId === cell.id
    const isIndependent = layer === 'independent'
    const canResize = isIndependent && isSelected && !readOnly
    const pointerClass =
      isIndependent && !readOnly ? 'pointer-events-auto' : 'pointer-events-none'

    return (
      <div
        key={cell.id}
        data-basemap-cell={cell.id}
        data-basemap-cell-pinned={isIndependent ? 'true' : undefined}
        className={`absolute box-border transition-colors ${pointerClass} ${
          isSelected
            ? isIndependent
              ? 'border-2 border-violet-400/95 bg-violet-400/8'
              : 'border-2 border-amber-400/90 bg-amber-400/5'
            : isIndependent
              ? 'border border-violet-400/45 bg-violet-400/5'
              : 'border border-dashed border-cyan-400/20'
        }`}
        style={{
          left: cell.x,
          top: cell.y,
          width: cell.w,
          height: cell.h,
        }}
        onPointerDown={
          isIndependent && !readOnly
            ? (e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                onCellSelect?.(cell.id)
              }
            : undefined
        }
      >
        {showMultiCell ? (
          <span className="pointer-events-none absolute left-1 top-1 flex items-center gap-0.5 rounded bg-zinc-950/70 px-1 py-0.5 font-mono text-[9px] text-zinc-400/80">
            {isIndependent ? (
              <Grid2x2 className="size-2.5 text-violet-300/90" />
            ) : null}
            {cell.id}
          </span>
        ) : null}

        {canResize ? (
          <>
            {EDGE_HANDLES.map(({ handle, cursor, style }) => (
              <div
                key={`edge-${handle}`}
                data-basemap-cell-resize-handle
                data-basemap-cell-resize-edge={handle}
                className="pointer-events-auto absolute z-[6000]"
                style={{ cursor, ...style(cell.w, cell.h, edgeHitPx) }}
                onPointerDown={(ev) =>
                  onResizeHandlePointerDown(ev, cell.id, handle)
                }
              />
            ))}
            {CORNER_HANDLES.map(({ handle, cursor, style }) => (
              <div
                key={`corner-${handle}`}
                data-basemap-cell-resize-handle
                data-basemap-cell-resize-corner={handle}
                className="pointer-events-auto absolute z-[6001] rounded-sm border border-violet-300/90 bg-violet-200/95 shadow"
                style={{
                  width: handlePx,
                  height: handlePx,
                  cursor,
                  ...style(cell.w, cell.h, handlePx),
                }}
                onPointerDown={(ev) =>
                  onResizeHandlePointerDown(ev, cell.id, handle)
                }
              />
            ))}
          </>
        ) : null}
      </div>
    )
  }

  return (
    <div
      ref={overlayRef}
      data-basemap-cell-overlay
      className="pointer-events-none absolute inset-0"
      aria-hidden
    >
      {/* 草稿層：分割與共用分割線 */}
      <div className="absolute inset-0 z-[3]">
        {structuralCells.map((cell) => renderCellChrome(cell, 'structural'))}
        {!readOnly
          ? dividers.map((d) => (
              <div
                key={d.id}
                data-basemap-cell-divider
                className="pointer-events-auto absolute z-[4] bg-cyan-400/50"
                style={
                  d.axis === 'col'
                    ? {
                        left: d.x - hitPad / 2,
                        top: d.y,
                        width: hitPad,
                        height: d.length,
                        cursor: 'col-resize',
                      }
                    : {
                        left: d.x,
                        top: d.y - hitPad / 2,
                        width: d.length,
                        height: hitPad,
                        cursor: 'row-resize',
                      }
                }
                onPointerDown={(ev) => onDividerPointerDown(ev, d)}
              />
            ))
          : null}
      </div>

      {/* 獨立層：確定切割後各格可個別縮放 */}
      {independentCells.length > 0 ? (
        <div
          data-basemap-pinned-layer
          className="pointer-events-none absolute inset-0 z-[6]"
        >
          {independentCells.map((cell) => renderCellChrome(cell, 'independent'))}
        </div>
      ) : null}
    </div>
  )
}
