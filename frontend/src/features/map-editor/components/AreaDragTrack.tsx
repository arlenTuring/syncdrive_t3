import type { PointerEvent as ReactPointerEvent } from 'react'

/** Area 外側拖曳軌道寬度（局部 px） */
export const AREA_DRAG_TRACK_PX = 14

type AreaResizeEdge = 'tl' | 'tr' | 'bl' | 'br'

type AreaDragTrackProps = {
  wPx: number
  hPx: number
  active: boolean
  onMovePointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onResizePointerDown: (
    e: ReactPointerEvent<HTMLDivElement>,
    edge: AreaResizeEdge,
  ) => void
}

const trackBase =
  'pointer-events-auto absolute z-[5000] transition-colors duration-150'

function trackStyle(active: boolean): React.CSSProperties {
  return {
    background: active
      ? 'rgba(34, 211, 238, 0.14)'
      : 'rgba(34, 211, 238, 0.07)',
    borderColor: active
      ? 'rgba(34, 211, 238, 0.45)'
      : 'rgba(34, 211, 238, 0.22)',
  }
}

function cursorForCorner(edge: AreaResizeEdge): string {
  switch (edge) {
    case 'tl':
    case 'br':
      return 'nwse-resize'
    case 'tr':
    case 'bl':
      return 'nesw-resize'
  }
}

/** 編輯模式下 Area 外側半透明拖曳軌道（邊緣拖動、角落縮放） */
export function AreaDragTrack({
  wPx,
  hPx,
  active,
  onMovePointerDown,
  onResizePointerDown,
}: AreaDragTrackProps) {
  const t = AREA_DRAG_TRACK_PX
  const style = trackStyle(active)
  const moveCursor = { cursor: 'move' as const }

  const onMoveDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    onMovePointerDown(e)
  }

  const onResizeDown =
    (edge: AreaResizeEdge) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      onResizePointerDown(e, edge)
    }

  const corners: { edge: AreaResizeEdge; left: number; top: number }[] = [
    { edge: 'tl', left: -t, top: -t },
    { edge: 'tr', left: wPx, top: -t },
    { edge: 'bl', left: -t, top: hPx },
    { edge: 'br', left: wPx, top: hPx },
  ]

  return (
    <>
      <div
        data-area-drag-track
        className={trackBase}
        style={{
          left: -t,
          top: -t,
          width: wPx + t * 2,
          height: t,
          borderBottom: `1px solid ${style.borderColor}`,
          background: style.background,
          ...moveCursor,
        }}
        onPointerDown={onMoveDown}
        title="拖曳以移動 Area"
      />
      <div
        data-area-drag-track
        className={trackBase}
        style={{
          left: -t,
          top: hPx,
          width: wPx + t * 2,
          height: t,
          borderTop: `1px solid ${style.borderColor}`,
          background: style.background,
          ...moveCursor,
        }}
        onPointerDown={onMoveDown}
        title="拖曳以移動 Area"
      />
      <div
        data-area-drag-track
        className={trackBase}
        style={{
          left: -t,
          top: 0,
          width: t,
          height: hPx,
          borderRight: `1px solid ${style.borderColor}`,
          background: style.background,
          ...moveCursor,
        }}
        onPointerDown={onMoveDown}
        title="拖曳以移動 Area"
      />
      <div
        data-area-drag-track
        className={trackBase}
        style={{
          left: wPx,
          top: 0,
          width: t,
          height: hPx,
          borderLeft: `1px solid ${style.borderColor}`,
          background: style.background,
          ...moveCursor,
        }}
        onPointerDown={onMoveDown}
        title="拖曳以移動 Area"
      />
      {corners.map(({ edge, left, top }) => (
        <div
          key={edge}
          data-area-resize-corner
          className={`${trackBase} rounded-sm`}
          style={{
            left,
            top,
            width: t,
            height: t,
            background: active
              ? 'rgba(34, 211, 238, 0.35)'
              : 'rgba(34, 211, 238, 0.2)',
            border: `1px solid ${style.borderColor}`,
            cursor: cursorForCorner(edge),
            zIndex: 5001,
          }}
          onPointerDown={onResizeDown(edge)}
          title="拖曳以調整 Area 大小"
        />
      ))}
    </>
  )
}
