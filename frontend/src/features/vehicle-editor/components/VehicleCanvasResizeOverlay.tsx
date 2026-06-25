import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { resizeCursorForEdge, type ElementResizeEdge } from '../../../lib/elementResize';

/** 感應區以邊線為中心，內外各半，方便點擊 */
const CANVAS_EDGE_HIT = 16;

function edgeStrip(
  edge: ElementResizeEdge,
  style: CSSProperties,
  onResizePointerDown: (edge: ElementResizeEdge, e: ReactPointerEvent) => void,
) {
  return (
    <div
      key={edge}
      data-vehicle-canvas-resize-handle={edge}
      role="presentation"
      className="pointer-events-auto absolute touch-none hover:bg-cyan-400/15"
      style={{ ...style, cursor: resizeCursorForEdge(edge, 0) }}
      onPointerDown={(e) => onResizePointerDown(edge, e)}
    />
  );
}

/** 載具畫布外圈四邊／四角縮放（感應區跨邊線內外，不擋元件中央） */
export function VehicleCanvasResizeOverlay({
  onResizePointerDown,
  sizeLabel,
}: {
  onResizePointerDown: (edge: ElementResizeEdge, e: ReactPointerEvent) => void;
  sizeLabel: string;
}) {
  const hit = CANVAS_EDGE_HIT;
  const half = hit / 2;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[60]"
      data-vehicle-canvas-resize
    >
      <div className="pointer-events-none absolute inset-0 rounded border-2 border-cyan-400/55" />
      {edgeStrip('left', { left: -half, top: -half, bottom: -half, width: hit }, onResizePointerDown)}
      {edgeStrip('right', { left: `calc(100% - ${half}px)`, top: -half, bottom: -half, width: hit }, onResizePointerDown)}
      {edgeStrip('top', { top: -half, left: -half, right: -half, height: hit }, onResizePointerDown)}
      {edgeStrip('bottom', { top: `calc(100% - ${half}px)`, left: -half, right: -half, height: hit }, onResizePointerDown)}
      {edgeStrip('nw', { left: -half, top: -half, width: hit, height: hit }, onResizePointerDown)}
      {edgeStrip('ne', { left: `calc(100% - ${half}px)`, top: -half, width: hit, height: hit }, onResizePointerDown)}
      {edgeStrip('sw', { left: -half, top: `calc(100% - ${half}px)`, width: hit, height: hit }, onResizePointerDown)}
      {edgeStrip('se', { left: `calc(100% - ${half}px)`, top: `calc(100% - ${half}px)`, width: hit, height: hit }, onResizePointerDown)}
      <div className="pointer-events-none absolute bottom-0 right-0 translate-y-full pt-1 font-mono text-[9px] text-cyan-400/80">
        {sizeLabel}
      </div>
    </div>
  );
}
