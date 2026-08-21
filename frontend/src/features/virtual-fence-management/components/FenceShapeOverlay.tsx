import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  insertFenceVertexOnEdge,
  midpointOfFenceEdge,
} from '../fenceModel';
import type { FenceVertex } from '../types';

type ScreenPt = { x: number; y: number };

type FenceShapeOverlayProps = {
  vertices: FenceVertex[];
  /** 地圖內容座標 → 相對 root 的螢幕座標 */
  mapToScreen: (v: FenceVertex) => ScreenPt | null;
  /** 螢幕 client → 地圖內容座標 */
  clientToMap: (clientX: number, clientY: number) => FenceVertex;
  editing: boolean;
  /** 訂閱縮放／捲動以重算螢幕位置 */
  layoutEpoch: number;
  onVerticesChange: (next: FenceVertex[]) => void;
};

/**
 * 虛擬圍籬幾何覆層：顯示多邊形；編輯時可拖頂點、邊上＋加節點。
 */
export function FenceShapeOverlay({
  vertices,
  mapToScreen,
  clientToMap,
  editing,
  layoutEpoch,
  onVerticesChange,
}: FenceShapeOverlayProps) {
  const [activeEdge, setActiveEdge] = useState<number | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    setTick((n) => n + 1);
  }, [layoutEpoch, vertices]);

  if (vertices.length < 3) return null;

  const screen = vertices
    .map((v) => mapToScreen(v))
    .filter((p): p is ScreenPt => p != null);
  if (screen.length < 3) return null;

  const pointsAttr = screen.map((p) => `${p.x},${p.y}`).join(' ');

  const onVertexPointerDown = (
    e: React.PointerEvent,
    index: number,
  ) => {
    if (!editing) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const start = vertices.map((v) => ({ ...v }));

    const onMove = (ev: PointerEvent) => {
      const p = clientToMap(ev.clientX, ev.clientY);
      const next = start.map((v, i) => (i === index ? p : v));
      onVerticesChange(next);
    };
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const onEdgeClick = (e: React.PointerEvent, edgeIndex: number) => {
    if (!editing) return;
    e.stopPropagation();
    e.preventDefault();
    setActiveEdge(edgeIndex);
  };

  const onAddVertex = (e: React.MouseEvent, edgeIndex: number) => {
    e.stopPropagation();
    onVerticesChange(insertFenceVertexOnEdge(vertices, edgeIndex));
    setActiveEdge(null);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-[15]">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <polygon
          points={pointsAttr}
          fill="rgba(43,127,255,0.22)"
          stroke="#2B7FFF"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {editing
          ? screen.map((_, i) => {
              const a = screen[i]!;
              const b = screen[(i + 1) % screen.length]!;
              return (
                <line
                  key={`edge-${i}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="transparent"
                  strokeWidth={14}
                  className="pointer-events-auto cursor-pointer"
                  onPointerDown={(e) => onEdgeClick(e, i)}
                />
              );
            })
          : null}
      </svg>

      {editing
        ? screen.map((p, i) => (
            <button
              key={`vtx-${i}`}
              type="button"
              className="pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white bg-[#2B7FFF] shadow"
              style={{ left: p.x, top: p.y }}
              title="拖曳頂點"
              onPointerDown={(e) => onVertexPointerDown(e, i)}
            />
          ))
        : null}

      {editing && activeEdge != null
        ? (() => {
            const midMap = midpointOfFenceEdge(vertices, activeEdge);
            const mid = mapToScreen(midMap);
            if (!mid) return null;
            return (
              <button
                type="button"
                className="pointer-events-auto absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#2B7FFF] bg-[#18181b] text-[#51A2FF] shadow"
                style={{ left: mid.x, top: mid.y }}
                title="新增節點"
                onClick={(e) => onAddVertex(e, activeEdge)}
              >
                <Plus className="size-3" strokeWidth={2.5} aria-hidden />
              </button>
            );
          })()
        : null}
    </div>
  );
}
