import type { VehicleDefinition } from '../types';

export interface VehicleContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 載具元件外框聯集（地圖縮放時裁掉透明留白） */
export function computeVehicleContentBounds(definition: VehicleDefinition): VehicleContentBounds {
  const elements = definition.elements.filter((el) => el.type !== 'behavior');
  if (elements.length === 0) {
    return { x: 0, y: 0, width: definition.width, height: definition.height };
  }

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const el of elements) {
    left = Math.min(left, el.x);
    top = Math.min(top, el.y);
    right = Math.max(right, el.x + el.width);
    bottom = Math.max(bottom, el.y + el.height);
  }

  return {
    x: Math.max(0, left),
    y: Math.max(0, top),
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/** 圖台軌道對齊：以車體為基準（行為圖示不參與置中） */
export function computeVehicleMapAlignBounds(definition: VehicleDefinition): VehicleContentBounds {
  const body = definition.elements.find((el) => el.type === 'body');
  if (body) {
    return { x: body.x, y: body.y, width: body.width, height: body.height };
  }
  return computeVehicleContentBounds(definition);
}

/** 地圖／容器顯示外框：以車體為基準 */
export function computeVehicleMapRenderBounds(definition: VehicleDefinition): VehicleContentBounds {
  return computeVehicleMapAlignBounds(definition);
}

/** 橫向圖台載具（寬 > 高）不需再旋轉 */
export function isLandscapeVehicleDefinition(definition: VehicleDefinition): boolean {
  return definition.width > definition.height * 1.2;
}

/** 直立載具旋轉 -90° 後的邏輯寬高 */
export function mapOrientedContentSize(bounds: VehicleContentBounds): {
  width: number;
  height: number;
} {
  return { width: bounds.height, height: bounds.width };
}

/** 地圖顯示用的內容寬高（橫向畫布不旋轉） */
export function mapDisplayContentSize(
  definition: VehicleDefinition,
  bounds: VehicleContentBounds,
): { width: number; height: number } {
  if (isLandscapeVehicleDefinition(definition)) {
    return { width: bounds.width, height: bounds.height };
  }
  return mapOrientedContentSize(bounds);
}

/** 儀表板載具容器：依車體 1:1 顯示尺寸（含圖台旋轉後外框） */
export function computeVehicleContainerDisplaySize(
  definition: VehicleDefinition,
): { width: number; height: number } {
  const bounds = computeVehicleMapRenderBounds(definition);
  const display = mapDisplayContentSize(definition, bounds);
  return {
    width: Math.max(24, Math.round(display.width)),
    height: Math.max(24, Math.round(display.height)),
  };
}
