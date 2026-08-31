import type { OpenDriveBounds } from '../opendrive'

export const BASEMAP_GRID_DIVISIONS = 50

export type BasemapWorldBounds = OpenDriveBounds

export function isBasemapWorldBounds(v: unknown): v is BasemapWorldBounds {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.xmin === 'number' &&
    typeof o.ymin === 'number' &&
    typeof o.xmax === 'number' &&
    typeof o.ymax === 'number' &&
    Number.isFinite(o.xmin) &&
    Number.isFinite(o.ymin) &&
    Number.isFinite(o.xmax) &&
    Number.isFinite(o.ymax) &&
    o.xmax > o.xmin &&
    o.ymax > o.ymin
  )
}

/** 50 格軸線：前 49 格等距，最後一格補齊至 max（吸收浮點誤差） */
export function buildBasemapGridAxis(
  min: number,
  max: number,
  divisions = BASEMAP_GRID_DIVISIONS,
): number[] {
  const span = max - min
  if (!Number.isFinite(span) || span <= 0) return [min, max]
  const step = span / divisions
  const lines = [min]
  for (let i = 1; i < divisions; i++) {
    lines.push(min + i * step)
  }
  lines.push(max)
  return lines
}

export function basemapSpanM(bounds: BasemapWorldBounds): { w: number; h: number } {
  return {
    w: Math.max(1e-6, bounds.xmax - bounds.xmin),
    h: Math.max(1e-6, bounds.ymax - bounds.ymin),
  }
}

export function worldToBasemapPx(
  x: number,
  y: number,
  bounds: BasemapWorldBounds,
  widthPx: number,
  heightPx: number,
): { x: number; y: number } {
  const { w, h } = basemapSpanM(bounds)
  return {
    x: ((x - bounds.xmin) / w) * widthPx,
    y: ((bounds.ymax - y) / h) * heightPx,
  }
}

export function formatBasemapGridLabel(
  value: number,
  cellSize: number,
): string {
  const a = Math.abs(value)
  const decimals = cellSize < 1 ? 2 : cellSize < 10 ? 1 : 0
  if (a >= 1000) return `${(value / 1000).toFixed(decimals)}k`
  return value.toFixed(decimals)
}
