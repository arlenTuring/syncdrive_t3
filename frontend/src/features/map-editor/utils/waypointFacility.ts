import type { FacilityObject } from '../types/facility'

export const WAYPOINT_CODE_KEY = 'waypointCode'
/** @deprecated 已改用 customName；載入時遷移後移除 */
export const WAYPOINT_NAME_KEY = 'waypointName'

export function getWaypointCode(facility: FacilityObject): string {
  if (facility.type !== 'Waypoint') return ''
  const raw = facility.parameters?.[WAYPOINT_CODE_KEY]
  return typeof raw === 'string' ? raw.trim() : ''
}

/** @deprecated 請用 resolveWaypointDisplayName / customName */
export function getWaypointName(facility: FacilityObject): string {
  if (facility.type !== 'Waypoint') return ''
  const raw = facility.parameters?.[WAYPOINT_NAME_KEY]
  return typeof raw === 'string' ? raw.trim() : ''
}

/** 顯示用名稱：自訂顯示名稱 → 舊別名 → 代號 */
export function resolveWaypointDisplayName(facility: FacilityObject): string {
  if (facility.type !== 'Waypoint') return ''
  const custom = facility.customName.trim()
  if (custom) return custom
  const legacy = getWaypointName(facility)
  if (legacy) return legacy
  return getWaypointCode(facility)
}
