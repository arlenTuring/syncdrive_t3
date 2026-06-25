import { LABEL_STYLE_PARAM_KEY } from './facilityLabelStyle'

export const ROAD_LINE_STYLE_KEY = 'roadLineStyle'
export const ROAD_LINE_WIDTH_PX_KEY = 'roadLineWidthPx'
export const ROAD_LINE_COLOR_KEY = 'roadLineColor'

export type RoadLineStyle =
  | 'singleSolid'
  | 'doubleSolid'
  | 'dotted'
  | 'dashed'
  | 'dashedArrows'
  | 'continuousArrows'

export const ROAD_LINE_STYLES: readonly {
  value: RoadLineStyle
  label: string
}[] = [
  { value: 'singleSolid', label: '單實線' },
  { value: 'doubleSolid', label: '雙實線' },
  { value: 'dotted', label: '點線' },
  { value: 'dashed', label: '段落線' },
  { value: 'dashedArrows', label: '段落線段箭頭線' },
  { value: 'continuousArrows', label: '連續線段箭頭線' },
] as const

export const DEFAULT_ROAD_LINE_STYLE: RoadLineStyle = 'singleSolid'
export const DEFAULT_ROAD_LINE_WIDTH_PX = 4
export const DEFAULT_ROAD_LINE_COLOR = '#ffffff'

export function parseRoadLineStyle(raw: unknown): RoadLineStyle {
  if (
    raw === 'singleSolid' ||
    raw === 'doubleSolid' ||
    raw === 'dotted' ||
    raw === 'dashed' ||
    raw === 'dashedArrows' ||
    raw === 'continuousArrows'
  ) {
    return raw
  }
  return DEFAULT_ROAD_LINE_STYLE
}

export function parseRoadLineWidthPx(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(48, Math.max(1, raw))
  }
  return DEFAULT_ROAD_LINE_WIDTH_PX
}

export function parseRoadLineColor(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return DEFAULT_ROAD_LINE_COLOR
}

/** 圖台 bbox 高度至少容納線寬，避免 SVG stroke 被裁切 */
export function resolveRoadLineAreaHeightPx(
  heightPx: number,
  strokeWidthPx: number,
): number {
  const sw = parseRoadLineWidthPx(strokeWidthPx)
  return Math.max(heightPx, sw + 4, 6)
}

export function defaultRoadLineParameters(): Record<string, unknown> {
  return {
    [LABEL_STYLE_PARAM_KEY]: { visible: false },
    [ROAD_LINE_WIDTH_PX_KEY]: DEFAULT_ROAD_LINE_WIDTH_PX,
    [ROAD_LINE_COLOR_KEY]: DEFAULT_ROAD_LINE_COLOR,
  }
}
