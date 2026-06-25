import {
  isMarqueeDrag,
  marqueeRectsIntersect,
  normalizeMarqueeRect,
  type MarqueeRect,
} from '../../dashboard/utils/marqueeSelect';
import type { VehicleElement } from '../types';

export type { MarqueeRect };
export { isMarqueeDrag, normalizeMarqueeRect };

export function vehicleElementsInMarquee(
  elements: VehicleElement[],
  marquee: MarqueeRect,
): string[] {
  return elements
    .filter((el) =>
      marqueeRectsIntersect(marquee, {
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
      }),
    )
    .map((el) => el.id);
}
