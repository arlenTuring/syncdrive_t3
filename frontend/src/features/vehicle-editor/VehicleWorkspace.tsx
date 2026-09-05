import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ZoomIn, ZoomOut, Crosshair } from 'lucide-react';
import { SnapGuideLines } from '../dashboard/components/SnapGuideLines';
import {
  applyCanvasResize,
  type ElementResizeEdge,
} from '../../lib/elementResize';
import type { VehicleDefinition, VehicleElement, VehicleElementType } from './types';
import { VehicleCanvasResizeOverlay } from './components/VehicleCanvasResizeOverlay';
import { VehicleElementNode } from './elements/VehicleElementNode';
import type { AlignGuideLine } from './utils/vehicleElementSnap';
import {
  isMarqueeDrag,
  normalizeMarqueeRect,
  vehicleElementsInMarquee,
  type MarqueeRect,
} from './utils/vehicleMarquee';
import {
  computeWorkspaceFitScale,
  isCompactVehicleCanvas,
  workspaceGridStepPx,
} from './utils/workspaceEditScale';
import { selectedElementsBounds } from './utils/selectedElementsBounds';

const MARQUEE_START_PX = 4;
const MIN_CANVAS_WIDTH = 40;
const MIN_CANVAS_HEIGHT = 20;

interface Props {
  vehicle: VehicleDefinition;
  selectedElementIds: string[];
  isEditMode: boolean;
  onSelectElement: (id: string | null, opts?: { additive?: boolean }) => void;
  onSelectElements: (ids: string[], opts?: { additive?: boolean }) => void;
  onUpdateElement: (
    id: string,
    patch: Partial<VehicleElement>,
    options?: { recordHistory?: boolean },
  ) => void;
  onBatchUpdateElements: (
    updates: Array<{ elementId: string; patch: Partial<VehicleElement> }>,
    options?: { recordHistory?: boolean },
  ) => void;
  onResizeCanvas?: (
    patch: {
      width: number;
      height: number;
    },
    options?: { recordHistory?: boolean },
  ) => void;
  onBeginEditSession?: () => void;
  onAddElement: (type: VehicleElementType, x: number, y: number) => void;
  onRotateLeft90?: (elementId: string) => void;
  onRotateRight90?: (elementId: string) => void;
  onRotateDelta?: (elementId: string, delta: number) => void;
}

export function VehicleWorkspace({
  vehicle,
  selectedElementIds,
  isEditMode,
  onSelectElement,
  onSelectElements,
  onUpdateElement,
  onBatchUpdateElements,
  onResizeCanvas,
  onBeginEditSession,
  onAddElement,
  onRotateLeft90,
  onRotateRight90,
  onRotateDelta,
}: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasStageRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [userZoom, setUserZoom] = useState(1);
  const totalScale = fitScale * userZoom;
  const compactCanvas = isCompactVehicleCanvas(vehicle.width, vehicle.height);
  const gridStep = workspaceGridStepPx(vehicle.width, vehicle.height);
  const workspaceWidth = vehicle.width;
  const workspaceHeight = vehicle.height;

  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const [snapGuides, setSnapGuides] = useState<AlignGuideLine[]>([]);
  const [canvasViewOffset, setCanvasViewOffset] = useState({ x: 0, y: 0 });
  const [workspacePan, setWorkspacePan] = useState({ x: 0, y: 0 });
  const workspacePanRef = useRef(workspacePan);
  workspacePanRef.current = workspacePan;
  const canvasViewOffsetRef = useRef(canvasViewOffset);
  canvasViewOffsetRef.current = canvasViewOffset;
  /** 編輯器視覺裁切：從左／上縮放時不動元件座標，僅平移內容層 */
  const [canvasContentOffset, setCanvasContentOffset] = useState({ x: 0, y: 0 });
  const canvasContentOffsetRef = useRef(canvasContentOffset);
  canvasContentOffsetRef.current = canvasContentOffset;
  const [groupDrag, setGroupDrag] = useState<{
    anchorId: string;
    origins: Record<string, { x: number; y: number }>;
    delta: { x: number; y: number };
  } | null>(null);
  const groupDragRef = useRef(groupDrag);
  groupDragRef.current = groupDrag;
  const selectedElementIdsRef = useRef(selectedElementIds);
  selectedElementIdsRef.current = selectedElementIds;

  const marqueeCleanupRef = useRef<(() => void) | null>(null);
  const vehicleSizeRef = useRef({
    width: workspaceWidth,
    height: workspaceHeight,
    canvasWidth: vehicle.width,
    canvasHeight: vehicle.height,
  });
  vehicleSizeRef.current = {
    width: workspaceWidth,
    height: workspaceHeight,
    canvasWidth: vehicle.width,
    canvasHeight: vehicle.height,
  };
  const canvasResizeActiveRef = useRef(false);

  useEffect(() => {
    setUserZoom(1);
    setCanvasViewOffset({ x: 0, y: 0 });
    setWorkspacePan({ x: 0, y: 0 });
    setCanvasContentOffset({ x: 0, y: 0 });
  }, [vehicle.id]);

  useEffect(() => () => marqueeCleanupRef.current?.(), []);

  const clientToCanvasLocal = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left) / totalScale + canvasContentOffset.x,
        y: (clientY - rect.top) / totalScale + canvasContentOffset.y,
      };
    },
    [totalScale, canvasContentOffset.x, canvasContentOffset.y],
  );

  const isBlankTarget = useCallback((target: EventTarget | null) => {
    const t = target as HTMLElement | null;
    if (!t) return false;
    if (t.closest('[data-vehicle-element]')) return false;
    if (t.closest('[data-vehicle-bulk-move-layer]')) return false;
    if (t.closest('[data-vehicle-rotation-toolbar]')) return false;
    if (t.closest('[data-vehicle-workspace-chrome]')) return false;
    if (t.closest('[data-vehicle-resize-handle]')) return false;
    if (t.closest('[data-vehicle-canvas-resize-handle]')) return false;
    return true;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      if (canvasResizeActiveRef.current) return;
      const { width, height } = vehicleSizeRef.current;
      setFitScale(
        computeWorkspaceFitScale(el.clientWidth, el.clientHeight, width, height),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vehicle.id, workspaceWidth, workspaceHeight]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      if (!isBlankTarget(e.target)) return;
      e.preventDefault();
      setWorkspacePan((p) => ({
        x: p.x - e.deltaX,
        y: p.y - e.deltaY,
      }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isBlankTarget]);

  const resetWorkspaceView = useCallback(() => {
    setUserZoom(1);
    setWorkspacePan({ x: 0, y: 0 });
    setCanvasViewOffset({ x: 0, y: 0 });
  }, []);

  const clearMarqueeListeners = useCallback(() => {
    marqueeCleanupRef.current?.();
    marqueeCleanupRef.current = null;
  }, []);

  const beginCanvasMarquee = useCallback(
    (clientX: number, clientY: number, additive: boolean) => {
      if (!isEditMode) return;
      const start = clientToCanvasLocal(clientX, clientY);
      let endX = start.x;
      let endY = start.y;
      let active = false;

      const onMove = (ev: PointerEvent) => {
        const cur = clientToCanvasLocal(ev.clientX, ev.clientY);
        endX = cur.x;
        endY = cur.y;
        const rect = normalizeMarqueeRect(start.x, start.y, endX, endY);
        if (!active && isMarqueeDrag(rect, MARQUEE_START_PX)) {
          active = true;
        }
        if (active) setMarqueeRect(rect);
      };

      const onUp = (ev: PointerEvent) => {
        clearMarqueeListeners();
        const rect = normalizeMarqueeRect(start.x, start.y, endX, endY);
        setMarqueeRect(null);
        if (!isEditMode) return;
        if (active && isMarqueeDrag(rect, MARQUEE_START_PX)) {
          const hits = vehicleElementsInMarquee(vehicle.elements, rect);
          onSelectElements(hits, { additive: additive || ev.shiftKey });
          return;
        }
        onSelectElement(null);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      marqueeCleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
    },
    [
      isEditMode,
      clientToCanvasLocal,
      clearMarqueeListeners,
      vehicle.elements,
      onSelectElements,
      onSelectElement,
    ],
  );

  /** 畫布內外空白處皆可起始框選（capture 以涵蓋 padding 區） */
  const handleWorkspacePointerDownCapture = useCallback(
    (e: ReactPointerEvent) => {
      if (!isEditMode || e.button !== 0) return;
      if (!isBlankTarget(e.target)) return;
      e.preventDefault();
      beginCanvasMarquee(e.clientX, e.clientY, e.shiftKey);
    },
    [isEditMode, isBlankTarget, beginCanvasMarquee],
  );

  const handleGroupDragDelta = useCallback((dx: number, dy: number) => {
    const group = groupDragRef.current;
    if (!group) return;
    setGroupDrag({
      ...group,
      delta: { x: dx, y: dy },
    });
  }, []);

  const finishGroupDrag = useCallback(() => {
    const group = groupDragRef.current;
    if (group && selectedElementIdsRef.current.length > 1) {
      const updates = selectedElementIdsRef.current
        .filter((id) => group.origins[id])
        .map((id) => {
          const origin = group.origins[id]!;
          return {
            elementId: id,
            patch: {
              x: Math.round(origin.x + group.delta.x),
              y: Math.round(origin.y + group.delta.y),
            },
          };
        });
      onBatchUpdateElements(updates, { recordHistory: false });
    }
    setGroupDrag(null);
    setSnapGuides([]);
  }, [onBatchUpdateElements]);

  const handleElementDragEnd = useCallback(
    (_elementId: string) => {
      finishGroupDrag();
    },
    [finishGroupDrag],
  );

  const beginGroupDragSession = useCallback(
    (anchorId: string) => {
      onBeginEditSession?.();
      const ids = selectedElementIdsRef.current;
      if (ids.length <= 1 || !ids.includes(anchorId)) {
        setGroupDrag(null);
        return false;
      }
      const origins = Object.fromEntries(
        vehicle.elements
          .filter((el) => ids.includes(el.id))
          .map((el) => [el.id, { x: el.x, y: el.y }]),
      );
      setGroupDrag({ anchorId, origins, delta: { x: 0, y: 0 } });
      return true;
    },
    [onBeginEditSession, vehicle.elements],
  );

  const handleElementDragSessionStart = useCallback(
    (elementId: string) => {
      beginGroupDragSession(elementId);
    },
    [beginGroupDragSession],
  );

  const handleBulkMovePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!isEditMode || selectedElementIdsRef.current.length <= 1) return;
      e.stopPropagation();
      e.preventDefault();
      const anchorId = selectedElementIdsRef.current[0];
      if (!anchorId || !beginGroupDragSession(anchorId)) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const onMove = (ev: PointerEvent) => {
        handleGroupDragDelta(
          (ev.clientX - startX) / totalScale,
          (ev.clientY - startY) / totalScale,
        );
      };
      const onUp = () => {
        finishGroupDrag();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [isEditMode, beginGroupDragSession, handleGroupDragDelta, finishGroupDrag, totalScale],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!isEditMode) return;
      e.preventDefault();
      const type = e.dataTransfer.getData('application/x-vehicle-element') as VehicleElementType;
      if (!type) return;
      const pos = clientToCanvasLocal(e.clientX, e.clientY);
      const x = Math.round(pos.x - 20);
      const y = Math.round(pos.y - 10);
      onAddElement(type, Math.max(0, x), Math.max(0, y));
    },
    [isEditMode, onAddElement, clientToCanvasLocal],
  );

  const handleCanvasResizePointerDown = useCallback(
    (edge: ElementResizeEdge, e: ReactPointerEvent) => {
      if (!isEditMode || !onResizeCanvas) return;
      e.stopPropagation();
      e.preventDefault();
      onBeginEditSession?.();
      canvasResizeActiveRef.current = true;
      const lockedScale = totalScale;
      const startX = e.clientX;
      const startY = e.clientY;
      const startSize = { width: vehicle.width, height: vehicle.height };
      const wrapperRect = canvasWrapperRef.current?.getBoundingClientRect();
      const stageRect = canvasStageRef.current?.getBoundingClientRect();
      if (!wrapperRect || !stageRect) return;

      const anchorLeft = wrapperRect.left;
      const anchorTop = wrapperRect.top;
      const stageCenterX = stageRect.left + stageRect.width / 2;
      const stageCenterY = stageRect.top + stageRect.height / 2;
      const movesLeft = edge === 'left' || edge === 'nw' || edge === 'sw';
      const movesTop = edge === 'top' || edge === 'nw' || edge === 'ne';
      const contentOffsetBase = { ...canvasContentOffsetRef.current };
      const panAtStart = { ...workspacePanRef.current };

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / lockedScale;
        const dy = (ev.clientY - startY) / lockedScale;
        const next = applyCanvasResize(edge, dx, dy, startSize, {
          minWidth: MIN_CANVAS_WIDTH,
          minHeight: MIN_CANVAS_HEIGHT,
        });
        if (next.width === startSize.width && next.height === startSize.height) return;

        const widthPx = next.width * lockedScale;
        const heightPx = next.height * lockedScale;
        const defaultLeft = stageCenterX - widthPx / 2;
        const defaultTop = stageCenterY - heightPx / 2;

        const desiredLeft = movesLeft
          ? anchorLeft + (startSize.width - next.width) * lockedScale
          : anchorLeft;
        const desiredTop = movesTop
          ? anchorTop + (startSize.height - next.height) * lockedScale
          : anchorTop;

        setCanvasViewOffset({
          x: desiredLeft - defaultLeft - panAtStart.x,
          y: desiredTop - defaultTop - panAtStart.y,
        });
        setCanvasContentOffset({
          x: contentOffsetBase.x + (movesLeft ? startSize.width - next.width : 0),
          y: contentOffsetBase.y + (movesTop ? startSize.height - next.height : 0),
        });
        onResizeCanvas({ width: next.width, height: next.height }, { recordHistory: false });
      };
      const onUp = () => {
        canvasResizeActiveRef.current = false;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [isEditMode, onResizeCanvas, onBeginEditSession, vehicle.width, vehicle.height, totalScale],
  );

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-[#0a0f1a]"
      onPointerDownCapture={handleWorkspacePointerDownCapture}
    >
      <div
        data-vehicle-workspace-chrome
        className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/90 p-1"
      >
        <button
          type="button"
          className="rounded p-1 text-zinc-400 hover:text-white"
          onClick={() => setUserZoom((z) => Math.max(0.25, z / 1.25))}
          title={t('vehicleEditor.workspace.zoomOut')}
        >
          <ZoomOut size={16} />
        </button>
        <span
          className="min-w-[56px] text-center font-mono text-[10px] text-zinc-500"
          title={
            compactCanvas
              ? t('vehicleEditor.workspace.logicalCanvasTitle', { w: vehicle.width, h: vehicle.height })
              : t('vehicleEditor.workspace.canvasTitle', { w: vehicle.width, h: vehicle.height })
          }
        >
          {Math.round(totalScale * 100)}%
        </span>
        <button
          type="button"
          className="rounded p-1 text-zinc-400 hover:text-white"
          onClick={() => setUserZoom((z) => Math.min(4, z * 1.25))}
          title={t('vehicleEditor.workspace.zoomIn')}
        >
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          className="rounded p-1 text-zinc-400 hover:text-white"
          onClick={resetWorkspaceView}
          title={t('vehicleEditor.workspace.resetView')}
        >
          <Crosshair size={16} />
        </button>
      </div>

      <div ref={canvasStageRef} className="flex h-full w-full flex-col items-center justify-center p-10">
        <div
          ref={canvasWrapperRef}
          className="relative shrink-0 overflow-visible"
          style={{
            width: workspaceWidth * totalScale,
            height: workspaceHeight * totalScale,
            transform: `translate(${canvasViewOffset.x + workspacePan.x}px, ${canvasViewOffset.y + workspacePan.y}px)`,
          }}
          onDragOver={(e) => {
            if (isEditMode) e.preventDefault();
          }}
          onDrop={handleDrop}
        >
            {marqueeRect && (
              <div
                className="pointer-events-none absolute z-[60] border border-cyan-400/80 bg-cyan-400/10"
                style={{
                  left: marqueeRect.x * totalScale,
                  top: marqueeRect.y * totalScale,
                  width: marqueeRect.width * totalScale,
                  height: marqueeRect.height * totalScale,
                }}
              />
            )}
            <div
              ref={canvasRef}
              className="absolute left-0 top-0 origin-top-left overflow-visible"
              style={{
                width: vehicle.width,
                height: vehicle.height,
                transform: `scale(${totalScale})`,
              }}
              data-vehicle-canvas
            >
              <div
                className="pointer-events-none absolute inset-0 overflow-hidden"
                style={{ backgroundColor: vehicle.backgroundColor }}
              >
                {vehicle.backgroundColor === 'transparent' && (
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundColor: '#0c121c',
                      backgroundImage:
                        'linear-gradient(45deg, #151d2b 25%, transparent 25%), linear-gradient(-45deg, #151d2b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #151d2b 75%), linear-gradient(-45deg, transparent 75%, #151d2b 75%)',
                      backgroundSize: '8px 8px',
                      backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                    }}
                    aria-hidden
                  />
                )}
                {isEditMode && (
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage:
                        'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
                      backgroundSize: `${gridStep}px ${gridStep}px`,
                    }}
                  />
                )}
              </div>
              <div
                className="absolute left-0 top-0 overflow-visible"
                style={{
                  width: vehicle.width,
                  height: vehicle.height,
                  transform: `translate(${-canvasContentOffset.x}px, ${-canvasContentOffset.y}px)`,
                }}
              >
                {snapGuides.length > 0 && (
                  <SnapGuideLines guides={snapGuides} color="#22d3ee" />
                )}
                {isEditMode && selectedElementIds.length > 1 && (() => {
                  const bounds = selectedElementsBounds(vehicle.elements, selectedElementIds);
                  if (!bounds) return null;
                  return (
                    <div
                      data-vehicle-bulk-move-layer
                      className="absolute z-[55] cursor-move rounded border border-dashed border-cyan-400/50 bg-cyan-400/5"
                      style={{
                        left: bounds.x,
                        top: bounds.y,
                        width: bounds.width,
                        height: bounds.height,
                      }}
                      title={t('vehicleEditor.workspace.moveSelectionTitle')}
                      onPointerDown={handleBulkMovePointerDown}
                    />
                  );
                })()}
                {vehicle.elements.map((el) => {
                  const selected = selectedElementIds.includes(el.id);
                  const origin = groupDrag?.origins[el.id];
                  const isInGroupDrag = Boolean(groupDrag && selected && origin);
                  const positionOverride = isInGroupDrag
                    ? {
                        x: Math.round(origin!.x + groupDrag!.delta.x),
                        y: Math.round(origin!.y + groupDrag!.delta.y),
                      }
                    : undefined;
                  const peerElements = vehicle.elements.filter((peer) => {
                    if (peer.id === el.id) return false;
                    if (groupDrag && selectedElementIds.includes(peer.id)) return false;
                    return true;
                  });

                  return (
                    <VehicleElementNode
                      key={el.id}
                      element={el}
                      vehicle={vehicle}
                      isEditMode={isEditMode}
                      selected={selected}
                      scale={totalScale}
                      disableDrag={isInGroupDrag || marqueeRect !== null}
                      multiSelectCount={selectedElementIds.length}
                      positionOverride={positionOverride}
                      peerElements={peerElements}
                      onSelect={onSelectElement}
                      onUpdate={(id, patch, options) => onUpdateElement(id, patch, options)}
                      onDragSessionStart={() => handleElementDragSessionStart(el.id)}
                      onGroupDragDelta={handleGroupDragDelta}
                      onDragEnd={handleElementDragEnd}
                      onAlignGuidesChange={(guides) => setSnapGuides(guides ?? [])}
                      onRotateLeft90={onRotateLeft90}
                      onRotateRight90={onRotateRight90}
                      onRotateDelta={onRotateDelta}
                    />
                  );
                })}
              </div>
            </div>
            {isEditMode && onResizeCanvas ? (
              <VehicleCanvasResizeOverlay
                onResizePointerDown={handleCanvasResizePointerDown}
                sizeLabel={`${vehicle.width} × ${vehicle.height} px`}
              />
            ) : null}
        </div>
        {isEditMode && (
          <p className="mt-3 font-mono text-[10px] text-zinc-500">
            {t('vehicleEditor.workspace.logicalCanvas', { w: vehicle.width, h: vehicle.height })}
            {compactCanvas ? t('vehicleEditor.workspace.compactHint') : null}
            {selectedElementIds.length > 0
              ? t('vehicleEditor.workspace.selectedHint', { count: selectedElementIds.length })
              : t('vehicleEditor.workspace.emptyHint')}
          </p>
        )}
      </div>
    </div>
  );
}
