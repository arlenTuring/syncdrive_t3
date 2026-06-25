import type { FacilityName } from '../types/facility'
import { SMART_POLE_ENABLE_ICON } from '../utils/mapEditorAssetUrl'

export const FACILITY_BACKGROUND_BY_NAME: Record<FacilityName, string | null> = {
  Parking: '/assets/facilities/parking.png',
  Charging: '/assets/facilities/charging.png',
  Wash: '/assets/facilities/wash.png',
  Repair: '/assets/facilities/repair.png',
  FacilityArea: null,
  Geofence: null,
  Gate: '/assets/facilities/gate.png',
  Light: '/assets/facilities/light.png',
  Rail: '/assets/facilities/rail.png',
  SmartPole: SMART_POLE_ENABLE_ICON,
  DockingPoint: null,
  RoadLine: null,
}
