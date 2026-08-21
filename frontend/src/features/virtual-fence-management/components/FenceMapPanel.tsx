import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Map as MapIcon,
  Pentagon,
  Redo2,
  Square,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { MapAreaCanvas } from '../../map-editor/components/MapAreaCanvas';
import type { MapAreaObject, MapPixelSize } from '../../map-editor/types/area';
import {
  clampMapPixelZoomLevel,
  MAP_PIXEL_ZOOM_DEFAULT_LEVEL,
  MAP_PIXEL_ZOOM_LEVEL_COUNT,
} from '../../map-editor/utils/mapPixelZoom';
import {
  areasWithoutMapGeofences,
  collectTrackSegments,
  rectVerticesFromBounds,
  tracksCoveredByPolygon,
  triangleVerticesAt,
} from '../fenceModel';
import type { FenceCoverageSegment, FenceVertex } from '../types';
import { FenceShapeOverlay } from './FenceShapeOverlay';

type DrawTool = 'rect' | 'polygon';

type ShapeSnapshot = {
  coverage: FenceCoverageSegment[];
  vertices: FenceVertex[];
};

export type FenceMapShape = {
  id: string;
  vertices: FenceVertex[];
};

type FenceMapPanelProps = {
  areas: MapAreaObject[];
  pixelSize: MapPixelSize;
  pixelOrigin: { x: number; y: number };
  /** 眼睛開啟的圍籬形狀（唯讀） */
  mapShapes: FenceMapShape[];
  editing?: boolean;
  coverage: FenceCoverageSegment[];
  /** 編輯／新建中的頂點 */
  vertices: FenceVertex[];
  onShapeChange?: (next: ShapeSnapshot) => void;
};

type Marquee = { x1: number; y1: number; x2: number; y2: number };

function findMapRoot(viewport: HTMLDivElement | null): HTMLElement | null {
  const scrollSurface = viewport?.firstElementChild as HTMLElement | null;
  const scaledWrap = scrollSurface?.firstElementChild as HTMLElement | null;
  const mapRoot = scaledWrap?.firstElementChild as HTMLElement | null;
  return mapRoot ?? null;
}

export function FenceMapPanel({
  areas,
  pixelSize,
  pixelOrigin,
  mapShapes,
  editing = false,
  coverage,
  vertices,
  onShapeChange,
}: FenceMapPanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [drawTool, setDrawTool] = useState<DrawTool>('rect');
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [zoomLevel, setZoomLevel] = useState(MAP_PIXEL_ZOOM_DEFAULT_LEVEL);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);
  const [history, setHistory] = useState<ShapeSnapshot[]>([
    { coverage, vertices },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const skipHistorySync = useRef(false);

  const tracks = useMemo(() => collectTrackSegments(areas), [areas]);
  const mapAreas = useMemo(() => areasWithoutMapGeofences(areas), [areas]);

  const selectedFacilityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const seg of coverage) ids.add(seg.trackId);
    return [...ids];
  }, [coverage]);

  useEffect(() => {
    if (!editing) {
      setMarquee(null);
      return;
    }
    setDrawTool('rect');
  }, [editing]);

  useEffect(() => {
    if (skipHistorySync.current) {
      skipHistorySync.current = false;
      return;
    }
    setHistory([{ coverage, vertices }]);
    setHistoryIndex(0);
  }, [editing]);

  useEffect(() => {
    setLayoutEpoch((n) => n + 1);
  }, [zoomLevel, pixelSize.width, pixelSize.height]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const bump = () => setLayoutEpoch((n) => n + 1);
    vp.addEventListener('scroll', bump, { passive: true });
    const ro = new ResizeObserver(bump);
    ro.observe(vp);
    return () => {
      vp.removeEventListener('scroll', bump);
      ro.disconnect();
    };
  }, [mapAreas.length]);

  const pushShape = (next: ShapeSnapshot) => {
    onShapeChange?.(next);
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, next];
    });
    setHistoryIndex((i) => i + 1);
  };

  const applyVertices = (nextVerts: FenceVertex[]) => {
    const hits = tracksCoveredByPolygon(tracks, nextVerts);
    pushShape({ vertices: nextVerts, coverage: hits });
  };

  const undo = () => {
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    skipHistorySync.current = true;
    setHistoryIndex(nextIndex);
    onShapeChange?.(history[nextIndex] ?? { coverage: [], vertices: [] });
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    skipHistorySync.current = true;
    setHistoryIndex(nextIndex);
    onShapeChange?.(history[nextIndex] ?? { coverage: [], vertices: [] });
  };

  const clientToMapPx = (clientX: number, clientY: number): FenceVertex => {
    const mapRoot = findMapRoot(viewportRef.current);
    if (!mapRoot) return { x: 0, y: 0 };
    const rect = mapRoot.getBoundingClientRect();
    const scaleX = pixelSize.width / Math.max(1, rect.width);
    const scaleY = pixelSize.height / Math.max(1, rect.height);
    return {
      x: (clientX - rect.left) * scaleX + pixelOrigin.x,
      y: (clientY - rect.top) * scaleY + pixelOrigin.y,
    };
  };

  const mapToScreen = (v: FenceVertex) => {
    const mapRoot = findMapRoot(viewportRef.current);
    const root = rootRef.current?.getBoundingClientRect();
    if (!mapRoot || !root) return null;
    const rect = mapRoot.getBoundingClientRect();
    const scaleX = rect.width / Math.max(1, pixelSize.width);
    const scaleY = rect.height / Math.max(1, pixelSize.height);
    return {
      x: rect.left - root.left + (v.x - pixelOrigin.x) * scaleX,
      y: rect.top - root.top + (v.y - pixelOrigin.y) * scaleY,
    };
  };

  const onRectPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editing || drawTool !== 'rect') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY };
    const p = clientToMapPx(e.clientX, e.clientY);
    setMarquee({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  };

  const onRectPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = clientToMapPx(e.clientX, e.clientY);
    const start = clientToMapPx(drag.startX, drag.startY);
    setMarquee({ x1: start.x, y1: start.y, x2: p.x, y2: p.y });
  };

  const onRectPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const end = clientToMapPx(e.clientX, e.clientY);
    const start = clientToMapPx(drag.startX, drag.startY);
    setMarquee(null);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    if (w < 8 && h < 8) return;
    const nextVerts = rectVerticesFromBounds(start.x, start.y, end.x, end.y);
    applyVertices(nextVerts);
  };

  const onPolygonPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editing || drawTool !== 'polygon') return;
    // 已有多邊形時改由 ShapeOverlay 編輯，勿再蓋新三角形
    if (vertices.length >= 3) return;
    const p = clientToMapPx(e.clientX, e.clientY);
    applyVertices(triangleVerticesAt(p.x, p.y));
  };

  const onOverlayWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const vp = viewportRef.current;
    if (!vp) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      vp.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: e.deltaY,
          deltaX: e.deltaX,
          clientX: e.clientX,
          clientY: e.clientY,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      return;
    }
    vp.scrollLeft += e.deltaX;
    vp.scrollTop += e.deltaY;
  };

  const zoomBy = (delta: number) => {
    setZoomLevel((prev) => clampMapPixelZoomLevel(Math.round(prev) + delta));
  };

  const toolBtn = (active: boolean) =>
    `inline-flex size-8 items-center justify-center rounded-md border transition ${
      active
        ? 'border-[#2B7FFF] bg-[#2B7FFF]/20 text-[#51A2FF]'
        : 'border-zinc-700 bg-[#18181b]/90 text-zinc-300 hover:border-zinc-500 hover:text-white'
    }`;

  const displayZoom = Math.round(zoomLevel);
  const showDrawOverlay =
    editing
    && (drawTool === 'rect' || (drawTool === 'polygon' && vertices.length < 3));

  const marqueeScreen = (() => {
    if (!marquee) return null;
    const a = mapToScreen({ x: Math.min(marquee.x1, marquee.x2), y: Math.min(marquee.y1, marquee.y2) });
    const b = mapToScreen({ x: Math.max(marquee.x1, marquee.x2), y: Math.max(marquee.y1, marquee.y2) });
    if (!a || !b) return null;
    return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y };
  })();

  return (
    <div
      ref={rootRef}
      className="relative h-full min-h-0 w-full overflow-hidden rounded-xl border border-zinc-800/80 bg-[#0c0c0e]"
    >
      {editing ? (
        <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-lg border border-zinc-700/80 bg-[#18181b]/95 p-1 shadow-lg backdrop-blur-sm">
          <button
            type="button"
            className={toolBtn(drawTool === 'rect')}
            title="矩形圍籬：拖曳拉框"
            onClick={() => setDrawTool('rect')}
          >
            <Square className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            className={toolBtn(drawTool === 'polygon')}
            title="任意邊形：點一下產生三角形，可拉頂點、邊上＋加節點"
            onClick={() => setDrawTool('polygon')}
          >
            <Pentagon className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      ) : null}

      <div
        className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5 rounded-lg border border-zinc-700/80 bg-[#18181b]/95 p-1 shadow-lg backdrop-blur-sm"
        title="雙指捲動平移 · 捏合或 Ctrl+滾輪縮放"
      >
        <button
          type="button"
          className={toolBtn(false)}
          title="放大"
          disabled={displayZoom <= 1}
          onClick={() => zoomBy(-1)}
        >
          <ZoomIn className="size-4" aria-hidden />
        </button>
        <span className="min-w-[2.5rem] text-center font-mono text-[11px] text-zinc-400">
          {displayZoom}/{MAP_PIXEL_ZOOM_LEVEL_COUNT}
        </span>
        <button
          type="button"
          className={toolBtn(false)}
          title="縮小"
          disabled={displayZoom >= MAP_PIXEL_ZOOM_LEVEL_COUNT}
          onClick={() => zoomBy(1)}
        >
          <ZoomOut className="size-4" aria-hidden />
        </button>
      </div>

      {editing ? (
        <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-zinc-700/80 bg-[#18181b]/95 p-1 shadow-lg backdrop-blur-sm">
          <button
            type="button"
            className={toolBtn(false)}
            title="復原"
            disabled={historyIndex <= 0}
            onClick={undo}
          >
            <Undo2 className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={toolBtn(false)}
            title="重做"
            disabled={historyIndex >= history.length - 1}
            onClick={redo}
          >
            <Redo2 className="size-4" aria-hidden />
          </button>
          <span className="mx-0.5 h-5 w-px bg-zinc-700" aria-hidden />
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-md text-red-400 transition hover:bg-red-500/10 disabled:opacity-40"
            title="清除圍籬形狀"
            disabled={vertices.length === 0 && coverage.length === 0}
            onClick={() => pushShape({ coverage: [], vertices: [] })}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {mapAreas.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-500">
          <MapIcon className="size-6 opacity-40" aria-hidden />
          <p className="text-sm">地圖尚無 Area 資料</p>
        </div>
      ) : (
        <MapAreaCanvas
          pixelSize={pixelSize}
          pixelOrigin={pixelOrigin}
          areas={mapAreas}
          selectedAreaId={null}
          selectedFacilityIds={selectedFacilityIds}
          geofenceSelectedLabelId={null}
          viewportRef={viewportRef}
          displayMode="editor"
          wheelZoomMode="pinch"
          zoomLevel={zoomLevel}
          onZoomLevelChange={setZoomLevel}
          readOnly
          editMode={false}
          liveById={{}}
          areaVehicles={[]}
          vehicleEditSizer={null}
          slotPreview={null}
          onSelectArea={() => {}}
          onSelectFacility={() => {}}
          onSelectGeofenceLabel={() => {}}
          onDragFacility={() => {}}
          onDragSessionStart={() => {}}
        />
      )}

      {mapShapes.map((shape) => (
        <FenceShapeOverlay
          key={shape.id}
          vertices={shape.vertices}
          mapToScreen={mapToScreen}
          clientToMap={clientToMapPx}
          editing={false}
          layoutEpoch={layoutEpoch}
          onVerticesChange={() => {}}
        />
      ))}

      {editing && vertices.length >= 3 ? (
        <FenceShapeOverlay
          vertices={vertices}
          mapToScreen={mapToScreen}
          clientToMap={clientToMapPx}
          editing
          layoutEpoch={layoutEpoch}
          onVerticesChange={applyVertices}
        />
      ) : null}

      {showDrawOverlay ? (
        <div
          className={`absolute inset-0 z-10 ${
            drawTool === 'rect' ? 'cursor-crosshair' : 'cursor-cell'
          }`}
          onPointerDown={drawTool === 'rect' ? onRectPointerDown : onPolygonPointerDown}
          onPointerMove={drawTool === 'rect' ? onRectPointerMove : undefined}
          onPointerUp={drawTool === 'rect' ? onRectPointerUp : undefined}
          onWheel={onOverlayWheel}
          onPointerCancel={() => {
            dragRef.current = null;
            setMarquee(null);
          }}
        />
      ) : null}

      {marqueeScreen ? (
        <div
          className="pointer-events-none absolute z-30 border-2 border-[#2B7FFF] bg-[#2B7FFF]/25"
          style={{
            left: marqueeScreen.left,
            top: marqueeScreen.top,
            width: Math.max(1, marqueeScreen.width),
            height: Math.max(1, marqueeScreen.height),
          }}
        />
      ) : null}
    </div>
  );
}
