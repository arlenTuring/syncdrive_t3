import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { AUX_LINE_SPACING_METERS, WORLD_UNITS_PER_METER } from '../constants/map'
import { useMapExtent } from '../context/MapExtentContext'

type MapAuxiliaryLinesOverlayProps = {
  viewportRef: RefObject<HTMLDivElement | null>
  scaleX: number
  scaleY: number
}

/** 每 AUX_LINE_SPACING_METERS 公尺一條世界座標線 */
const STEP_WU = AUX_LINE_SPACING_METERS * WORLD_UNITS_PER_METER

/**
 * 僅在可視區畫 5m 間隔輔助線（非格線），減輕整張大地圖的合成負擔。
 */
export function MapAuxiliaryLinesOverlay({
  viewportRef,
  scaleX,
  scaleY,
}: MapAuxiliaryLinesOverlayProps) {
  const { worldW: mapWorldW, worldH: mapWorldH } = useMapExtent()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sx = scaleX > 0 ? scaleX : 1
  const sy = scaleY > 0 ? scaleY : 1

  useEffect(() => {
    const vp = viewportRef.current
    const canvas = canvasRef.current
    if (!vp || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let paintRaf = 0
    const paint = () => {
      paintRaf = 0
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2)
      const vw = vp.clientWidth
      const vh = vp.clientHeight
      if (vw < 1 || vh < 1) return

      canvas.width = Math.floor(vw * dpr)
      canvas.height = Math.floor(vh * dpr)
      canvas.style.width = `${vw}px`
      canvas.style.height = `${vh}px`

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, vw, vh)

      const sl = vp.scrollLeft
      const st = vp.scrollTop

      const worldLeft = sl / sx
      const worldTop = st / sy
      const worldRight = (sl + vw) / sx
      const worldBottom = (st + vh) / sy

      const toPxX = (wx: number) => wx * sx - sl
      const toPxY = (wy: number) => wy * sy - st

      const lineRgba = 'rgba(255,255,255,0.09)'

      const x0 = Math.max(0, Math.floor(worldLeft / STEP_WU) * STEP_WU)
      const x1 = Math.min(mapWorldW, Math.ceil(worldRight / STEP_WU) * STEP_WU)
      const y0 = Math.max(0, Math.floor(worldTop / STEP_WU) * STEP_WU)
      const y1 = Math.min(mapWorldH, Math.ceil(worldBottom / STEP_WU) * STEP_WU)

      ctx.lineWidth = 1
      ctx.strokeStyle = lineRgba
      ctx.setLineDash([])

      for (let wx = x0; wx <= x1; wx += STEP_WU) {
        const px = toPxX(wx)
        if (px < -1 || px > vw + 1) continue
        ctx.beginPath()
        ctx.moveTo(px + 0.5, 0)
        ctx.lineTo(px + 0.5, vh)
        ctx.stroke()
      }
      for (let wy = y0; wy <= y1; wy += STEP_WU) {
        const py = toPxY(wy)
        if (py < -1 || py > vh + 1) continue
        ctx.beginPath()
        ctx.moveTo(0, py + 0.5)
        ctx.lineTo(vw, py + 0.5)
        ctx.stroke()
      }
    }

    const schedulePaint = () => {
      if (paintRaf !== 0) return
      paintRaf = requestAnimationFrame(paint)
    }

    paint()
    vp.addEventListener('scroll', schedulePaint, { passive: true })
    const ro = new ResizeObserver(schedulePaint)
    ro.observe(vp)
    return () => {
      vp.removeEventListener('scroll', schedulePaint)
      ro.disconnect()
      if (paintRaf !== 0) cancelAnimationFrame(paintRaf)
    }
  }, [viewportRef, sx, sy, mapWorldW, mapWorldH])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      aria-hidden
    />
  )
}
