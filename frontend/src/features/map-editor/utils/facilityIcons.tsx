import {
  BatteryCharging,
  Car,
  CircleDot,
  DoorClosed,
  Droplets,
  Image as ImageIcon,
  LayoutGrid,
  LogIn,
  MapPin,
  Minus,
  Pentagon,
  Radio,
  Signal as SignalIcon,
  SquareDashed,
  TrainTrack,
  Wrench,
  CornerDownRight,
  Spline,
  GitFork,
  X,
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
  ZoneEntrance: LogIn,
  ZonePartition: SquareDashed,
  Geofence: Pentagon,
  Gate: DoorClosed,
  Light: SignalIcon,
  Rail: TrainTrack,
  RailCorner: CornerDownRight,
  RailTaper: Spline,
  RailSwitch: GitFork,
  RailCross: X,
  SmartPole: Radio,
  DockingPoint: MapPin,
  Waypoint: CircleDot,
  RoadLine: Minus,
  Basemap: ImageIcon,
}

/** Area 容器圖示（資產列） */
export const AREA_PALETTE_ICON = LayoutGrid
