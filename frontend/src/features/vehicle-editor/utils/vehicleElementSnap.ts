import {
  snapDragRectWithAlignGuides,
  type AlignGuideLine,
} from '../../map-editor/utils/facilityDragAlign';
import type { VehicleElement } from '../types';

function toSnapRect(el: Pick<VehicleElement, 'x' | 'y' | 'width' | 'height'>) {
  return { left: el.x, top: el.y, width: el.width, height: el.height };
}

/** 拖曳元件時對齊其他元件邊／中心與畫布邊界 */
export function snapVehicleElementPosition(
  moving: Pick<VehicleElement, 'x' | 'y' | 'width' | 'height'>,
  peers: Array<Pick<VehicleElement, 'x' | 'y' | 'width' | 'height'>>,
  canvasWidth: number,
  canvasHeight: number,
  thresholdPx = 4,
): { x: number; y: number; guides: AlignGuideLine[] } {
  const { rect, guides } = snapDragRectWithAlignGuides(
    toSnapRect(moving),
    peers.map(toSnapRect),
    { left: 0, top: 0, width: canvasWidth, height: canvasHeight },
    thresholdPx,
  );
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    guides,
  };
}

export type { AlignGuideLine };
