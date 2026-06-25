import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  resizeCursorForEdge,
  RESIZE_EDGE_HIT,
  type ElementResizeEdge,
} from './elementResize';

const EDGE_HANDLES: {
  edge: ElementResizeEdge;
  style: CSSProperties;
}[] = [
  { edge: 'left', style: { left: -RESIZE_EDGE_HIT / 2, top: 0, width: RESIZE_EDGE_HIT, height: '100%' } },
  { edge: 'right', style: { right: -RESIZE_EDGE_HIT / 2, top: 0, width: RESIZE_EDGE_HIT, height: '100%' } },
  { edge: 'top', style: { left: RESIZE_EDGE_HIT, right: RESIZE_EDGE_HIT, top: -RESIZE_EDGE_HIT / 2, height: RESIZE_EDGE_HIT } },
  { edge: 'bottom', style: { left: RESIZE_EDGE_HIT, right: RESIZE_EDGE_HIT, bottom: -RESIZE_EDGE_HIT / 2, height: RESIZE_EDGE_HIT } },
];

const CORNER_HANDLES: {
  edge: ElementResizeEdge;
  style: CSSProperties;
}[] = [
  { edge: 'nw', style: { left: -RESIZE_EDGE_HIT / 2, top: -RESIZE_EDGE_HIT / 2, width: RESIZE_EDGE_HIT, height: RESIZE_EDGE_HIT } },
  { edge: 'ne', style: { right: -RESIZE_EDGE_HIT / 2, top: -RESIZE_EDGE_HIT / 2, width: RESIZE_EDGE_HIT, height: RESIZE_EDGE_HIT } },
  { edge: 'sw', style: { left: -RESIZE_EDGE_HIT / 2, bottom: -RESIZE_EDGE_HIT / 2, width: RESIZE_EDGE_HIT, height: RESIZE_EDGE_HIT } },
  { edge: 'se', style: { right: -RESIZE_EDGE_HIT / 2, bottom: -RESIZE_EDGE_HIT / 2, width: RESIZE_EDGE_HIT, height: RESIZE_EDGE_HIT } },
];

export function RotatedElementResizeHandles({
  rotationDeg,
  edges = ['left', 'right', 'top', 'bottom'],
  showCornerHandles = true,
  showSelectionBorder = true,
  hitSize = RESIZE_EDGE_HIT,
  dataAttribute = 'data-resize-handle',
  onResizePointerDown,
}: {
  rotationDeg: number;
  edges?: Array<'left' | 'right' | 'top' | 'bottom'>;
  showCornerHandles?: boolean;
  showSelectionBorder?: boolean;
  hitSize?: number;
  dataAttribute?: string;
  onResizePointerDown: (edge: ElementResizeEdge, e: ReactPointerEvent) => void;
}) {
  const edgeSet = new Set(edges);
  const scale = hitSize / RESIZE_EDGE_HIT;

  const scaleStyle = (style: CSSProperties): CSSProperties => {
    if (scale === 1) return style;
    const next: CSSProperties = { ...style };
    if (typeof next.left === 'number') next.left = (next.left / RESIZE_EDGE_HIT) * hitSize;
    if (typeof next.right === 'number') next.right = (next.right / RESIZE_EDGE_HIT) * hitSize;
    if (typeof next.top === 'number') next.top = (next.top / RESIZE_EDGE_HIT) * hitSize;
    if (typeof next.bottom === 'number') next.bottom = (next.bottom / RESIZE_EDGE_HIT) * hitSize;
    if (typeof next.width === 'number') next.width = (next.width / RESIZE_EDGE_HIT) * hitSize;
    if (typeof next.height === 'number') next.height = (next.height / RESIZE_EDGE_HIT) * hitSize;
    if (typeof next.left === 'string' && next.left.includes('RESIZE')) {
      /* keep percentage strings */
    }
    return next;
  };

  return (
    <>
      {showSelectionBorder && (
        <div className="pointer-events-none absolute inset-0 rounded border border-cyan-400/85" />
      )}
      {EDGE_HANDLES.filter(({ edge }) => edgeSet.has(edge as 'left' | 'right' | 'top' | 'bottom')).map(
        ({ edge, style }) => {
          const cursor = resizeCursorForEdge(edge, rotationDeg);
          return (
            <div
              key={edge}
              {...{ [dataAttribute]: edge }}
              role="presentation"
              className="pointer-events-auto group absolute z-20 touch-none"
              style={{ ...scaleStyle(style), cursor }}
              onPointerDown={(e) => onResizePointerDown(edge, e)}
            >
              <div
                className={`absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-cyan-400/90 bg-zinc-900 opacity-0 transition-opacity group-hover:opacity-100 ${edge === 'left' || edge === 'right' ? 'hidden' : ''}`}
              />
            </div>
          );
        },
      )}
      {showCornerHandles &&
        CORNER_HANDLES.map(({ edge, style }) => {
          const cursor = resizeCursorForEdge(edge, rotationDeg);
          return (
            <div
              key={edge}
              {...{ [dataAttribute]: edge }}
              role="presentation"
              className="pointer-events-auto group absolute z-20 touch-none"
              style={{ ...scaleStyle(style), cursor }}
              onPointerDown={(e) => onResizePointerDown(edge, e)}
            >
              <div
                className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-cyan-400 bg-cyan-500/80 opacity-70 transition-opacity group-hover:opacity-100"
                style={{ cursor }}
              />
            </div>
          );
        })}
    </>
  );
}
