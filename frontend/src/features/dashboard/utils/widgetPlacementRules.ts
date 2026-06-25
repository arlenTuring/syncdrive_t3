import type { CanvasElementProps, WidgetType } from '../types';

/** 載具容器僅能放在圖台容器（非群組）內 */
export function canAddWidgetToCanvas(
  canvas: CanvasElementProps | null | undefined,
  widgetType: WidgetType,
): boolean {
  if (widgetType === 'vehicle-container') {
    return canvas?.canvasKind === 'map-platform' && !canvas.isGroup;
  }
  return true;
}
