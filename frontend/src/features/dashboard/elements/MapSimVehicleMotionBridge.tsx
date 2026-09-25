/**
 * 隔離 sim 時鐘 extrapolation：僅此子樹隨 ~20fps tick 重繪，不拖動 MapPlatformLayer 上層。
 */
import type { VehicleRoofIndicatorConfig } from '../../map-editor/vehicles/vehicleRoofIndicator';
import { memo } from 'react';
import { MapAreaCanvas } from '../../map-editor/components/MapAreaCanvas';
import type { MapAreaObject, MapPixelSize } from '../../map-editor/types/area';
import type { AreaVehicleLive } from '../../map-editor/vehicles/types';
import type { MapPlannedRoute } from '../../map-editor/types/mapFile';
import type { MqttLiveEntry } from '../../map-editor/live/mqttLiveTypes';
import type { VehicleDefinition } from '../../vehicle-editor/types';
import { DEFAULT_MAP_VEHICLE_ICON } from '../../map-editor/vehicles/defaultMapVehicleIcon';
import type { MapVehicleBehaviorConfig } from '../elements/MapVehicleBehaviorOverlay';
import { useSimExtrapolatedVehicles } from '../../map-editor/vehicles/useSimExtrapolatedVehicles';

export type MapSimVehicleMotionBridgeProps = {
  pixelSize: MapPixelSize;
  pixelOrigin: { x: number; y: number };
  areas: MapAreaObject[];
  vehiclesRaw: AreaVehicleLive[];
  simPlaybackActive: boolean;
  speedMultiplier: number;
  liveTweenMs: number;
  liveById: Record<string, MqttLiveEntry>;
  showVehicleTelemetry: boolean;
  vehicleDefinition: VehicleDefinition | null;
  vehicleDisplayWidthPx: number;
  vehicleDisplayHeightPx: number;
  routes?: readonly MapPlannedRoute[];
  vehicleBehavior?: MapVehicleBehaviorConfig;
  vehicleRoofIndicator?: VehicleRoofIndicatorConfig | null;
  orderStationsById?: Record<string, readonly string[]>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
};

export const MapSimVehicleMotionBridge = memo(function MapSimVehicleMotionBridge({
  pixelSize,
  pixelOrigin,
  areas,
  vehiclesRaw,
  simPlaybackActive,
  speedMultiplier,
  liveTweenMs,
  liveById,
  showVehicleTelemetry,
  vehicleDefinition,
  vehicleDisplayWidthPx,
  vehicleDisplayHeightPx,
  routes,
  vehicleBehavior,
  vehicleRoofIndicator,
  orderStationsById,
  viewportRef,
}: MapSimVehicleMotionBridgeProps) {
  const areaVehicles = useSimExtrapolatedVehicles(vehiclesRaw, {
    active: simPlaybackActive && vehiclesRaw.length > 0,
    speedMultiplier,
  });

  return (
    <MapAreaCanvas
      pixelSize={pixelSize}
      pixelOrigin={pixelOrigin}
      areas={areas}
      selectedAreaId={null}
      selectedFacilityIds={[]}
      geofenceSelectedLabelId={null}
      viewportRef={viewportRef}
      displayMode="embedded"
      livePositionTweenMs={liveTweenMs}
      readOnly
      editMode={false}
      liveById={liveById}
      areaVehicles={areaVehicles}
      showVehicleTelemetry={showVehicleTelemetry}
      vehicleIconSpec={DEFAULT_MAP_VEHICLE_ICON}
      vehicleDefinition={vehicleDefinition}
      vehicleDisplayWidthPx={vehicleDisplayWidthPx}
      vehicleDisplayHeightPx={vehicleDisplayHeightPx}
      vehicleFitMode="stretch"
      routes={routes}
      vehicleBehavior={vehicleBehavior}
      vehicleRoofIndicator={vehicleRoofIndicator}
      orderStationsById={orderStationsById}
      vehicleEditSizer={null}
      slotPreview={null}
      onSelectArea={() => {}}
      onSelectFacility={() => {}}
      onSelectGeofenceLabel={() => {}}
      onDragFacility={() => {}}
      onDragSessionStart={() => {}}
    />
  );
});
