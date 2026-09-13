import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { metersToWorldPx, worldPxToMeters } from '../constants/map'
import { useMapExtent } from '../context/MapExtentContext'
import {
  formatMeterRulerLabel,
  pickNiceMeterStep,
} from '../utils/mapRulerTicks'

type HorizontalRulerProps = {
  viewportRef: RefObject<HTMLDivElement | null>
  /** 世界 X 方向：像素／世界單位 */
  scaleX: number
  /** 選取設施中心對應的 X（公尺），於標尺上顯示對齊刻度 */
  selectionMeterX?: number | null
}

type VerticalRulerProps = {
  viewportRef: RefObject<HTMLDivElement | null>
  /** 世界 Y 方向：像素／世界單位 */
  scaleY: number
  /** 選取設施中心對應的 Y（公尺），於標尺上顯示對齊刻度 */
  selectionMeterY?: number | null
}

function useViewportScroll(viewportRef: RefObject<HTMLDivElement | null>) {
  const [, bump] = useState(0)
  const tick = useCallback(() => bump((n) => n + 1), [])
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onScroll = () => tick()
    vp.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => tick())
    ro.observe(vp)
    tick()
    return () => {
      vp.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [viewportRef, tick])
}

export function HorizontalRuler({
  viewportRef,
  scaleX,
  selectionMeterX = null,
}: HorizontalRulerProps) {
  const { width: extentWidthM } = useMapExtent()
  useViewportScroll(viewportRef)
  const sx = scaleX > 0 ? scaleX : 1
  const vp = viewportRef.current
  const w = vp?.clientWidth ?? 0
  const sl = vp?.scrollLeft ?? 0

  const leftM = worldPxToMeters(sl / sx)
  const rightM = worldPxToMeters((sl + w) / sx)
  const span = Math.max(rightM - leftM, 0.5)
  const step = pickNiceMeterStep(span, 14)
  const start = Math.floor(leftM / step - 1e-9) * step
  const ticks: { m: number; xPx: number }[] = []
  for (let m = start; m <= rightM + step; m += step) {
    if (m < -1 || m > extentWidthM + 1) continue
    const wx = metersToWorldPx(m)
    const xPx = wx * sx - sl
    if (xPx < -80 || xPx > w + 80) continue
    ticks.push({ m, xPx })
  }

  const selXPx =
    selectionMeterX != null && Number.isFinite(selectionMeterX)
      ? metersToWorldPx(selectionMeterX) * sx - sl
      : null

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-900/95">
      <div className="pointer-events-none absolute inset-0">
        {ticks.map(({ m, xPx }, i) => (
          <div
            key={`h-tick-${i}-${m}`}
            className="absolute top-0 flex flex-col items-center"
            style={{ left: xPx, transform: 'translateX(-50%)' }}
          >
            <div className="h-2 w-px bg-zinc-500" />
            <span className="mt-0.5 whitespace-nowrap font-mono text-[8px] text-zinc-400 sm:text-[9px]">
              {formatMeterRulerLabel(m, 2)}
            </span>
          </div>
        ))}
        {selXPx != null && selXPx >= -6 && selXPx <= w + 6 && (
          <div
            className="absolute top-0"
            style={{ left: selXPx, transform: 'translateX(-50%)' }}
            title={
              selectionMeterX != null
                ? formatMeterRulerLabel(selectionMeterX, 2)
                : undefined
            }
          >
            <div className="h-2.5 w-px bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]" />
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute bottom-0 left-2 text-[9px] text-zinc-600">
        x 刻度 (m)
      </div>
    </div>
  )
}

export function VerticalRuler({
  viewportRef,
  scaleY,
  selectionMeterY = null,
}: VerticalRulerProps) {
  const { height: extentHeightM } = useMapExtent()
  useViewportScroll(viewportRef)
  const sy = scaleY > 0 ? scaleY : 1
  const vp = viewportRef.current
  const h = vp?.clientHeight ?? 0
  const st = vp?.scrollTop ?? 0

  const topM = worldPxToMeters(st / sy)
  const bottomM = worldPxToMeters((st + h) / sy)
  const span = Math.max(bottomM - topM, 0.5)
  const step = pickNiceMeterStep(span, 10)
  const start = Math.floor(topM / step - 1e-9) * step
  const ticks: { m: number; yPx: number }[] = []
  for (let m = start; m <= bottomM + step; m += step) {
    if (m < -1 || m > extentHeightM + 1) continue
    const wy = metersToWorldPx(m)
    const yPx = wy * sy - st
    if (yPx < -40 || yPx > h + 40) continue
    ticks.push({ m, yPx })
  }

  const selYPx =
    selectionMeterY != null && Number.isFinite(selectionMeterY)
      ? metersToWorldPx(selectionMeterY) * sy - st
      : null

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-900/95">
      <div className="pointer-events-none absolute inset-0">
        {ticks.map(({ m, yPx }, i) => (
          <div
            key={`v-tick-${i}-${m}`}
            className="absolute left-0 flex items-center gap-0.5"
            style={{ top: yPx, transform: 'translateY(-50%)' }}
          >
            <div className="h-px w-2 shrink-0 bg-zinc-500" />
            <span className="font-mono text-[8px] leading-none text-zinc-400 sm:text-[9px]">
              {formatMeterRulerLabel(m, 2)}
            </span>
          </div>
        ))}
        {selYPx != null && selYPx >= -6 && selYPx <= h + 6 && (
          <div
            className="absolute left-0"
            style={{ top: selYPx, transform: 'translateY(-50%)' }}
            title={
              selectionMeterY != null
                ? formatMeterRulerLabel(selectionMeterY, 2)
                : undefined
            }
          >
            <div className="h-px w-2.5 shrink-0 bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]" />
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute bottom-1 right-0.5 origin-bottom-right rotate-[-90deg] translate-y-[-100%] text-[9px] text-zinc-600">
        y 刻度 (m)
      </div>
    </div>
  )
}
