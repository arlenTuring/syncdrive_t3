import { useMemo } from 'react';
import type { CanvasElementProps, RouteActionIconRule, VehicleContainerWidget } from '../types';
import { resolveVehicleDefinition } from '../../vehicle-editor/storage/vehicleDefinitionStorage';
import type { VehicleDefinition } from '../../vehicle-editor/types';
import { useMapVehicleModel } from '../../vehicle-editor/model/useMapVehicleModel';

/**
 * 圖台車輛樣板：模型＋顯示尺寸上限框＋行為圖示設定。
 * 顯示尺寸只是上限框，車身依模型自己的比例等比塞進去（見 fitVehicleMarkerSize）。
 */
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

/**
 * 舊格式相容：模型與尺寸還存在儀表板圖台元件的「載具容器」上（搬到圖資管理之前的做法）。
 *
 * 只認明確的模型 ID。以前還會依名稱「VTMS 巴士 · PMS01」或清單第一筆補一個模型，
 * 那不是使用者的選擇，不再採用。這張地圖在圖資管理設定之後就不會走到這裡；
 * 等所有地圖都遷移完，這段可以拿掉（遷移見 圖資管理 → 車輛模型 → 遷移）。
 */
export function resolveLegacyCanvasVehicleTemplate(
  canvas: CanvasElementProps,
): MapVehicleTemplateConfig | null {
  const widget = findVehicleContainerTemplate(canvas);
  const definitionId = widget?.vehicleDefinitionId ?? canvas.vehicleDefinitionId;
  if (!definitionId) return null;
  const definition = resolveVehicleDefinition(definitionId);
  if (!definition) return null;
  const displayWidthPx = widget?.width ?? canvas.vehicleDisplayWidthPx;
  const displayHeightPx = widget?.height ?? canvas.vehicleDisplayHeightPx;
  if (!displayWidthPx || !displayHeightPx) return null;
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

/**
 * 儀表板圖台用的車輛樣板。順序只看明確引用：
 * 1. 圖資管理裡這張地圖的設定
 * 2. 這個圖台元件上舊的載具容器（尚未遷移的舊資料）
 * 3. 系統預設模型
 */
export function useCanvasMapVehicleTemplate(
  element: CanvasElementProps,
  enabled: boolean,
): MapVehicleTemplateConfig | null {
  const remote = useMapVehicleModel(enabled ? element.mapId : null);
  const legacy = useMemo(
    () => (enabled ? resolveLegacyCanvasVehicleTemplate(element) : null),
    [element, enabled],
  );
  if (!enabled) return null;
  const source = remote.resolution?.source;
  if (source === 'map') return remote.template;
  if (legacy) return legacy;
  return source === 'default' ? remote.template : null;
}
