import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { tokenVar } from '../../../styles/tokens'
import type { HistoryPoint } from '../api/systemHealthApi'
import { HEALTH_ALERT_COLOR, HEALTH_SERIES_COLOR } from './healthSeriesColors'

const SERIES_META = [
  { key: 'cpuUsagePercent' as const, labelKey: 'systemFoundation.health.cpuUsage', color: HEALTH_SERIES_COLOR.cpuUsagePercent, unit: '%' },
  { key: 'cpuTempC' as const, labelKey: 'systemFoundation.health.cpuTemp', color: HEALTH_SERIES_COLOR.cpuTempC, unit: '°C' },
  { key: 'memoryUsagePercent' as const, labelKey: 'systemFoundation.health.memoryUsage', color: HEALTH_SERIES_COLOR.memoryUsagePercent, unit: '%' },
  {
    key: 'diskFreePercent' as const,
    labelKey: 'systemFoundation.health.diskFree',
    color: HEALTH_SERIES_COLOR.diskFreePercent,
    unit: '%',
  },
]

type Props = {
  points: HistoryPoint[]
  memoryWarnPercent: number
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function HealthTrendChart({ points, memoryWarnPercent }: Props) {
  const { t } = useTranslation()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [width, setWidth] = useState(800)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && Number.isFinite(w)) setWidth(Math.max(320, w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const height = 280
  const pad = { top: 20, right: 24, bottom: 36, left: 44 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  const times = useMemo(
    () => points.map((p) => Date.parse(p.at)).filter(Number.isFinite),
    [points],
  )
  const tMin = times[0] ?? Date.now() - 3600_000
  const tMax = times[times.length - 1] ?? Date.now()
  const tSpan = Math.max(1, tMax - tMin)

  const xAt = (time: number) => pad.left + ((time - tMin) / tSpan) * plotW
  const yAt = (v: number) => pad.top + (1 - Math.min(100, Math.max(0, v)) / 100) * plotH

  const series = useMemo(
    () =>
      SERIES_META.map((s) => ({
        ...s,
        label: t(s.labelKey),
      })),
    [t],
  )

  const paths = useMemo(() => {
    return series.map((s) => {
      const coords: Array<{ x: number; y: number; i: number }> = []
      points.forEach((p, i) => {
        const raw = p[s.key]
        if (raw == null || !Number.isFinite(raw)) return
        const time = Date.parse(p.at)
        if (!Number.isFinite(time)) return
        coords.push({ x: xAt(time), y: yAt(raw), i })
      })
      if (coords.length < 2) return { ...s, d: '', coords }
      const d = coords
        .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
        .join(' ')
      return { ...s, d, coords }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- xAt/yAt depend on layout
  }, [points, plotW, plotH, tMin, tSpan, series])

  const tickCount = 6
  const xTicks = Array.from({ length: tickCount }, (_, i) => {
    const time = tMin + (tSpan * i) / (tickCount - 1)
    const iso = new Date(time).toISOString()
    return {
      t: time,
      label:
        i === tickCount - 1
          ? t('systemFoundation.health.now', { time: formatTime(iso) })
          : formatTime(iso),
    }
  })
  const yTicks = [0, 25, 50, 75, 100]

  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null
  const memOver =
    hoverPoint?.memoryUsagePercent != null &&
    hoverPoint.memoryUsagePercent >= memoryWarnPercent

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        width={width}
        height={height}
        className="block w-full select-none"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          if (!points.length) return
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left
          let best = 0
          let bestDist = Infinity
          points.forEach((p, i) => {
            const time = Date.parse(p.at)
            if (!Number.isFinite(time)) return
            const dx = Math.abs(xAt(time) - x)
            if (dx < bestDist) {
              bestDist = dx
              best = i
            }
          })
          setHoverIdx(best)
        }}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={pad.left}
              x2={pad.left + plotW}
              y1={yAt(v)}
              y2={yAt(v)}
              style={{ stroke: tokenVar('border-quaternary') }}
              strokeWidth={1}
            />
            <text
              x={pad.left - 8}
              y={yAt(v) + 4}
              textAnchor="end"
              className="fill-text-quaternary"
              fontSize={11}
            >
              {v}
            </text>
          </g>
        ))}

        {xTicks.map((tick) => (
          <text
            key={tick.t}
            x={xAt(tick.t)}
            y={height - 10}
            textAnchor="middle"
            className="fill-text-quaternary"
            fontSize={11}
          >
            {tick.label}
          </text>
        ))}

        {paths.map((s) =>
          s.d ? (
            <path
              key={s.key}
              d={s.d}
              fill="none"
              style={{ stroke: s.color }}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null,
        )}

        {hoverIdx != null && points[hoverIdx] ? (
          <>
            <line
              x1={xAt(Date.parse(points[hoverIdx].at))}
              x2={xAt(Date.parse(points[hoverIdx].at))}
              y1={pad.top}
              y2={pad.top + plotH}
              style={{ stroke: tokenVar('border-primary') }}
              strokeDasharray="4 4"
            />
            {series.map((s) => {
              const v = points[hoverIdx][s.key]
              if (v == null) return null
              const alert =
                s.key === 'memoryUsagePercent' && v >= memoryWarnPercent
              return (
                <circle
                  key={s.key}
                  cx={xAt(Date.parse(points[hoverIdx].at))}
                  cy={yAt(v)}
                  r={4}
                  style={{ fill: alert ? HEALTH_ALERT_COLOR : s.color, stroke: tokenVar('surface-sub-background') }}
                  strokeWidth={1.5}
                />
              )
            })}
          </>
        ) : null}
      </svg>

      {hoverPoint ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[200px] rounded-lg border border-border-quaternary bg-surface-popup px-3 py-2 text-body-xs shadow-xl"
          style={{
            left: Math.min(
              width - 220,
              Math.max(
                8,
                xAt(Date.parse(hoverPoint.at)) - 100,
              ),
            ),
            top: 28,
          }}
        >
          {series.map((s) => {
            const v = hoverPoint[s.key]
            const alert =
              s.key === 'memoryUsagePercent' &&
              v != null &&
              v >= memoryWarnPercent
            return (
              <div
                key={s.key}
                className={`flex items-center justify-between gap-4 py-0.5 ${
                  alert ? 'font-medium text-status-error-emphasis' : 'text-text-primary'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ background: alert ? HEALTH_ALERT_COLOR : s.color }}
                  />
                  {s.label}
                </span>
                <span>
                  {v == null
                    ? '—'
                    : `${v.toFixed(0)}${s.unit}${
                        alert
                          ? t('systemFoundation.health.overThreshold', {
                              percent: memoryWarnPercent,
                            })
                          : ''
                      }`}
                </span>
              </div>
            )
          })}
          {memOver ? null : null}
        </div>
      ) : null}

      {!points.length ? (
        <div className="absolute inset-0 flex items-center justify-center text-body-s text-text-quaternary">
          {t('systemFoundation.health.noHistory')}
        </div>
      ) : null}
    </div>
  )
}
