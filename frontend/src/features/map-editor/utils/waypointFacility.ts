import type { FacilityObject } from '../types/facility'

export const WAYPOINT_CODE_KEY = 'waypointCode'

export function getWaypointCode(facility: FacilityObject): string {
  if (facility.type !== 'Waypoint') return ''
  const raw = facility.parameters?.[WAYPOINT_CODE_KEY]
  return typeof raw === 'string' ? raw.trim() : ''
}
