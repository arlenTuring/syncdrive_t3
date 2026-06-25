export type MarqueeRect = { x: number; y: number; width: number; height: number };

export function normalizeMarqueeRect(
  x1: number, y1: number, x2: number, y2: number,
): MarqueeRect {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return { x, y, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

export function isMarqueeDrag(rect: MarqueeRect, threshold = 4): boolean {
  return rect.width > threshold || rect.height > threshold;
}

export function marqueeRectsIntersect(a: MarqueeRect, b: MarqueeRect): boolean {
  return (
    a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
  );
}
