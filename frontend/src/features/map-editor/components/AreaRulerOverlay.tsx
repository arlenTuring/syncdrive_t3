import { useMemo } from 'react'
import type { MapAreaDomain, MapAreaLayout } from '../types/area'
import {
  areaPxPerMeter,
  domainHeightM,
  domainWidthM,
  meterToAreaLocalPx,
} from '../utils/areaCoords'
import {
  formatMeterRulerLabel,
  pickNiceMeterStep,
} from '../utils/mapRulerTicks'
import { getAreaRulerBandPx } from '../utils/areaRulerBands'

/** 主要刻度在螢幕上目標間距（px，已含 mapScale 補償後） */
const TARGET_MAJOR_TICK_PX = 72

type AreaRulerOverlayProps = {
  domain: MapAreaDomain
  layout: MapAreaLayout
  /** 畫布 fit 視窗的縮放比；用於放大刻度 UI 避免縮小後看不見 */
  mapScale?: number
  /** 編輯中：刻度帶可拖曳移動 Area */
  showMoveHint?: boolean
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function buildMeterTicks(
  minM: number,
  maxM: number,
  stepM: number,
): number[] {
  if (stepM <= 0) return []
  const ticks: number[] = []
  const start = Math.ceil(minM / stepM - 1e-9) * stepM
  for (let m = start; m <= maxM + stepM * 0.001; m += stepM) {
    if (m >= minM - 1e-6 && m <= maxM + 1e-6) ticks.push(m)
  }
  return ticks
}

export function AreaRulerOverlay({
  domain,
  layout,
  mapScale = 1,
  showMoveHint = false,
}: AreaRulerOverlayProps) {
  const uiScale = clamp(1 / Math.max(0.15, mapScale), 1, 2.75)

  const { bandTop, bandLeft } = getAreaRulerBandPx(mapScale)
  const fontPx = Math.round(11 * uiScale)
  const majorTickX = Math.round(8 * uiScale)
  const majorTickY = Math.round(10 * uiScale)
  const minorTick = Math.max(4, Math.round(5 * uiScale))

  const { xTicks, yTicks, xStep, yStep } = useMemo(() => {
    const spanWm = domainWidthM(domain)
    const spanHm = domainHeightM(domain)
    const { pxPerMeterX, pxPerMeterY } = areaPxPerMeter(layout, domain)
    const contentWPx = spanWm * pxPerMeterX
    const contentHPx = spanHm * pxPerMeterY

    const targetCountX = Math.max(
      3,
      Math.floor((contentWPx * mapScale) / TARGET_MAJOR_TICK_PX),
    )
    const targetCountY = Math.max(
      3,
      Math.floor((contentHPx * mapScale) / TARGET_MAJOR_TICK_PX),
    )

    const xStepM = pickNiceMeterStep(spanWm, targetCountX)
    const yStepM = pickNiceMeterStep(spanHm, targetCountY)

    return {
      xStep: xStepM,
      yStep: yStepM,
      xTicks: buildMeterTicks(domain.xMinM, domain.xMaxM, xStepM),
      yTicks: buildMeterTicks(domain.yMinM, domain.yMaxM, yStepM),
    }
  }, [domain, layout, mapScale])

  const toLocalPx = (xM: number, yM: number) =>
    meterToAreaLocalPx(xM, yM, domain, layout)

  return (
    <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
      {/* 輔助網格 */}
      <svg
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        {xTicks.map((m) => {
          const { x } = toLocalPx(m, domain.yMinM)
          if (x < -2 || x > layout.wPx + 2) return null
          return (
            <line
              key={`grid-x-${m}`}
              x1={x}
              y1={0}
              x2={x}
              y2={layout.hPx}
              stroke="rgba(34,211,238,0.12)"
              strokeWidth={1}
            />
          )
        })}
        {yTicks.map((m) => {
          const { y } = toLocalPx(domain.xMinM, m)
          if (y < -2 || y > layout.hPx + 2) return null
          return (
            <line
              key={`grid-y-${m}`}
              x1={0}
              y1={y}
              x2={layout.wPx}
              y2={y}
              stroke="rgba(34,211,238,0.12)"
              strokeWidth={1}
            />
          )
        })}
      </svg>

      <div
        className="absolute inset-0 border border-dashed border-cyan-500/35"
        aria-hidden
      />

      {/* 頂部 X 刻度帶 */}
      <div
        data-area-ruler-drag
        className={`absolute left-0 right-0 top-0 border-b border-cyan-600/50 bg-zinc-950/88 shadow-sm ${showMoveHint ? 'pointer-events-auto cursor-move' : 'pointer-events-none'}`}
        style={{ height: bandTop, paddingLeft: bandLeft }}
        title={showMoveHint ? '拖曳移動 Area' : undefined}
      >
        {xTicks.map((m) => {
          const { x } = toLocalPx(m, domain.yMinM)
          if (x < bandLeft - 40 || x > layout.wPx + 40) return null
          const isMin = Math.abs(m - domain.xMinM) < 1e-6
          return (
            <div
              key={`x-${m}`}
              className="absolute top-0 flex flex-col items-center"
              style={{ left: x, transform: 'translateX(-50%)' }}
            >
              <div
                className={isMin ? 'bg-cyan-400' : 'bg-cyan-500/90'}
                style={{ width: 1, height: majorTickX }}
              />
              <span
                className="mt-0.5 whitespace-nowrap font-mono font-medium leading-none text-cyan-100"
                style={{ fontSize: fontPx }}
              >
                {formatMeterRulerLabel(m, 1)}
              </span>
            </div>
          )
        })}
        <div
          className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-cyan-400/80"
          style={{ fontSize: Math.max(9, fontPx - 1) }}
        >
          x (m) · {xStep}m
        </div>
      </div>

      {/* 左側 Y 刻度帶 */}
      <div
        data-area-ruler-drag
        className={`absolute bottom-0 left-0 border-r border-cyan-600/50 bg-zinc-950/88 shadow-sm ${showMoveHint ? 'pointer-events-auto cursor-move' : 'pointer-events-none'}`}
        style={{ top: bandTop, width: bandLeft }}
        title={showMoveHint ? '拖曳移動 Area' : undefined}
      >
        {yTicks.map((m) => {
          const { y } = toLocalPx(domain.xMinM, m)
          if (y < -20 || y > layout.hPx + 20) return null
          const isMin = Math.abs(m - domain.yMinM) < 1e-6
          return (
            <div
              key={`y-${m}`}
              className="absolute left-0 flex items-center gap-1 pl-1"
              style={{ top: y, transform: 'translateY(-50%)' }}
            >
              <div
                className={isMin ? 'bg-cyan-400' : 'bg-cyan-500/90'}
                style={{ width: majorTickY, height: 1 }}
              />
              <span
                className="whitespace-nowrap font-mono font-medium leading-none text-cyan-100"
                style={{ fontSize: fontPx }}
              >
                {formatMeterRulerLabel(m, 1)}
              </span>
            </div>
          )
        })}
        <div
          className="absolute bottom-2 left-1 origin-bottom-left -rotate-90 font-mono text-cyan-400/80"
          style={{ fontSize: Math.max(9, fontPx - 1) }}
        >
          y (m) · {yStep}m
        </div>
      </div>

      {/* 左上角刻度帶交會（僅供拖曳；物理範疇見 Area 屬性面板） */}
      <div
        data-area-ruler-drag
        className={`absolute left-0 top-0 border-r border-b border-cyan-600/40 bg-zinc-950/95 ${showMoveHint ? 'pointer-events-auto cursor-move' : 'pointer-events-none'}`}
        style={{ width: bandLeft, height: bandTop }}
        title={showMoveHint ? '拖曳移動 Area' : undefined}
        aria-hidden
      />

      {/* 次刻度（每格一半） */}
      {xStep > 0 &&
        buildMeterTicks(domain.xMinM, domain.xMaxM, xStep / 2)
          .filter((m) => !xTicks.some((t) => Math.abs(t - m) < 1e-6))
          .map((m) => {
            const { x } = toLocalPx(m, domain.yMinM)
            if (x < bandLeft || x > layout.wPx) return null
            return (
              <div
                key={`x-minor-${m}`}
                className="absolute bg-cyan-700/50"
                style={{
                  left: x,
                  top: bandTop - minorTick,
                  width: 1,
                  height: minorTick,
                  transform: 'translateX(-50%)',
                }}
              />
            )
          })}
    </div>
  )
}
