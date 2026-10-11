import { describe, expect, it } from 'vitest'
import type { LineChartWidget } from '../types'
import { buildChartScales, makeScale } from './chartAxis'
import { chartNowToleranceMs, resolveChartNowAnchor } from './chartNowAnchor'

/*
 * 實測（10 倍速重播、每 3 秒刷新）：瀏覽器的營運時鐘比後端採樣慢幾秒時，後端「現在」那一列
 * 被當成未來排除，端點掉回前一個 10 分鐘取樣格（x=190），下一輪又回到 205。
 */
const widget = {
  type: 'line-chart',
  xField: 'ts',
  xAxis: { unit: 'time', timeWindow: { enabled: true, pastRatio: 2, futureRatio: 4, totalMinutes: 360 } },
  series: [{ id: 'a', yField: 'actual_util', nowEndpoint: true }],
  refreshInterval: 3,
} as unknown as LineChartWidget

const MIN = 60_000
const base = Date.UTC(2026, 9, 11, 10, 0)

/** 跟後端 buildCapacityTrend 同形狀：10 分鐘取樣格＋「現在」那一列 */
function trend(nowMs: number, nowValue: number | null) {
  const rows: Record<string, unknown>[] = []
  for (let ts = Math.floor((nowMs - 120 * MIN) / (10 * MIN)) * 10 * MIN; ts <= nowMs + 240 * MIN; ts += 10 * MIN) {
    rows.push({ ts, actual_util: ts <= nowMs ? 1000 : null, is_now: false, now_ms: nowMs })
  }
  rows.push({ ts: nowMs, actual_util: nowValue, is_now: true, now_ms: nowMs })
  return rows.sort((a, b) => Number(a.ts) - Number(b.ts))
}

/** 跟 LineChartWidget 同一套計算：回傳虛線與端點的 x */
function render(data: Record<string, unknown>[], clockNowMs: number, rate = 10) {
  const anchor = resolveChartNowAnchor(data, clockNowMs, chartNowToleranceMs(rate, 3))
  const scales = buildChartScales(data, widget, ['actual_util'], undefined, anchor.anchorMs)
  const x = makeScale(scales.xView.min, scales.xView.max, 647)
  const row = anchor.nowRowIndex >= 0 && anchor.status !== 'ahead' ? data[anchor.nowRowIndex] : null
  return {
    anchor,
    nowX: x(0),
    endpointX: row && row.actual_util !== null ? x(scales.xs[anchor.nowRowIndex]) : null,
    endpointValue: row ? row.actual_util : null,
  }
}

describe('chart now anchor', () => {
  it('keeps the endpoint on the now line while the browser clock is a few seconds behind or ahead', () => {
    const sample = base + 22 * MIN
    for (const skewMs of [-25_000, -5_000, 0, 5_000, 25_000]) {
      const r = render(trend(sample, 1110), sample + skewMs)
      expect(r.anchor.status).toBe('fresh')
      expect(r.endpointX).toBeCloseTo(r.nowX, 9)
      expect(r.nowX).toBeCloseTo(647 / 3, 9)
    }
  })

  it('does not slide between refreshes: the clock tick alone does not move anything', () => {
    const sample = base + 22 * MIN
    const data = trend(sample, 1110)
    const positions = [0, 20_000, 40_000].map((tick) => render(data, sample + tick).endpointX)
    expect(new Set(positions.map((x) => x!.toFixed(6))).size).toBe(1)
  })

  it('stays at the same place across consecutive refreshes (recorded 30 s operating steps)', () => {
    const xs: number[] = []
    for (let k = 0; k < 10; k += 1) {
      const sample = base + k * 30_000
      // 瀏覽器時鐘在採樣前後 ±20 秒內擺動
      const r = render(trend(sample, 1000 + k), sample + (k % 2 ? 20_000 : -20_000))
      xs.push(r.endpointX!)
      expect(r.endpointValue).toBe(1000 + k)
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-9)
  })

  it('shows the data at its real time and flags it when the data lags the operating clock', () => {
    const sample = base
    const r = render(trend(sample, 900), sample + 10 * MIN)
    expect(r.anchor.status).toBe('stale')
    expect(r.anchor.lagMs).toBe(10 * MIN)
    // 舊採樣畫在現在虛線左邊，不偽裝成現在值
    expect(r.endpointX!).toBeLessThan(r.nowX)
  })

  it('does not draw a now value that is newer than the clock (clock reset / not yet synced)', () => {
    const sample = base + 60 * MIN
    const r = render(trend(sample, 900), base)
    expect(r.anchor.status).toBe('ahead')
    expect(r.endpointX).toBeNull()
  })

  it('draws 0 but never fills a missing value with 0', () => {
    const sample = base
    expect(render(trend(sample, 0), sample).endpointValue).toBe(0)
    const missing = render(trend(sample, null), sample)
    expect(missing.endpointX).toBeNull()
  })

  it('crosses midnight on timestamps, not on HH:mm', () => {
    const midnight = Date.UTC(2026, 9, 11, 16, 0) // 台北 00:00
    const r = render(trend(midnight + 5 * MIN, 700), midnight + 5 * MIN + 3_000)
    expect(r.endpointX).toBeCloseTo(r.nowX, 9)
  })

  it('scales the tolerance with replay speed', () => {
    expect(chartNowToleranceMs(1, 3)).toBe(60_000)
    expect(chartNowToleranceMs(10, 3)).toBe(100_000)
    expect(chartNowToleranceMs(10, 30)).toBe(900_000)
  })

  it('keeps the old rule for data without a now row', () => {
    const r = resolveChartNowAnchor([{ ts: base, actual_util: 1 }], base + 5_000, 60_000)
    expect(r.status).toBe('none')
    expect(r.anchorMs).toBe(base + 5_000)
  })
})
