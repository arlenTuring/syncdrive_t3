import type {
  FacilityType,
  NonSlotFacilityState,
  PSDState,
  PoleState,
  SignalState,
  SlotEquipmentState,
  SlotFacility,
  SlotOccupancy,
  TrackState,
  FacilityAreaState,
  GeofenceState,
  DockingPointState,
  WaypointState,
  RoadLineState,
  BasemapState,
} from '../types/facility'

export const SLOT_OCCUPANCY: readonly SlotOccupancy[] = [
  'Vacant',
  'Occupied',
] as const

export const SLOT_EQUIPMENT_STATES: readonly SlotEquipmentState[] = [
  'Idle',
  'Working',
  'Charging',
  'Repairing',
  'Error',
] as const

export const PSD_STATES: readonly PSDState[] = [
  'Open',
  'Closed',
  'Moving',
  'Alarm',
] as const

export const SIGNAL_STATES: readonly SignalState[] = [
  'Normal',
  'Warning',
  'Fault',
  'Offline',
] as const

export const TRACK_STATES: readonly TrackState[] = [
  'Idle',
  'Occupied',
  'Error',
] as const

export const POLE_STATES: readonly PoleState[] = ['Normal', 'Error'] as const

export const DOCKING_POINT_STATES: readonly DockingPointState[] = [
  'Normal',
  'Inactive',
] as const

export const WAYPOINT_STATES: readonly WaypointState[] = [
  'Normal',
  'Inactive',
] as const

export const ROAD_LINE_STATES: readonly RoadLineState[] = ['Normal'] as const

export const BASEMAP_STATES: readonly BasemapState[] = ['Normal'] as const

export const FACILITY_AREA_STATES: readonly FacilityAreaState[] = [
  'Normal',
  'Occupied',
  'Warning',
  'Error',
] as const

/** @deprecated */
export const ZONE_STATES = FACILITY_AREA_STATES

export const GEOFENCE_STATES: readonly GeofenceState[] = ['Normal'] as const

export const STATES_BY_TYPE: Record<
  Exclude<FacilityType, 'Slot'>,
  readonly NonSlotFacilityState[]
> = {
  PSD: PSD_STATES,
  Signal: SIGNAL_STATES,
  Track: TRACK_STATES,
  Pole: POLE_STATES,
  DockingPoint: DOCKING_POINT_STATES,
  Waypoint: WAYPOINT_STATES,
  RoadLine: ROAD_LINE_STATES,
  Basemap: BASEMAP_STATES,
  Facility: FACILITY_AREA_STATES,
  Geofence: GEOFENCE_STATES,
}

export function getDefaultSlotOccupancy(): SlotOccupancy {
  return 'Vacant'
}

export function getDefaultSlotEquipmentState(): SlotEquipmentState {
  return 'Idle'
}

export function getDefaultStateForType(
  type: Exclude<FacilityType, 'Slot'>,
): NonSlotFacilityState {
  const list = STATES_BY_TYPE[type]
  return list[0] as NonSlotFacilityState
}

export function migrateLegacySlotState(legacy: string): {
  slotOccupancy: SlotOccupancy
  slotEquipmentState: SlotEquipmentState
} {
  switch (legacy) {
    case 'Empty':
      return { slotOccupancy: 'Vacant', slotEquipmentState: 'Idle' }
    case 'Working':
      return { slotOccupancy: 'Occupied', slotEquipmentState: 'Working' }
    case 'Full':
      return { slotOccupancy: 'Occupied', slotEquipmentState: 'Idle' }
    case 'Charging':
      return { slotOccupancy: 'Occupied', slotEquipmentState: 'Charging' }
    case 'Repairing':
      return { slotOccupancy: 'Occupied', slotEquipmentState: 'Repairing' }
    case 'Error':
      return { slotOccupancy: 'Vacant', slotEquipmentState: 'Error' }
    default:
      return { slotOccupancy: 'Vacant', slotEquipmentState: 'Idle' }
  }
}

export function isSlotOccupancy(v: unknown): v is SlotOccupancy {
  return v === 'Vacant' || v === 'Occupied'
}

export function isSlotEquipmentState(v: unknown): v is SlotEquipmentState {
  return (
    v === 'Idle' ||
    v === 'Working' ||
    v === 'Charging' ||
    v === 'Repairing' ||
    v === 'Error'
  )
}

export function resolveSlotOccupancyEnabled(f: SlotFacility): Record<
  SlotOccupancy,
  boolean
> {
  const out: Record<SlotOccupancy, boolean> = {
    Vacant: true,
    Occupied: true,
  }
  for (const k of SLOT_OCCUPANCY) {
    if (f.slotOccupancyEnabled?.[k] === false) out[k] = false
  }
  return out
}

export function resolveSlotEquipmentEnabled(f: SlotFacility): Record<
  SlotEquipmentState,
  boolean
> {
  const out = {} as Record<SlotEquipmentState, boolean>
  for (const k of SLOT_EQUIPMENT_STATES) {
    out[k] = f.slotEquipmentEnabled?.[k] !== false
  }
  return out
}
