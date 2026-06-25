import { RotateCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  textHorizontalToJustify,
  textVerticalToAlignItems,
  type TextHorizontalAlign,
  type TextVerticalAlign,
} from '../../../lib/textAlignment'
import {
  resolveLabelBoxDimensions,
  resolveTextWrapMode,
  textWrapToWhiteSpace,
  type TextWrapMode,
} from '../../../lib/textLayout'
import { clampLabelOffsetPx } from '../utils/facilityLabelStyle'
import { normalizeDegrees } from '../utils/rotation'

type LabelCss = {
  fontSize: number
  color: string
  fontWeight: number | 'bold' | 'normal'
  fontStyle: 'normal' | 'italic'
  textAlign: TextHorizontalAlign
  verticalAlign: TextVerticalAlign
  textWrap: TextWrapMode
  labelBoxWidthPx?: number
  labelBoxHeightPx?: number
}

type Props = {
  label: string
  labelCss: LabelCss
  /** 設施卡片中心（含 hitPad） */
  anchorX: number
  anchorY: number
  offset: { x: number; y: number }
  labelRotationDeg: number
  boxW: number
  boxH: number
  /** 設施本體旋轉；拖曳位移時換算到區域座標 */
  bodyRotationDeg?: number
  interactive: boolean
  selected: boolean
  onSelect?: () => void
  onOffsetChange?: (offset: { x: number; y: number }) => void
  onRotationChange?: (deg: number) => void
}

function clientDeltaToLocal(
  dx: number,
  dy: number,
  rotationDeg: number,
): { x: number; y: number } {
  const r = (normalizeDegrees(rotationDeg) * Math.PI) / 180
  const cos = Math.cos(-r)
  const sin = Math.sin(-r)
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos }
}

function pointerAngleDeg(clientX: number, clientY: number, cx: number, cy: number): number {
  return (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI
}

export function FacilityDraggableLabel({
  label,
  labelCss,
  anchorX,
  anchorY,
  offset,
  labelRotationDeg,
  boxW,
  boxH,
  bodyRotationDeg = 0,
  interactive,
  selected,
  onSelect,
  onOffsetChange,
  onRotationChange,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const moveDragRef = useRef<{
    startClientX: number
    startClientY: number
    startOffset: { x: number; y: number }
  } | null>(null)
  const rotateDragRef = useRef<{
    startPointerAngle: number
    startLabelRotation: number
    cx: number
    cy: number
  } | null>(null)
  const [liveOffset, setLiveOffset] = useState(offset)
  const [liveRotation, setLiveRotation] = useState(labelRotationDeg)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!moveDragRef.current && !rotateDragRef.current) {
      setLiveOffset(offset)
      setLiveRotation(labelRotationDeg)
    }
  }, [offset.x, offset.y, labelRotationDeg])

  useEffect(() => () => cleanupRef.current?.(), [])

  const endDrag = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    moveDragRef.current = null
    rotateDragRef.current = null
  }, [])

  const onMovePointerDown = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      if (!interactive || !onOffsetChange || !label.trim()) return
      e.stopPropagation()
      e.preventDefault()
      if (!selected) onSelect?.()

      moveDragRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startOffset: liveOffset,
      }
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        const drag = moveDragRef.current
        if (!drag) return
        const local = clientDeltaToLocal(
          ev.clientX - drag.startClientX,
          ev.clientY - drag.startClientY,
          bodyRotationDeg,
        )
        setLiveOffset(
          clampLabelOffsetPx(
            {
              x: drag.startOffset.x + local.x,
              y: drag.startOffset.y + local.y,
            },
            boxW,
            boxH,
          ),
        )
      }

      const onUp = (ev: PointerEvent) => {
        const drag = moveDragRef.current
        if (drag) {
          const local = clientDeltaToLocal(
            ev.clientX - drag.startClientX,
            ev.clientY - drag.startClientY,
            bodyRotationDeg,
          )
          const next = clampLabelOffsetPx(
            {
              x: drag.startOffset.x + local.x,
              y: drag.startOffset.y + local.y,
            },
            boxW,
            boxH,
          )
          onOffsetChange(next)
          setLiveOffset(next)
        }
        try {
          target.releasePointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
        endDrag()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
    },
    [
      bodyRotationDeg,
      boxH,
      boxW,
      endDrag,
      interactive,
      label,
      liveOffset,
      onOffsetChange,
      onSelect,
      selected,
    ],
  )

  const onRotatePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!interactive || !onRotationChange || !label.trim()) return
      e.stopPropagation()
      e.preventDefault()
      if (!selected) onSelect?.()

      const root = rootRef.current
      if (!root) return
      const rect = root.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2

      rotateDragRef.current = {
        startPointerAngle: pointerAngleDeg(e.clientX, e.clientY, cx, cy),
        startLabelRotation: liveRotation,
        cx,
        cy,
      }
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        const drag = rotateDragRef.current
        if (!drag) return
        const angle = pointerAngleDeg(ev.clientX, ev.clientY, drag.cx, drag.cy)
        const delta = angle - drag.startPointerAngle
        setLiveRotation(normalizeDegrees(drag.startLabelRotation + delta))
      }

      const onUp = (ev: PointerEvent) => {
        const drag = rotateDragRef.current
        if (drag) {
          const angle = pointerAngleDeg(ev.clientX, ev.clientY, drag.cx, drag.cy)
          const delta = angle - drag.startPointerAngle
          const next = normalizeDegrees(drag.startLabelRotation + delta)
          onRotationChange(next)
          setLiveRotation(next)
        }
        try {
          target.releasePointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
        endDrag()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
    },
    [endDrag, interactive, label, liveRotation, onRotationChange, onSelect, selected],
  )

  if (!label.trim()) return null

  const showRotate = interactive && selected && !!onRotationChange
  const handleDist = Math.max(22, labelCss.fontSize * 1.6)
  const textWrap = resolveTextWrapMode(labelCss.textWrap)
  const boxDims = resolveLabelBoxDimensions({
    fontSize: labelCss.fontSize,
    facilityBoxW: boxW,
    customWidth: labelCss.labelBoxWidthPx,
    customHeight: labelCss.labelBoxHeightPx,
    textWrap,
  })
  const whiteSpace = textWrapToWhiteSpace(textWrap)

  return (
    <div
      ref={rootRef}
      className={`absolute ${selected ? 'z-[5010]' : 'z-[76]'}`}
      style={{
        left: anchorX + liveOffset.x,
        top: anchorY + liveOffset.y,
        transform: `translate(-50%, -50%) rotate(${liveRotation}deg)`,
      }}
    >
      <div
        data-facility-label-drag
        role="presentation"
        onPointerDown={onMovePointerDown}
        className={[
          'relative touch-none',
          interactive
            ? [
                'cursor-grab rounded active:cursor-grabbing',
                'hover:outline hover:outline-1 hover:outline-cyan-400/70',
                selected ? 'ring-1 ring-cyan-400/40' : 'opacity-95',
              ].join(' ')
            : 'pointer-events-none',
        ].join(' ')}
        style={{
          width: boxDims.width,
          height: boxDims.height,
          minWidth: boxDims.minWidth,
          maxWidth: boxDims.maxWidth,
          display: 'flex',
          alignItems: textVerticalToAlignItems(labelCss.verticalAlign),
          justifyContent: textHorizontalToJustify(labelCss.textAlign),
          textAlign: labelCss.textAlign,
        }}
        title={interactive ? '拖曳移動名稱；右側圓點可旋轉' : undefined}
      >
        <span
          className={[
            'max-w-full leading-tight',
            textWrap === 'single' ? 'truncate' : '',
          ].join(' ')}
          style={{
            fontSize: labelCss.fontSize,
            color: labelCss.color,
            fontWeight: labelCss.fontWeight,
            fontStyle: labelCss.fontStyle,
            whiteSpace,
            textShadow: '0 1px 3px rgba(0,0,0,0.9)',
          }}
        >
          {label}
        </span>
      </div>
      {showRotate ? (
        <button
          type="button"
          data-facility-label-rotate-handle
          aria-label="旋轉名稱"
          title="拖曳以旋轉名稱"
          onPointerDown={onRotatePointerDown}
          className="absolute top-1/2 flex size-5 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full border border-cyan-400/80 bg-zinc-900/95 text-cyan-300 shadow-md active:cursor-grabbing hover:bg-cyan-950"
          style={{ left: handleDist }}
        >
          <RotateCw className="size-3" strokeWidth={2.25} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
