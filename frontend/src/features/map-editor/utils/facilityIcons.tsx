import {
  BatteryCharging,
  Car,
  DoorClosed,
  Droplets,
  LayoutGrid,
  MapPin,
  Minus,
  Pentagon,
  Radio,
  Signal as SignalIcon,
  TrainTrack,
  Wrench,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { FacilityName } from '../types/facility'

export const PALETTE_ICON_BY_NAME: Record<
  FacilityName,
  ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  Parking: Car,
  Charging: BatteryCharging,
  Wash: Droplets,
  Repair: Wrench,
  FacilityArea: LayoutGrid,
  Geofence: Pentagon,
  Gate: DoorClosed,
  Light: SignalIcon,
  Rail: TrainTrack,
  SmartPole: Radio,
  DockingPoint: MapPin,
  RoadLine: Minus,
}

/** Area 容器圖示（資產列） */
export const AREA_PALETTE_ICON = LayoutGrid
