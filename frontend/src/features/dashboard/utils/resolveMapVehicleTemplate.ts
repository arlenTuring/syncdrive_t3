import type { CanvasElementProps, RouteActionIconRule, VehicleContainerWidget } from '../types';
import {
  resolveMapPlatformVehicleDefinition,
} from '../../vehicle-editor/storage/vehicleDefinitionStorage';
import type { VehicleDefinition } from '../../vehicle-editor/types';
import {
  DEFAULT_MAP_VEHICLE_DISPLAY_HEIGHT_PX,
  DEFAULT_MAP_VEHICLE_DISPLAY_WIDTH_PX,
} from '../../map-editor/vehicles/resolveMapVehicleTrackSizing';

/** 圖台載具樣板：由載具容器子元件定義，套用至場域內所有即時車輛 */
export interface MapVehicleTemplateConfig {
  definition: VehicleDefinition | null;
  displayWidthPx: number;
  displayHeightPx: number;
  actionIconRules?: RouteActionIconRule[];
  behaviorOffsetX?: number;
  behaviorOffsetY?: number;
  behaviorIconSize?: number;
  templateWidgetId?: string;
}

export function findVehicleContainerTemplate(
  canvas: CanvasElementProps,
): VehicleContainerWidget | null {
  const child = canvas.children?.find((c) => c.type === 'vehicle-container');
  return (child as VehicleContainerWidget | undefined) ?? null;
}

export function resolveMapVehicleTemplate(
  canvas: CanvasElementProps,
): MapVehicleTemplateConfig {
  const widget = findVehicleContainerTemplate(canvas);

  const definition = resolveMapPlatformVehicleDefinition({
    vehicleDefinitionId: widget?.vehicleDefinitionId ?? canvas.vehicleDefinitionId,
    vehicleDefinitionName: canvas.vehicleDefinitionName,
    useDefaultVehicleDefinition:
      canvas.useDefaultVehicleDefinition ?? Boolean(widget?.vehicleDefinitionId),
  });

  const displayWidthPx =
    widget?.width
    ?? canvas.vehicleDisplayWidthPx
    ?? DEFAULT_MAP_VEHICLE_DISPLAY_WIDTH_PX;
  const displayHeightPx =
    widget?.height
    ?? canvas.vehicleDisplayHeightPx
    ?? DEFAULT_MAP_VEHICLE_DISPLAY_HEIGHT_PX;

  return {
    definition,
    displayWidthPx,
    displayHeightPx,
    actionIconRules: widget?.actionIconRules,
    behaviorOffsetX: widget?.behaviorOffsetX,
    behaviorOffsetY: widget?.behaviorOffsetY,
    behaviorIconSize: widget?.behaviorIconSize,
    templateWidgetId: widget?.id,
  };
}
