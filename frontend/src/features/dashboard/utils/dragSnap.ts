import {
  snapDragRectWithAlignGuides,
  snapResizeRectWithAlignGuides,
  type AlignGuideLine,
  type ResizeDirection,
} from '../../map-editor/utils/facilityDragAlign';

export type { AlignGuideLine, ResizeDirection };

export type DashboardRect = { x: number; y: number; width: number; height: number };

const DEFAULT_THRESHOLD = 3;

function toSnapRect(r: DashboardRect) {
  return { left: r.x, top: r.y, width: r.width, height: r.height };
}

function fromSnapRect(r: { left: number; top: number; width: number; height: number }): DashboardRect {
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

/** 拖曳時對齊同層其他元件邊／中心與容器邊界 */
export function snapDashboardPosition(
  moving: DashboardRect,
  peers: DashboardRect[],
  bounds: DashboardRect,
  thresholdPx = DEFAULT_THRESHOLD,
): { x: number; y: number; guides: AlignGuideLine[] } {
  const { rect, guides } = snapDragRectWithAlignGuides(
    toSnapRect(moving),
    peers.map(toSnapRect),
    toSnapRect(bounds),
    thresholdPx,
  );
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    guides,
  };
}

/** 縮放時對齊同層其他元件邊／中心與容器邊界 */
export function snapDashboardResize(
  moving: DashboardRect,
  direction: ResizeDirection,
  peers: DashboardRect[],
  bounds: DashboardRect,
  minSize: { width: number; height: number } = { width: 10, height: 10 },
  thresholdPx = DEFAULT_THRESHOLD,
): { rect: DashboardRect; guides: AlignGuideLine[] } {
  const { rect, guides } = snapResizeRectWithAlignGuides(
    toSnapRect(moving),
    direction,
    peers.map(toSnapRect),
    toSnapRect(bounds),
    thresholdPx,
    minSize,
  );
  return { rect: fromSnapRect(rect), guides };
}
