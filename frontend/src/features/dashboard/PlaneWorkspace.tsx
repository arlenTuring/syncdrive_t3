import { useRef, useEffect, useState, useCallback, type CSSProperties } from 'react';
import type { DashboardPlane, CanvasElementProps, ChildWidget, WidgetType, CanvasKind } from './types';
import { CanvasElement } from './CanvasElement';
import { useFormatPainter } from './context/FormatPainterContext';
import { ZoomIn, ZoomOut, Crosshair, Paintbrush, Lock, LockOpen } from 'lucide-react';
import { useModifierHeld } from './hooks/useModifierHeld';
import {
  marqueeRectsIntersect,
  normalizeMarqueeRect,
  type MarqueeRect,
} from './utils/marqueeSelect';
import {
  readPlaneScaleLock,
  writePlaneScaleLock,
} from './utils/planeViewScaleLock';
const zoomBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#94a3b8',
  padding: '4px 6px',
  borderRadius: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.15s ease',
};

interface Props {
  plane: DashboardPlane;
  selectedElementId: string | null;
  selectedElementIds: string[];
  selectedChildId: string | null;
  selectedChildIds: string[];
  isEditMode: boolean;
  onSelectElement: (id: string | null, opts?: { additive?: boolean }) => void;
  onSelectElements: (ids: string[], opts?: { additive?: boolean }) => void;
  onSelectChild: (canvasId: string, childId: string, opts?: { additive?: boolean }) => void;
  onSelectChildren: (canvasId: string, childIds: string[], opts?: { additive?: boolean }) => void;
  onUpdateElement: (id: string, patch: Partial<CanvasElementProps>) => void;
  onBatchUpdateElements: (updates: Array<{ elementId: string; patch: Partial<CanvasElementProps> }>) => void;
  onDeleteElement: (id: string) => void;
  onAddChild: (canvasId: string, widgetType: WidgetType, x: number, y: number) => void;
  onUpdateChild: (canvasId: string, childId: string, patch: Partial<ChildWidget>) => void;
  onBatchUpdateChildren: (canvasId: string, updates: Array<{ childId: string; patch: Partial<ChildWidget> }>) => void;
  onDeleteChild: (canvasId: string, childId: string) => void;
  onAddCanvas: (isGroup: boolean, x: number, y: number, canvasKind?: CanvasKind, initialWidgetType?: WidgetType) => void;
  onEnterEditGroupMode?: (groupId: string) => void;
  onEnterTabCanvasMode?: (canvasId: string, tabId: string) => void;
  /** 拖曳／縮放開始前寫入復原快照 */
  onEditSessionStart?: () => void;
  /** 子畫布：執行時範本裁切區（虛線標示，小於編輯平面） */
  subcanvasDesignBounds?: { width: number; height: number };
  /** 雙畫板子畫布：左右畫板 + 中間閘道設定區 */
  dualCanvasEdit?: {
    laneW: number;
    laneH: number;
    gapW: number;
    designW: number;
    designH: number;
    gateSelected: boolean;
    onSelectGate: () => void;
  };
}

export function PlaneWorkspace({
  plane, selectedElementId, selectedElementIds, selectedChildIds, isEditMode,
  onSelectElement, onSelectElements, onSelectChild, onSelectChildren,
  onUpdateElement, onBatchUpdateElements, onDeleteElement,
  onAddChild, onUpdateChild, onBatchUpdateChildren, onDeleteChild,
  onAddCanvas,
  onEnterEditGroupMode,
  onEnterTabCanvasMode,
  onEditSessionStart,
  subcanvasDesignBounds,
  dualCanvasEdit,
}: Props) {
  const fp = useFormatPainter();
  const painterActive = !!fp?.armed;
  const { modifier: modifierHeld } = useModifierHeld();

  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null); // 内容區域 ref
  const [fitScale, setFitScale] = useState(1);
  const [userZoom, setUserZoom] = useState(1.0);
  const [scaleLocked, setScaleLocked] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isDraggingAny, setIsDraggingAny] = useState(false);
  const [planeMarquee, setPlaneMarquee] = useState<MarqueeRect | null>(null);
  const [canvasGroupDrag, setCanvasGroupDrag] = useState<{
    anchorId: string;
    origins: Record<string, { x: number; y: number }>;
    delta: { x: number; y: number };
  } | null>(null);
  const canvasGroupDragRef = useRef(canvasGroupDrag);
  canvasGroupDragRef.current = canvasGroupDrag;
  const lastMousePos = useRef({ x: 0, y: 0 });
  const scaleLockedRef = useRef(scaleLocked);
  scaleLockedRef.current = scaleLocked;
  const horizontalPanOnlyRef = useRef(!isEditMode);
  horizontalPanOnlyRef.current = !isEditMode;

  const totalScale = fitScale * userZoom;

  // 計算 fitScale：讓整個平面等比縮放以適應容器（容器從 display:none 顯示時需重算）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width < 8 || height < 8) return;
      const sx = (width - 48) / plane.width;
      const sy = (height - 48) / plane.height;
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
      setFitScale(Math.max(0.05, Math.min(sx, sy, 1)));
    };

    measure();
    // 初次量測若容器尚未排版（寬高為 0），下一幀再試
    let raf = 0;
    const scheduleRetry = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    scheduleRetry();

    const ro = new ResizeObserver(() => {
      measure();
      scheduleRetry();
    });
    ro.observe(el);

    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((e) => e.isIntersecting)) measure();
            },
            { threshold: 0.01 },
          )
        : null;
    io?.observe(el);

    const onWindowResize = () => measure();
    window.addEventListener('resize', onWindowResize);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io?.disconnect();
      window.removeEventListener('resize', onWindowResize);
    };
  }, [plane.width, plane.height]);

  /** 切換平面：還原鎖定縮放，否則重置；平移每次歸零（鎖定仍可再拖） */
  useEffect(() => {
    const pref = readPlaneScaleLock(plane.id);
    setPanOffset({ x: 0, y: 0 });
    if (pref?.locked) {
      setUserZoom(pref.userZoom);
      setScaleLocked(true);
    } else {
      setUserZoom(1);
      setScaleLocked(false);
    }
  }, [plane.id, plane.width, plane.height]);

  // 滾輪與觸控板事件 (縮放與平移)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // 縮放 (Ctrl + Scroll / Pinch)；鎖定時略過，仍可平移
        e.preventDefault();
        if (scaleLockedRef.current) return;
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        setUserZoom(prev => Math.max(0.2, Math.min(5, +(prev + delta).toFixed(2))));
      } else {
        // 檢視模式：僅橫向平移（縱向滾輪改為左右移動）
        const horizontalOnly = horizontalPanOnlyRef.current;
        const dx = horizontalOnly
          ? -(Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY)
          : -e.deltaX;
        const dy = horizontalOnly ? 0 : -e.deltaY;
        setPanOffset(prev => ({
          x: prev.x + dx,
          y: horizontalOnly ? 0 : prev.y + dy,
        }));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // 平移處理 (Panning)
  const handleMouseDown = (e: React.MouseEvent) => {
    // 只有在點擊空白處或未在編輯模式拖曳物件時才允許平移
    if (e.button !== 0) return; // 只允許左鍵
    const isTargetContainer = e.target === containerRef.current || (e.target as HTMLElement).classList.contains('workspace-bg');
    
    if (isTargetContainer && !isDraggingAny) {
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  useEffect(() => {
    if (!isPanning) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      const horizontalOnly = horizontalPanOnlyRef.current;
      setPanOffset(prev => ({
        x: prev.x + dx,
        y: horizontalOnly ? 0 : prev.y + dy,
      }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      setIsPanning(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPanning]);

  // 進入檢視模式時清掉縱向偏移
  useEffect(() => {
    if (!isEditMode) {
      setPanOffset((prev) => (prev.y === 0 ? prev : { ...prev, y: 0 }));
    }
  }, [isEditMode]);

  const zoomIn = () => {
    if (scaleLocked) return;
    setUserZoom((p) => Math.min(5, +(p + 0.25).toFixed(2)));
  };
  const zoomOut = () => {
    if (scaleLocked) return;
    setUserZoom((p) => Math.max(0.2, +(p - 0.25).toFixed(2)));
  };
  const zoomReset = () => {
    setPanOffset({ x: 0, y: 0 });
    if (scaleLocked) return;
    setUserZoom(1.0);
  };
  const toggleScaleLock = () => {
    if (scaleLocked) {
      writePlaneScaleLock(plane.id, { locked: false, userZoom });
      setScaleLocked(false);
      return;
    }
    writePlaneScaleLock(plane.id, { locked: true, userZoom });
    setScaleLocked(true);
  };

  const handleDragActiveChange = useCallback((active: boolean) => {
    setIsDraggingAny(active);
    if (!active) setTimeout(() => setIsDraggingAny(false), 50);
  }, []);

  const handlePlaneBackgroundMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEditMode || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.child-widget-container')) return;
    if (target.closest('.dashboard-canvas-rnd')) return;
    if (target.closest('[data-canvas-child-list]')) return;
    if (target.closest('[data-canvas-child-list-root]')) return;

    if (e.shiftKey || e.altKey || modifierHeld) {
      e.preventDefault();
      e.stopPropagation();
      const rect = innerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const startX = (e.clientX - rect.left) / totalScale;
      const startY = (e.clientY - rect.top) / totalScale;
      let endX = startX;
      let endY = startY;
      let marqueeStarted = false;

      const onMove = (ev: MouseEvent) => {
        if (!innerRef.current) return;
        const r = innerRef.current.getBoundingClientRect();
        endX = (ev.clientX - r.left) / totalScale;
        endY = (ev.clientY - r.top) / totalScale;
        if (!marqueeStarted && (Math.abs(endX - startX) > 4 || Math.abs(endY - startY) > 4)) {
          marqueeStarted = true;
        }
        if (marqueeStarted) {
          setPlaneMarquee(normalizeMarqueeRect(startX, startY, endX, endY));
        }
      };

      const onUp = () => {
        setPlaneMarquee(null);
        if (marqueeStarted) {
          const marquee = normalizeMarqueeRect(startX, startY, endX, endY);
          const hits = plane.elements
            .filter(el => marqueeRectsIntersect(
              marquee,
              { x: el.x, y: el.y, width: el.width, height: el.height },
            ))
            .map(el => el.id);
          onSelectElements(hits, { additive: true });
        }
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return;
    }

    onSelectElement(null);
  }, [isEditMode, modifierHeld, onSelectElement, onSelectElements, plane.elements, totalScale]);

  const handleCanvasGroupDragStart = useCallback((anchorId: string) => {
    if (selectedElementIds.length <= 1 || !selectedElementIds.includes(anchorId)) return;
    const origins = Object.fromEntries(
      plane.elements
        .filter(el => selectedElementIds.includes(el.id))
        .map(el => [el.id, { x: el.x, y: el.y }]),
    );
    setCanvasGroupDrag({ anchorId, origins, delta: { x: 0, y: 0 } });
  }, [plane.elements, selectedElementIds]);

  const handleCanvasGroupDragMove = useCallback((anchorId: string, x: number, y: number) => {
    setCanvasGroupDrag(prev => {
      if (!prev || prev.anchorId !== anchorId) return prev;
      const origin = prev.origins[anchorId];
      return { ...prev, delta: { x: x - origin.x, y: y - origin.y } };
    });
  }, []);

  const handleCanvasGroupDragStop = useCallback((anchorId: string, x: number, y: number) => {
    const group = canvasGroupDragRef.current;
    const round = (n: number) => Math.round(n * 2) / 2;
    if (!group || group.anchorId !== anchorId || selectedElementIds.length <= 1) {
      onUpdateElement(anchorId, { x: round(x), y: round(y) });
      setCanvasGroupDrag(null);
      return;
    }
    const origin = group.origins[anchorId];
    const delta = { x: x - origin.x, y: y - origin.y };
    onBatchUpdateElements(
      selectedElementIds.map(id => {
        const o = group.origins[id];
        return {
          elementId: id,
          patch: { x: round(o.x + delta.x), y: round(o.y + delta.y) },
        };
      }),
    );
    setCanvasGroupDrag(null);
  }, [onBatchUpdateElements, onUpdateElement, selectedElementIds]);

  // ─── Workspace Drop 處理（接受画布元件 & 画布群組的拖放） ─────────────
  const [isCanvasDragOver, setIsCanvasDragOver] = useState(false);

  const handleWorkspaceDragOver = useCallback((e: React.DragEvent) => {
    if (!isEditMode) return;
    e.preventDefault();
    setIsCanvasDragOver(true);
  }, [isEditMode]);

  const handleWorkspaceDragLeave = useCallback((e: React.DragEvent) => {
    // 只有离開內容區域時才清除
    if (!innerRef.current?.contains(e.relatedTarget as Node)) {
      setIsCanvasDragOver(false);
    }
  }, []);

  const handleWorkspaceDrop = useCallback((e: React.DragEvent) => {
    if (!isEditMode) return;
    e.preventDefault();
    e.stopPropagation();
    setIsCanvasDragOver(false);
    const canvasType = e.dataTransfer.getData('canvasType') || e.dataTransfer.getData('canvastype');
    const widgetType = (e.dataTransfer.getData('widgetType') || e.dataTransfer.getData('widgettype')) as WidgetType;
    if (!innerRef.current) return;
    const rect = innerRef.current.getBoundingClientRect();
    const rawX = (e.clientX - rect.left) / totalScale;
    const rawY = (e.clientY - rect.top) / totalScale;
    const x = Math.max(0, Math.round(rawX / 5) * 5);
    const y = Math.max(0, Math.round(rawY / 5) * 5);

    if (canvasType) {
      if (canvasType === 'canvas-tab-list') {
        onAddCanvas(false, x, y, 'standard', 'tab-list');
        return;
      }
      const isGroup = canvasType === 'canvas-group';
      const isMapPlatform = canvasType === 'canvas-map-platform';
      onAddCanvas(isGroup, x, y, isMapPlatform ? 'map-platform' : 'standard');
      return;
    }

    if (widgetType) {
      onAddCanvas(false, x, y, 'standard', widgetType);
    }
  }, [isEditMode, totalScale, onAddCanvas]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden flex items-center justify-center relative workspace-bg"
      style={{ 
        background: '#0a0f1a',
        cursor: painterActive
          ? 'crosshair'
          : isPanning
            ? 'grabbing'
            : (!isEditMode || !selectedElementId)
              ? 'grab'
              : 'default',
      }}
      onMouseDown={handleMouseDown}
    >
      {/* 縮放與平移控制（鎖定後固定 scale，仍可平移） */}
      <div
        style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 200,
                 display: 'flex', alignItems: 'center', gap: 6,
                 background: 'rgba(15,22,35,0.9)', border: '1px solid rgba(255,255,255,0.1)',
                 borderRadius: 10, padding: '6px 10px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={zoomOut}
          disabled={scaleLocked}
          style={{
            ...zoomBtnStyle,
            opacity: scaleLocked ? 0.35 : 1,
            cursor: scaleLocked ? 'not-allowed' : 'pointer',
          }}
          title={scaleLocked ? '縮放已鎖定' : '縮小 (Ctrl + Wheel)'}
        >
          <ZoomOut size={14} />
        </button>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
        <button onClick={zoomReset}
          style={{ ...zoomBtnStyle, gap: 6, padding: '2px 8px', fontSize: 11, fontFamily: 'monospace', color: '#94a3b8' }}
          title={scaleLocked ? '重置位置（縮放已鎖定）' : '重置縮放與位置'}>
          <Crosshair size={14} className="text-cyan-500" />
          {Math.round(userZoom * 100)}%
        </button>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
        <button
          onClick={zoomIn}
          disabled={scaleLocked}
          style={{
            ...zoomBtnStyle,
            opacity: scaleLocked ? 0.35 : 1,
            cursor: scaleLocked ? 'not-allowed' : 'pointer',
          }}
          title={scaleLocked ? '縮放已鎖定' : '放大 (Ctrl + Wheel)'}
        >
          <ZoomIn size={14} />
        </button>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
        <button
          onClick={toggleScaleLock}
          style={{
            ...zoomBtnStyle,
            color: scaleLocked ? '#38bdf8' : '#94a3b8',
          }}
          title={scaleLocked ? '解除縮放鎖定（仍可橫向平移）' : '鎖定目前縮放（下次進入沿用，仍可橫向平移）'}
          aria-pressed={scaleLocked}
          aria-label={scaleLocked ? '解除縮放鎖定' : '鎖定縮放'}
        >
          {scaleLocked ? <Lock size={14} /> : <LockOpen size={14} />}
        </button>
      </div>

      {/* 平面容器（刻度尺僅編輯模式） */}
      <div
        style={{
          width: plane.width,
          height: plane.height,
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${totalScale})`,
          transformOrigin: 'center center',
          position: 'relative',
          flexShrink: 0,
          paddingTop: isEditMode ? 20 : 0,
          paddingLeft: isEditMode ? 20 : 0,
        }}
      >
        {isEditMode ? (
          <>
            {/* 頂部刻度 */}
            <div style={{ position: 'absolute', top: 0, left: 30, right: 0, height: 30, overflow: 'hidden', pointerEvents: 'none' }}>
              {Array.from({ length: Math.ceil(plane.width / 10) + 1 }).map((_, i) => {
                const x = i * 10;
                const is50 = x % 50 === 0;
                const is100 = x % 100 === 0;
                return (
                  <div key={i} style={{
                    position: 'absolute', left: x, bottom: 0,
                    borderLeft: `1px solid ${is50 ? '#64748b' : 'rgba(100,116,139,0.3)'}`,
                    height: is50 ? 12 : 5,
                  }}>
                    {is50 && (
                      <span style={{
                        position: 'absolute', left: 4, bottom: 4,
                        fontSize: is100 ? 12 : 10,
                        fontWeight: is100 ? 'bold' : 'normal',
                        color: is100 ? '#cbd5e1' : '#94a3b8',
                        fontFamily: 'monospace',
                      }}>{x}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* 左側刻度 */}
            <div style={{ position: 'absolute', top: 30, left: 0, bottom: 0, width: 30, overflow: 'hidden', pointerEvents: 'none' }}>
              {Array.from({ length: Math.ceil(plane.height / 10) + 1 }).map((_, i) => {
                const y = i * 10;
                const is50 = y % 50 === 0;
                const is100 = y % 100 === 0;
                return (
                  <div key={i} style={{
                    position: 'absolute', top: y, right: 0,
                    borderTop: `1px solid ${is50 ? '#64748b' : 'rgba(100,116,139,0.3)'}`,
                    width: is50 ? 12 : 5,
                  }}>
                    {is50 && (
                      <span style={{
                        position: 'absolute', right: 4, top: 2,
                        fontSize: is100 ? 12 : 10,
                        fontWeight: is100 ? 'bold' : 'normal',
                        color: is100 ? '#cbd5e1' : '#94a3b8',
                        fontFamily: 'monospace',
                        textAlign: 'right', width: 30,
                      }}>{y}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        {/* 內容區域 */}
        <div style={{
          position: 'absolute',
          top: isEditMode ? 30 : 0,
          left: isEditMode ? 30 : 0,
          width: plane.width, height: plane.height,
          backgroundColor: '#0c1222',
          backgroundImage: isEditMode
            ? `
                linear-gradient(rgba(6,182,212,0.12) 1px, transparent 1px),
                linear-gradient(90deg, rgba(6,182,212,0.12) 1px, transparent 1px),
                linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
              `
            : 'none',
          backgroundSize: isEditMode
            ? '100px 100px, 100px 100px, 5px 5px, 5px 5px'
            : undefined,
          border: isCanvasDragOver
            ? '2px solid rgba(34,197,94,0.7)'
            : isEditMode ? '1px solid rgba(6,182,212,0.35)' : 'none',
          borderRadius: isEditMode ? 2 : 0,
          overflow: 'hidden',
          transition: isPanning ? 'none' : 'border-color 0.2s ease',
          boxShadow: isEditMode ? '0 0 40px rgba(0,0,0,0.4)' : 'none',
        }}
        ref={innerRef}
        data-dashboard-plane="workspace"
        onMouseDown={handlePlaneBackgroundMouseDown}
        onDragOver={handleWorkspaceDragOver}
        onDragLeave={handleWorkspaceDragLeave}
        onDrop={handleWorkspaceDrop}
      >
        {dualCanvasEdit ? (
          <>
            {[0, dualCanvasEdit.laneW + dualCanvasEdit.gapW].map((left, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left,
                  top: 0,
                  width: dualCanvasEdit.designW,
                  height: dualCanvasEdit.designH,
                  border: '2px dashed rgba(168,85,247,0.55)',
                  borderRadius: 4,
                  background: 'rgba(139,92,246,0.04)',
                  pointerEvents: 'none',
                  zIndex: 2,
                  boxSizing: 'border-box',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 4,
                    left: 6,
                    fontSize: 9,
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    color: 'rgba(168,85,247,0.85)',
                  }}
                >
                  {i === 0 ? '預設範本' : '常態範本'} {dualCanvasEdit.designW}×{dualCanvasEdit.designH}
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                dualCanvasEdit.onSelectGate();
              }}
              style={{
                position: 'absolute',
                left: dualCanvasEdit.laneW,
                top: 0,
                width: dualCanvasEdit.gapW,
                height: dualCanvasEdit.laneH,
                zIndex: 15,
                border: dualCanvasEdit.gateSelected
                  ? '2px solid rgba(34,211,238,0.7)'
                  : '1px dashed rgba(100,116,139,0.45)',
                borderRadius: 6,
                background: dualCanvasEdit.gateSelected
                  ? 'rgba(6,182,212,0.12)'
                  : 'rgba(15,23,42,0.65)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: 4,
              }}
              title="雙畫板閘道設定"
            >
              <span
                style={{
                  writingMode: 'vertical-rl',
                  fontSize: 9,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color: dualCanvasEdit.gateSelected ? '#22d3ee' : '#94a3b8',
                  letterSpacing: '0.08em',
                }}
              >
                閘道設定
              </span>
            </button>
          </>
        ) : subcanvasDesignBounds
          && (subcanvasDesignBounds.width < plane.width || subcanvasDesignBounds.height < plane.height) ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: subcanvasDesignBounds.width,
              height: subcanvasDesignBounds.height,
              border: '2px dashed rgba(168,85,247,0.55)',
              borderRadius: 4,
              background: 'rgba(139,92,246,0.04)',
              pointerEvents: 'none',
              zIndex: 2,
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 4,
                left: 6,
                fontSize: 9,
                fontFamily: 'monospace',
                fontWeight: 700,
                color: 'rgba(168,85,247,0.85)',
                letterSpacing: '0.04em',
              }}
            >
              執行範本 {subcanvasDesignBounds.width}×{subcanvasDesignBounds.height}
            </div>
          </div>
        ) : null}

        {/* 拖曳時的暗色遮罩 */}
        {isDraggingAny && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 90,
            background: 'rgba(0,0,0,0.15)',
            pointerEvents: 'none',
          }} />
        )}

        {/* Canvas 拖放高亮提示 */}
        {isCanvasDragOver && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 95,
            background: 'rgba(34,197,94,0.04)',
            pointerEvents: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              background: 'rgba(15,22,35,0.9)', color: '#22c55e',
              border: '1px solid rgba(34,197,94,0.4)',
              borderRadius: 8, padding: '8px 20px',
              fontSize: 13, fontFamily: 'monospace', fontWeight: 'bold',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}>
              ＋ 放開以新增畫布
            </div>
          </div>
        )}

        {/* 平面名稱浮水印 */}
        <div style={{
          position: 'absolute', top: 8, left: 12, fontSize: 11,
          fontFamily: 'monospace', color: 'rgba(6,182,212,0.25)', pointerEvents: 'none', zIndex: 0,
        }}>
          {plane.name} — {plane.width} × {plane.height}
        </div>

        {/* 編輯模式提示標籤 */}
        {isEditMode && painterActive && fp?.armed && (
          <div style={{
            position: 'absolute', top: 8, right: 10, zIndex: 320,
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold',
            color: '#f0abfc',
            background: 'rgba(217,70,239,0.12)',
            border: '1px solid rgba(217,70,239,0.45)',
            padding: '4px 10px', borderRadius: 6, pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(217,70,239,0.2)',
          }}>
            <Paintbrush size={12} />
            格式刷 · 點選 {fp.armed.sourceType} 元件 · Esc 取消
          </div>
        )}
        {isEditMode && !painterActive && (
          <div style={{
            position: 'absolute', top: 8, right: 10, zIndex: 300,
            fontSize: 9, fontFamily: 'monospace',
            color: 'rgba(6,182,212,0.5)',
            background: 'rgba(6,182,212,0.08)',
            border: '1px solid rgba(6,182,212,0.2)',
            padding: '2px 6px', borderRadius: 4, pointerEvents: 'none',
          }}>
            ✂ EDIT · Shift+點擊加選 · Shift/Alt+拖曳框選 · 3px 對齊
          </div>
        )}

        {plane.elements.length === 0 ? (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center"
            style={{ top: 30, left: 30, width: plane.width, height: plane.height }}
          >
            <p className="text-sm font-medium text-zinc-300">此平面沒有任何畫布元件</p>
            <p className="max-w-md text-xs leading-relaxed text-zinc-500">
              可能是本機快取損壞。請使用左上角齒輪「應用程式設定」→「還原兩個圖台範例」，或從清單重新建立平面。
            </p>
          </div>
        ) : null}

        {/* Canvas 元件列表 */}
        {planeMarquee && (
          <div
            style={{
              position: 'absolute',
              left: planeMarquee.x,
              top: planeMarquee.y,
              width: planeMarquee.width,
              height: planeMarquee.height,
              border: '1px dashed rgba(34,211,238,0.9)',
              background: 'rgba(34,211,238,0.12)',
              pointerEvents: 'none',
              zIndex: 4000,
            }}
          />
        )}

        {plane.elements.map(el => {
          const groupOrigin = canvasGroupDrag?.origins[el.id];
          const canvasPositionOverride = groupOrigin && canvasGroupDrag
            ? { x: groupOrigin.x + canvasGroupDrag.delta.x, y: groupOrigin.y + canvasGroupDrag.delta.y }
            : null;
          const isSubcanvasPlane = plane.id.startsWith('template-plane');
          const showChildSelection = isSubcanvasPlane
            ? (plane.elements.length === 1 || el.id === selectedElementId)
            : selectedElementIds.includes(el.id);

          return (
          <CanvasElement
            key={el.id}
            element={el}
            isSelected={selectedElementIds.includes(el.id) || (isSubcanvasPlane && showChildSelection)}
            selectedChildIds={showChildSelection ? selectedChildIds : []}
            canvasPositionOverride={canvasPositionOverride}
            scale={totalScale}
            planeWidth={plane.width}
            planeHeight={plane.height}
            otherElements={plane.elements
              .filter(e => e.id !== el.id && !selectedElementIds.includes(e.id))
              .map(e => ({ id: e.id, x: e.x, y: e.y, width: e.width, height: e.height }))}
            isDimmed={isDraggingAny}
            isEditMode={isEditMode}
            onDragActiveChange={handleDragActiveChange}
            onSelect={(opts) => { if (isEditMode) onSelectElement(el.id, opts); }}
            onUpdate={(patch) => onUpdateElement(el.id, patch)}
            onDelete={() => onDeleteElement(el.id)}
            onAddChild={(type, x, y) => onAddChild(el.id, type, x, y)}
            onSelectChild={(childId, opts) => { if (isEditMode) onSelectChild(el.id, childId, opts); }}
            onSelectChildren={(childIds, opts) => { if (isEditMode) onSelectChildren(el.id, childIds, opts); }}
            onUpdateChild={(childId, patch) => onUpdateChild(el.id, childId, patch)}
            onBatchUpdateChildren={(updates) => onBatchUpdateChildren(el.id, updates)}
            onDeleteChild={(childId) => onDeleteChild(el.id, childId)}
            onEnterEditGroupMode={onEnterEditGroupMode}
            onEnterTabCanvasMode={onEnterTabCanvasMode}
            onEditSessionStart={onEditSessionStart}
            onCanvasGroupDragStart={handleCanvasGroupDragStart}
            onCanvasGroupDragMove={handleCanvasGroupDragMove}
            onCanvasGroupDragStop={handleCanvasGroupDragStop}
          />
          );
        })}
      </div>
      </div>
    </div>
  );
}
