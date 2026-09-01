import {
  BatteryCharging,
  Car,
  CircleDot,
  DoorClosed,
  Droplets,
  Image as ImageIcon,
  LayoutGrid,
  MapPin,
  Minus,
  Pentagon,
  Radio,
  Signal as SignalIcon,
  TrainTrack,
  Waypoints,
  Wrench,
  CornerDownRight,
  Spline,
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
  RailCorner: CornerDownRight,
  RailTaper: Spline,
  SmartPole: Radio,
  DockingPoint: MapPin,
  Waypoint: CircleDot,
  RoadLine: Minus,
  TrackCrossover: Waypoints,
  Basemap: ImageIcon,
}

/** Area 容器圖示（資產列） */
export const AREA_PALETTE_ICON = LayoutGrid
