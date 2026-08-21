import { normalizeDegrees } from '../features/map-editor/utils/rotation';

const MIN_SIZE = 8;

export type ElementResizeEdge =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'nw'
  | 'ne'
  | 'sw'
  | 'se';

/** 螢幕／畫布座標拖曳量 → 元件本地座標（已考慮旋轉） */
export function screenDeltaToLocal(
  dx: number,
  dy: number,
  rotationDeg: number,
): { dx: number; dy: number } {
  const rad = (-normalizeDegrees(rotationDeg) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    dx: dx * cos - dy * sin,
    dy: dx * sin + dy * cos,
  };
}

/** 依旋轉角度調整 resize 游標方向 */
export function resizeCursorForEdge(edge: ElementResizeEdge, rotationDeg: number): string {
  const edgeAngle: Record<ElementResizeEdge, number> = {
    left: 0,
    right: 0,
    top: 90,
    bottom: 90,
    nw: 45,
    ne: 135,
    sw: 135,
    se: 45,
  };
  const a = normalizeDegrees(edgeAngle[edge] + rotationDeg) % 180;
  if (a < 22.5 || a >= 157.5) return 'ew-resize';
  if (a >= 67.5 && a < 112.5) return 'ns-resize';
  if (a < 90) return 'nwse-resize';
  return 'nesw-resize';
}

export function applyElementResize(
  edge: ElementResizeEdge,
  dx: number,
  dy: number,
  start: { x: number; y: number; width: number; height: number },
  options?: { anchorCenter?: boolean; minWidth?: number; minHeight?: number },
): { x: number; y: number; width: number; height: number } {
  let { x, y, width, height } = start;
  const minW = options?.minWidth ?? MIN_SIZE;
  const minH = options?.minHeight ?? MIN_SIZE;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const right = x + width;
  const bottom = y + height;

  if (edge === 'left' || edge === 'nw' || edge === 'sw') {
    const nextW = Math.max(minW, width - dx);
    if (options?.anchorCenter) width = nextW;
    else {
      x = right - nextW;
      width = nextW;
    }
  }
  if (edge === 'right' || edge === 'ne' || edge === 'se') {
    width = Math.max(minW, width + dx);
  }
  if (edge === 'top' || edge === 'nw' || edge === 'ne') {
    const nextH = Math.max(minH, height - dy);
    if (options?.anchorCenter) height = nextH;
    else {
      y = bottom - nextH;
      height = nextH;
    }
  }
  if (edge === 'bottom' || edge === 'sw' || edge === 'se') {
    height = Math.max(minH, height + dy);
  }

  if (options?.anchorCenter) {
    return {
      x: Math.round(cx - width / 2),
      y: Math.round(cy - height / 2),
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** 四邊 resize：旋轉時以中心為錨點，未旋轉時沿用對邊錨點 */
export function applyEdgeResizePx(
  edge: 'left' | 'right' | 'top' | 'bottom',
  dX: number,
  dY: number,
  start: { w: number; h: number; x: number; y: number },
  rotationDeg: number,
): { w: number; h: number; x: number; y: number } {
  const rot = normalizeDegrees(rotationDeg);
  if (rot % 360 !== 0) {
    const local = screenDeltaToLocal(dX, dY, rot);
    const result = applyElementResize(
      edge,
      local.dx,
      local.dy,
      { x: start.x, y: start.y, width: start.w, height: start.h },
      { anchorCenter: true },
    );
    return { w: result.width, h: result.height, x: result.x, y: result.y };
  }

  let newW = start.w;
  let newH = start.h;
  let newX = start.x;
  let newY = start.y;
  if (edge === 'right') {
    newW = start.w + dX;
  } else if (edge === 'left') {
    newW = start.w - dX;
    newX = start.x + (start.w - newW);
  } else if (edge === 'bottom') {
    newH = start.h + dY;
  } else if (edge === 'top') {
    newH = start.h - dY;
    newY = start.y + (start.h - newH);
  }
  return { w: newW, h: newH, x: newX, y: newY };
}

export const RESIZE_EDGE_HIT = 8;

/** 畫布縮放：只改寬高，不移動原點；拖哪邊就由呼叫端固定對邊 */
export function applyCanvasResize(
  edge: ElementResizeEdge,
  dx: number,
  dy: number,
  start: { width: number; height: number },
  options?: { minWidth?: number; minHeight?: number },
): { width: number; height: number } {
  const minW = options?.minWidth ?? MIN_SIZE;
  const minH = options?.minHeight ?? MIN_SIZE;
  let { width, height } = start;

  if (edge === 'left' || edge === 'nw' || edge === 'sw') {
    width = Math.max(minW, width - dx);
  }
  if (edge === 'right' || edge === 'ne' || edge === 'se') {
    width = Math.max(minW, width + dx);
  }
  if (edge === 'top' || edge === 'nw' || edge === 'ne') {
    height = Math.max(minH, height - dy);
  }
  if (edge === 'bottom' || edge === 'sw' || edge === 'se') {
    height = Math.max(minH, height + dy);
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}
