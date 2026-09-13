import { useMemo } from 'react'
import type { MapAreaDomain, MapAreaLayout, MapAreaObject } from '../types/area'
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
import {
  rulerFieldMetersAtDomain,
  type MapRulerDisplayMode,
} from '../utils/mapRulerDisplay'

/** 主要刻度在螢幕上目標間距（px，已含 mapScale 補償後） */
const TARGET_MAJOR_TICK_PX = 72

/** 選取元件連線至刻度軸（中心 + 軸對齊外框範圍） */
export type AreaRulerSelectionGuide = {
  cssX: number
  cssY: number
  domainXM: number
  domainYM: number
  /** CSS 左上原點：外框左右／上下 */
  cssXMin: number
  cssXMax: number
  cssYMin: number
  cssYMax: number
  /** domain 公尺：外框邊界（刻度／再映射為場域） */
  domainXMin: number
  domainXMax: number
  domainYMin: number
  domainYMax: number
  /**
   * 座標模式：元件自身場域範圍（如分區由入口同步的 refField）。
   * 有值時刻度帶標籤直接用此組，不再從 domain 線性推算。
   */
  fieldLabels?: {
    xM: number
    yM: number
    xMinM: number
    xMaxM: number
    yMinM: number
    yMaxM: number
  }
  /** 十字連線起點（預設＝cssX/cssY；分區可連到圖上元件、範圍框在場域尺上） */
  crosshairCssX?: number
  crosshairCssY?: number
}

type AreaRulerOverlayProps = {
  domain: MapAreaDomain
  layout: MapAreaLayout
  /** 完整 Area（座標模式映射用） */
  area?: MapAreaObject
  /** scale＝Area domain 刻度；field＝同位置標場域座標（位置等距，標籤語意互斥） */
  displayMode?: Exclude<MapRulerDisplayMode, 'off'>
  /** 畫布 fit 視窗的縮放比；用於放大刻度 UI 避免縮小後看不見 */
  mapScale?: number
  /** 編輯中：刻度帶可拖曳移動 Area */
  showMoveHint?: boolean
  /** 選取元件 → 刻度軸引導線與讀數（工具列開啟時） */
  selectionGuides?: readonly AreaRulerSelectionGuide[]
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

type AxisTick = {
  /** 標籤數值（scale=domain／field=場域） */
  valueM: number
  /** CSS 位置：x 為 left；y 為 top（左上原點，相對 Area 內容框） */
  cssPos: number
}

/** 螢幕上過近的標籤丟掉，避免疊成一團 */
function cullTicksByScreenGap(
  ticks: AxisTick[],
  minGapPx: number,
): AxisTick[] {
  const sorted = [...ticks].sort((a, b) => a.cssPos - b.cssPos)
  const out: AxisTick[] = []
  let lastPos = -Infinity
  let lastLabel = ''
  for (const t of sorted) {
    if (!Number.isFinite(t.valueM) || !Number.isFinite(t.cssPos)) continue
    const label = formatMeterRulerLabel(t.valueM, 1)
    if (t.cssPos - lastPos < minGapPx) continue
    if (label === lastLabel && t.cssPos - lastPos < minGapPx * 1.5) continue
    out.push(t)
    lastPos = t.cssPos
    lastLabel = label
  }
  return out
}

export function AreaRulerOverlay({
  domain,
  layout,
  area,
  displayMode = 'scale',
  mapScale = 1,
  showMoveHint = false,
  selectionGuides = [],
}: AreaRulerOverlayProps) {
  const uiScale = clamp(1 / Math.max(0.15, mapScale), 1, 2.75)
  const fieldMode = displayMode === 'field' && !!area

  const { bandTop: bandTopBase, bandLeft: bandLeftBase } =
    getAreaRulerBandPx(mapScale)
  const hasSelectionGuides = selectionGuides.length > 0
  const bandTop = hasSelectionGuides
    ? Math.max(bandTopBase, Math.round(36 * uiScale))
    : bandTopBase
  const bandLeft = hasSelectionGuides
    ? Math.max(bandLeftBase, Math.round(64 * uiScale))
    : bandLeftBase
  const fontPx = Math.round(11 * uiScale)
  const majorTickX = Math.round(8 * uiScale)
  const majorTickY = Math.round(10 * uiScale)
  const minorTick = Math.max(4, Math.round(5 * uiScale))
  /** 標籤最小間距（畫面 px，已含 mapScale） */
  const labelMinGapPx = Math.max(28, fontPx * 2.4) / Math.max(0.01, mapScale)
  const selFontPx = Math.max(10, Math.round(10 * uiScale))
  const guideStroke = Math.max(1, 1.25 / Math.max(0.01, mapScale))

  const resolvedGuides = useMemo(() => {
    return selectionGuides
      .filter(
        (g) =>
          Number.isFinite(g.cssX) &&
          Number.isFinite(g.cssY) &&
          Number.isFinite(g.domainXM) &&
          Number.isFinite(g.domainYM) &&
          Number.isFinite(g.cssXMin) &&
          Number.isFinite(g.cssXMax) &&
          Number.isFinite(g.cssYMin) &&
          Number.isFinite(g.cssYMax),
      )
      .map((g) => {
        const x0 = Math.min(g.cssXMin, g.cssXMax)
        const x1 = Math.max(g.cssXMin, g.cssXMax)
        const y0 = Math.min(g.cssYMin, g.cssYMax)
        const y1 = Math.max(g.cssYMin, g.cssYMax)

        if (fieldMode && g.fieldLabels) {
          const fl = g.fieldLabels
          return {
            cssX: g.cssX,
            cssY: g.cssY,
            cssXMin: x0,
            cssXMax: x1,
            cssYMin: y0,
            cssYMax: y1,
            crosshairCssX: g.crosshairCssX ?? g.cssX,
            crosshairCssY: g.crosshairCssY ?? g.cssY,
            labelXM: fl.xM,
            labelYM: fl.yM,
            labelXMin: Math.min(fl.xMinM, fl.xMaxM),
            labelXMax: Math.max(fl.xMinM, fl.xMaxM),
            labelYMin: Math.min(fl.yMinM, fl.yMaxM),
            labelYMax: Math.max(fl.yMinM, fl.yMaxM),
          }
        }

        const center = fieldMode
          ? rulerFieldMetersAtDomain(domain, g.domainXM, g.domainYM, area)
          : { xM: g.domainXM, yM: g.domainYM }
        const lo = fieldMode
          ? rulerFieldMetersAtDomain(domain, g.domainXMin, g.domainYMin, area)
          : { xM: g.domainXMin, yM: g.domainYMin }
        const hi = fieldMode
          ? rulerFieldMetersAtDomain(domain, g.domainXMax, g.domainYMax, area)
          : { xM: g.domainXMax, yM: g.domainYMax }
        return {
          cssX: g.cssX,
          cssY: g.cssY,
          cssXMin: x0,
          cssXMax: x1,
          cssYMin: y0,
          cssYMax: y1,
          crosshairCssX: g.crosshairCssX ?? g.cssX,
          crosshairCssY: g.crosshairCssY ?? g.cssY,
          labelXM: center.xM,
          labelYM: center.yM,
          labelXMin: Math.min(lo.xM, hi.xM),
          labelXMax: Math.max(lo.xM, hi.xM),
          labelYMin: Math.min(lo.yM, hi.yM),
          labelYMax: Math.max(lo.yM, hi.yM),
        }
      })
  }, [area, domain, fieldMode, selectionGuides])

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
    const toLocalPx = (xM: number, yM: number) =>
      meterToAreaLocalPx(xM, yM, domain, layout)

    const rawX = buildMeterTicks(domain.xMinM, domain.xMaxM, xStepM).map(
      (domainXM): AxisTick => {
        const { x } = toLocalPx(domainXM, domain.yMinM)
        const valueM = fieldMode
          ? rulerFieldMetersAtDomain(domain, domainXM, domain.yMinM, area).xM
          : domainXM
        return { valueM, cssPos: x }
      },
    )
    const rawY = buildMeterTicks(domain.yMinM, domain.yMaxM, yStepM).map(
      (domainYM): AxisTick => {
        const { y } = toLocalPx(domain.xMinM, domainYM)
        const valueM = fieldMode
          ? rulerFieldMetersAtDomain(domain, domain.xMinM, domainYM, area).yM
          : domainYM
        return { valueM, cssPos: layout.hPx - y }
      },
    )

    return {
      xStep: xStepM,
      yStep: yStepM,
      xTicks: fieldMode ? cullTicksByScreenGap(rawX, labelMinGapPx) : rawX,
      yTicks: fieldMode ? cullTicksByScreenGap(rawY, labelMinGapPx) : rawY,
    }
  }, [area, domain, fieldMode, labelMinGapPx, layout, mapScale])

  const axisHint = fieldMode
    ? { x: 'x 場域 (m)', y: 'y 場域 (m)' }
    : { x: `x 刻度 (m) · ${xStep}m`, y: `y 刻度 (m) · ${yStep}m` }

  return (
    <div className="pointer-events-none absolute inset-0 z-[40] overflow-visible">
      {/* 網格留在正式範圍內（淡線）；數字／刻度帶在框外 */}
      <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        {xTicks.map((t, i) => {
          if (t.cssPos < -2 || t.cssPos > layout.wPx + 2) return null
          return (
            <line
              key={`grid-x-${i}-${t.valueM}`}
              x1={t.cssPos}
              y1={0}
              x2={t.cssPos}
              y2={layout.hPx}
              stroke="rgba(34,211,238,0.12)"
              strokeWidth={1}
            />
          )
        })}
        {yTicks.map((t, i) => {
          if (t.cssPos < -2 || t.cssPos > layout.hPx + 2) return null
          return (
            <line
              key={`grid-y-${i}-${t.valueM}`}
              x1={0}
              y1={t.cssPos}
              x2={layout.wPx}
              y2={t.cssPos}
              stroke="rgba(34,211,238,0.12)"
              strokeWidth={1}
            />
          )
        })}
        {resolvedGuides.map((g, i) => (
          <g key={`sel-guide-${i}`}>
            {/* 縱向：中心 → 上緣刻度軸（含帶內） */}
            <line
              x1={g.crosshairCssX}
              y1={g.crosshairCssY}
              x2={g.crosshairCssX}
              y2={-bandTop}
              stroke="rgba(34,211,238,0.85)"
              strokeWidth={guideStroke}
              strokeDasharray={`${4 / Math.max(0.01, mapScale)} ${3 / Math.max(0.01, mapScale)}`}
            />
            {/* 橫向：中心 → 左緣刻度軸（含帶內） */}
            <line
              x1={g.crosshairCssX}
              y1={g.crosshairCssY}
              x2={-bandLeft}
              y2={g.crosshairCssY}
              stroke="rgba(34,211,238,0.85)"
              strokeWidth={guideStroke}
              strokeDasharray={`${4 / Math.max(0.01, mapScale)} ${3 / Math.max(0.01, mapScale)}`}
            />
            <circle
              cx={g.crosshairCssX}
              cy={g.crosshairCssY}
              r={3 / Math.max(0.01, mapScale)}
              fill="#ecfeff"
              stroke="#22d3ee"
              strokeWidth={1.25 / Math.max(0.01, mapScale)}
            />
          </g>
        ))}
      </svg>

      <div
        className="absolute inset-0 border border-dashed border-cyan-500/35"
        aria-hidden
      />

      {/* 上緣刻度帶：正式範圍上方 */}
      <div
        data-area-ruler-drag
        className={`absolute border-b border-cyan-600/50 bg-zinc-950/90 shadow-sm ${showMoveHint ? 'pointer-events-auto cursor-move' : 'pointer-events-none'}`}
        style={{
          left: 0,
          right: 0,
          top: -bandTop,
          height: bandTop,
        }}
        title={showMoveHint ? '拖曳移動 Area' : undefined}
      >
        {xTicks.map((t, i) => {
          if (t.cssPos < -40 || t.cssPos > layout.wPx + 40) return null
          /** 選取外框整段內不畫一般刻度，避免與 min／max 搶位 */
          const nearSel = resolvedGuides.some((g) => {
            const pad = labelMinGapPx * 0.35
            return (
              t.cssPos >= g.cssXMin - pad && t.cssPos <= g.cssXMax + pad
            )
          })
          if (nearSel) return null
          return (
            <div
              key={`x-${i}-${t.valueM}`}
              className="absolute bottom-0 flex flex-col items-center justify-end"
              style={{
                left: t.cssPos,
                transform: 'translateX(-50%)',
                height: bandTop,
              }}
            >
              <span
                className="mb-0.5 whitespace-nowrap font-mono font-medium leading-none text-cyan-100"
                style={{ fontSize: fontPx }}
              >
                {formatMeterRulerLabel(t.valueM, 1)}
              </span>
              <div
                className="bg-cyan-500/90"
                style={{ width: 1, height: majorTickX }}
              />
            </div>
          )
        })}
        {/* 選取外框 X 範圍：對齊元件左右邊，只標 min／max */}
        {resolvedGuides.map((g, i) => {
          const span = Math.max(2, g.cssXMax - g.cssXMin)
          const showEnds = span * mapScale >= 64
          return (
            <div
              key={`sel-x-range-${i}`}
              className="pointer-events-none absolute z-[2]"
              style={{
                left: g.cssXMin,
                width: span,
                bottom: 0,
                height: bandTop,
              }}
            >
              <div className="absolute inset-x-0 bottom-0 h-[3px] rounded-sm bg-amber-400/80" />
              <div className="absolute bottom-0 left-0 h-2.5 w-0.5 bg-amber-300" />
              <div className="absolute bottom-0 right-0 h-2.5 w-0.5 bg-amber-300" />
              {showEnds ? (
                <>
                  <span
                    className="absolute bottom-2.5 left-0 -translate-x-1/2 whitespace-nowrap rounded border border-amber-400/70 bg-zinc-950 px-1 py-0.5 font-mono font-semibold leading-none text-amber-50 shadow-sm"
                    style={{ fontSize: selFontPx }}
                  >
                    {formatMeterRulerLabel(g.labelXMin, 2)}
                  </span>
                  <span
                    className="absolute bottom-2.5 right-0 translate-x-1/2 whitespace-nowrap rounded border border-amber-400/70 bg-zinc-950 px-1 py-0.5 font-mono font-semibold leading-none text-amber-50 shadow-sm"
                    style={{ fontSize: selFontPx }}
                  >
                    {formatMeterRulerLabel(g.labelXMax, 2)}
                  </span>
                </>
              ) : (
                <span
                  className="absolute bottom-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-amber-400/70 bg-zinc-950 px-1 py-0.5 font-mono font-semibold leading-none text-amber-50 shadow-sm"
                  style={{ fontSize: selFontPx }}
                >
                  {formatMeterRulerLabel(g.labelXMin, 2)}–
                  {formatMeterRulerLabel(g.labelXMax, 2)}
                </span>
              )}
            </div>
          )
        })}
        <div
          className="absolute right-1 top-1/2 -translate-y-1/2 font-mono text-cyan-400/80"
          style={{ fontSize: Math.max(9, fontPx - 1) }}
        >
          {axisHint.x}
        </div>
      </div>

      {/* 左緣刻度帶：正式範圍左側 */}
      <div
        data-area-ruler-drag
        className={`absolute border-r border-cyan-600/50 bg-zinc-950/90 shadow-sm ${showMoveHint ? 'pointer-events-auto cursor-move' : 'pointer-events-none'}`}
        style={{
          left: -bandLeft,
          top: 0,
          bottom: 0,
          width: bandLeft,
        }}
        title={showMoveHint ? '拖曳移動 Area' : undefined}
      >
        {yTicks.map((t, i) => {
          if (t.cssPos < -20 || t.cssPos > layout.hPx + 20) return null
          /** 選取外框整段內不畫一般刻度，避免與 min／max 搶位 */
          const nearSel = resolvedGuides.some((g) => {
            const pad = labelMinGapPx * 0.35
            return (
              t.cssPos >= g.cssYMin - pad && t.cssPos <= g.cssYMax + pad
            )
          })
          if (nearSel) return null
          return (
            <div
              key={`y-${i}-${t.valueM}`}
              className="absolute right-0 flex items-center justify-end gap-1 pr-0.5"
              style={{
                top: t.cssPos,
                transform: 'translateY(-50%)',
                width: bandLeft,
              }}
            >
              <span
                className="whitespace-nowrap font-mono font-medium leading-none text-cyan-100"
                style={{ fontSize: fontPx }}
              >
                {formatMeterRulerLabel(t.valueM, 1)}
              </span>
              <div
                className="shrink-0 bg-cyan-500/90"
                style={{ width: majorTickY, height: 1 }}
              />
            </div>
          )
        })}
        {/* 選取外框 Y 範圍：對齊元件上下邊，只標 min／max */}
        {resolvedGuides.map((g, i) => {
          const span = Math.max(2, g.cssYMax - g.cssYMin)
          const showEnds = span * mapScale >= 56
          return (
            <div
              key={`sel-y-range-${i}`}
              className="pointer-events-none absolute z-[2]"
              style={{
                top: g.cssYMin,
                height: span,
                right: 0,
                width: bandLeft,
              }}
            >
              <div className="absolute inset-y-0 right-0 w-[3px] rounded-sm bg-amber-400/80" />
              <div className="absolute right-0 top-0 h-0.5 w-2.5 bg-amber-300" />
              <div className="absolute bottom-0 right-0 h-0.5 w-2.5 bg-amber-300" />
              {showEnds ? (
                <>
                  <span
                    className="absolute right-3 top-0 -translate-y-1/2 whitespace-nowrap rounded border border-amber-400/70 bg-zinc-950 px-1 py-0.5 font-mono font-semibold leading-none text-amber-50 shadow-sm"
                    style={{ fontSize: selFontPx }}
                  >
                    {formatMeterRulerLabel(g.labelYMax, 2)}
                  </span>
                  <span
                    className="absolute bottom-0 right-3 translate-y-1/2 whitespace-nowrap rounded border border-amber-400/70 bg-zinc-950 px-1 py-0.5 font-mono font-semibold leading-none text-amber-50 shadow-sm"
                    style={{ fontSize: selFontPx }}
                  >
                    {formatMeterRulerLabel(g.labelYMin, 2)}
                  </span>
                </>
              ) : (
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2 whitespace-nowrap rounded border border-amber-400/70 bg-zinc-950 px-1 py-0.5 font-mono font-semibold leading-none text-amber-50 shadow-sm"
                  style={{ fontSize: selFontPx }}
                >
                  {formatMeterRulerLabel(g.labelYMin, 2)}–
                  {formatMeterRulerLabel(g.labelYMax, 2)}
                </span>
              )}
            </div>
          )
        })}
        <div
          className="absolute bottom-2 left-1 origin-bottom-left -rotate-90 font-mono text-cyan-400/80"
          style={{ fontSize: Math.max(9, fontPx - 1) }}
        >
          {axisHint.y}
        </div>
      </div>

      {/* 左上角銜接 */}
      <div
        data-area-ruler-drag
        className={`absolute border-b border-r border-cyan-600/40 bg-zinc-950/95 ${showMoveHint ? 'pointer-events-auto cursor-move' : 'pointer-events-none'}`}
        style={{
          left: -bandLeft,
          top: -bandTop,
          width: bandLeft,
          height: bandTop,
        }}
        title={showMoveHint ? '拖曳移動 Area' : undefined}
        aria-hidden
      />

      {!fieldMode &&
        xStep > 0 &&
        buildMeterTicks(domain.xMinM, domain.xMaxM, xStep / 2)
          .filter((m) => !xTicks.some((t) => Math.abs(t.valueM - m) < 1e-6))
          .map((m) => {
            const { x } = meterToAreaLocalPx(m, domain.yMinM, domain, layout)
            if (x < 0 || x > layout.wPx) return null
            return (
              <div
                key={`x-minor-${m}`}
                className="absolute bg-cyan-700/50"
                style={{
                  left: x,
                  top: -minorTick,
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
