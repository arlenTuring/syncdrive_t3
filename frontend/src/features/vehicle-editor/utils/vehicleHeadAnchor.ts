import type { VehicleDefinition } from '../types';
import {
  computeVehicleMapRenderBounds,
  mapDisplayContentSize,
} from './vehicleContentBounds';

function findHeadLight(definition: VehicleDefinition) {
  return (
    definition.elements.find((el) => el.type === 'light' && el.visibilityField === 'head_light_on') ??
    definition.elements.find((el) => el.type === 'light')
  );
}

/** 車頭在載具顯示框內的錨點（px，相對於顯示框左上角） */
export function computeVehicleHeadAnchorPx(
  definition: VehicleDefinition,
  mapRotateDeg = 0,
): { x: number; y: number } {
  const bounds = computeVehicleMapRenderBounds(definition);
  const display = mapDisplayContentSize(definition, bounds);
  const head = findHeadLight(definition);
  if (!head) {
    return { x: display.width * 0.08, y: display.height / 2 };
  }

  let hx = head.x + head.width / 2 - bounds.x;
  let hy = head.y + head.height / 2 - bounds.y;

  if (mapRotateDeg !== 0) {
    const cx = display.width / 2;
    const cy = display.height / 2;
    const rad = (mapRotateDeg * Math.PI) / 180;
    const dx = hx - cx;
    const dy = hy - cy;
    hx = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    hy = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
  }

  return { x: hx, y: hy };
}
