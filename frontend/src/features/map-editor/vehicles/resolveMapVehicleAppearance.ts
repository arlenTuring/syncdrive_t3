import { HEALTH_STATUS_ICON_BG } from '../../dashboard/constants/healthStatusTheme'
import type { AreaVehicleLive } from './types'

const HEALTH_KEYS = [
  'overall_health',
  'health',
  'status',
  'card_border_color',
] as const

export function resolveMapVehicleBgColor(
  vehicle: AreaVehicleLive,
  fallback = '#51A2FF',
): string {
  const { payload } = vehicle
  for (const key of HEALTH_KEYS) {
    const raw = payload[key]
    if (raw === undefined || raw === null) continue
    const health = String(raw).trim().toUpperCase()
    if (HEALTH_STATUS_ICON_BG[health]) return HEALTH_STATUS_ICON_BG[health]
  }
  const iconBg = payload.icon_bg_color ?? payload.iconBgColor
  if (iconBg !== undefined && iconBg !== null && String(iconBg).trim()) {
    return String(iconBg)
  }
  return fallback
}
