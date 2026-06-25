import type { MapAreaLayout } from '../types/area'

function isFullyTransparentColor(color: string): boolean {
  const t = color.trim()
  if (!t || t === 'transparent') return true
  if (/^#([0-9a-f]{3,8})00$/i.test(t)) return true
  if (/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*0(?:\.0+)?\s*\)$/i.test(t)) {
    return true
  }
  return false
}

/** 解析 Area 底色；預設透明 */
export function resolveAreaFillStyle(layout: MapAreaLayout): {
  backgroundColor: string
} {
  const raw = layout.fillColor?.trim()
  if (!raw || isFullyTransparentColor(raw)) {
    return { backgroundColor: 'transparent' }
  }
  return { backgroundColor: raw }
}

/** 解析 Area 外框 CSS；預設透明（borderPx 0 或 borderColor transparent） */
export function resolveAreaBorderStyle(layout: MapAreaLayout): {
  borderWidthPx: number
  borderColor: string
} {
  const borderPx = Math.max(0, layout.borderPx ?? 0)
  const borderColor =
    layout.borderColor?.trim() && layout.borderColor.trim().length > 0
      ? layout.borderColor.trim()
      : 'transparent'

  const visible = borderPx > 0 && !isFullyTransparentColor(borderColor)

  return {
    borderWidthPx: visible ? borderPx : 0,
    borderColor: visible ? borderColor : 'transparent',
  }
}
