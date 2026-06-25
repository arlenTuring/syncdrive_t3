export type {
  AreaVehicleLive,
  MapVehicleCssLayer,
  MapVehicleIconSpec,
  MapVehicleLabelLayer,
  MapVehicleLayer,
  MapVehicleSvgBodyLayer,
} from './types'
export { DEFAULT_MAP_VEHICLE_ICON } from './defaultMapVehicleIcon'
export { MapVehicleMarker } from './MapVehicleMarker'
export { MapAreaVehicleOverlay } from './MapAreaVehicleOverlay'
export {
  resolveVehicleTrackPlacementInArea,
  resolveVehiclePlacementAcrossAreas,
  resolveTrackCodeForDisplay,
  fieldPositionToTrackAreaLocal,
  buildTrackNetwork,
  getTrackNetwork,
  findRefFieldOverlaps,
} from './resolveVehicleTrackPlacement'
export type { VehicleTrackPlacement, VehiclePlacementAcrossAreas, TrackNetwork } from './resolveVehicleTrackPlacement'
export { buildDemoAreaVehicles } from './demoAreaVehicles'
export { resolveMapVehicleBgColor } from './resolveMapVehicleAppearance'
