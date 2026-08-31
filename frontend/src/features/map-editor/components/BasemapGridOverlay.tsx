import { useMemo } from 'react'
import {
  BASEMAP_GRID_DIVISIONS,
  basemapSpanM,
  buildBasemapGridAxis,
  formatBasemapGridLabel,
  worldToBasemapPx,
  type BasemapWorldBounds,
} from '../utils/basemapGrid'

type Props = {
  bounds: BasemapWorldBounds
  widthPx: number
  heightPx: number
  mapScale?: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

const MAJOR_EVERY = 5
const LABEL_EVERY = 5

export function BasemapGridOverlay({
  bounds,
  widthPx,
  heightPx,
  mapScale = 1,
}: Props) {
  const uiScale = clamp(1 / Math.max(0.2, mapScale), 0.85, 1.35)
  const fontPx = Math.max(6, Math.round(7 * uiScale))
  const tickLen = Math.max(3, Math.round(4 * uiScale))
  const edgePad = Math.max(2, Math.round(3 * uiScale))
  const contentW = Math.max(1, widthPx)
  const contentH = Math.max(1, heightPx)

  const { xLines, yLines, xCell, yCell } = useMemo(() => {
    const xLines = buildBasemapGridAxis(bounds.xmin, bounds.xmax)
    const yLines = buildBasemapGridAxis(bounds.ymin, bounds.ymax)
    const { w, h } = basemapSpanM(bounds)
    return {
      xLines,
      yLines,
      xCell: w / BASEMAP_GRID_DIVISIONS,
      yCell: h / BASEMAP_GRID_DIVISIONS,
    }
  }, [bounds])

  const gridStrokeMinor = 'rgba(34,211,238,0.06)'
  const gridStrokeMajor = 'rgba(34,211,238,0.14)'
  const tickStroke = 'rgba(34,211,238,0.22)'
  const labelFill = 'rgba(148,163,184,0.38)'

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[0] overflow-hidden"
      aria-hidden
    >
      <svg className="absolute inset-0 h-full w-full">
        {xLines.map((m, i) => {
          const { x } = worldToBasemapPx(m, bounds.ymin, bounds, contentW, contentH)
          if (x < -1 || x > contentW + 1) return null
          const major = i % MAJOR_EVERY === 0 || i === xLines.length - 1
          return (
            <line
              key={`gx-${i}-${m}`}
              x1={x}
              y1={0}
              x2={x}
              y2={contentH}
              stroke={major ? gridStrokeMajor : gridStrokeMinor}
              strokeWidth={major ? 0.75 : 0.5}
            />
          )
        })}
        {yLines.map((m, i) => {
          const { y } = worldToBasemapPx(bounds.xmin, m, bounds, contentW, contentH)
          if (y < -1 || y > contentH + 1) return null
          const major = i % MAJOR_EVERY === 0 || i === yLines.length - 1
          return (
            <line
              key={`gy-${i}-${m}`}
              x1={0}
              y1={y}
              x2={contentW}
              y2={y}
              stroke={major ? gridStrokeMajor : gridStrokeMinor}
              strokeWidth={major ? 0.75 : 0.5}
            />
          )
        })}

        {/* X 座標：沿底緣格線刻度 */}
        {xLines.map((m, i) => {
          if (i % LABEL_EVERY !== 0 && i !== xLines.length - 1) return null
          const { x } = worldToBasemapPx(m, bounds.ymin, bounds, contentW, contentH)
          if (x < edgePad || x > contentW - edgePad) return null
          const labelY = contentH - edgePad
          return (
            <g key={`xl-${i}-${m}`}>
              <line
                x1={x}
                y1={contentH - tickLen}
                x2={x}
                y2={contentH}
                stroke={tickStroke}
                strokeWidth={0.75}
              />
              <text
                x={x}
                y={labelY - tickLen - 1}
                textAnchor="middle"
                dominantBaseline="auto"
                fill={labelFill}
                fontSize={fontPx}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {formatBasemapGridLabel(m, xCell)}
              </text>
            </g>
          )
        })}

        {/* Y 座標：沿左緣格線刻度 */}
        {yLines.map((m, i) => {
          if (i % LABEL_EVERY !== 0 && i !== yLines.length - 1) return null
          const { y } = worldToBasemapPx(bounds.xmin, m, bounds, contentW, contentH)
          if (y < edgePad + fontPx * 0.5 || y > contentH - edgePad - fontPx) return null
          return (
            <g key={`yl-${i}-${m}`}>
              <line
                x1={0}
                y1={y}
                x2={tickLen}
                y2={y}
                stroke={tickStroke}
                strokeWidth={0.75}
              />
              <text
                x={edgePad + tickLen + 1}
                y={y}
                textAnchor="start"
                dominantBaseline="middle"
                fill={labelFill}
                fontSize={fontPx}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {formatBasemapGridLabel(m, yCell)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
