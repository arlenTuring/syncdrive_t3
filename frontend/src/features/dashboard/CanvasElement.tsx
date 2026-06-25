import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import type { CanvasElementProps, ChildWidget, WidgetType } from './types';
import { WidgetRenderer } from './elements/WidgetRenderer';
import { GroupCanvasRenderer } from './elements/GroupCanvasRenderer';
import { MapPlatformLayer } from './elements/MapPlatformLayer';
import { BindingWarningIcon } from './components/BindingWarningIcon';
import { useBindingHealth } from './context/BindingHealthContext';
import { EditModeProvider } from './context/EditModeContext';
import { CANVAS_CHILD_LIST_CLOSE_EVENT } from './utils/canvasChildList';
import { CanvasChildListPortal } from './components/CanvasChildListPortal';
import { SnapGuideLines } from './components/SnapGuideLines';
import {
  snapDashboardPosition,
  snapDashboardResize,
  type AlignGuideLine,
  type ResizeDirection,
} from './utils/dragSnap';
import { List, Paintbrush, Trash2 } from 'lucide-react';
import { useFormatPainter } from './context/FormatPainterContext';
import { useModifierHeld } from './hooks/useModifierHeld';
import {
  isMarqueeDrag,
  marqueeRectsIntersect,
  normalizeMarqueeRect,
  type MarqueeRect,
} from './utils/marqueeSelect';
import { normalizeDegrees } from '../map-editor/utils/rotation';
import {
  applyElementResize,
  screenDeltaToLocal,
  type ElementResizeEdge,
} from '../../lib/elementResize';
import { RotatedElementResizeHandles } from '../../lib/RotatedElementResizeHandles';
import { canAddWidgetToCanvas } from './utils/widgetPlacementRules';
import {
  resolveMapVehicleTemplate,
} from './utils/resolveMapVehicleTemplate';

const DistLabel = ({ val, top, left, right, bottom, horizontal }: { val: number, top?: number | string, left?: number | string, right?: number | string, bottom?: number | string, horizontal?: boolean }) => (
  <div style={{
    position: 'absolute', top, left, right, bottom,
    transform: horizontal ? 'translateX(-50%)' : 'translateY(-50%)',
    background: 'rgba(15,22,35,0.95)', color: '#22d3ee', fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold',
    padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(34,211,238,0.5)', whiteSpace: 'nowrap', zIndex: 2100,
    pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
  }}>
    {Math.round(val)}
  </div>
);

const DistLabelChild = ({ val, top, left, right, bottom, horizontal, color }: { val: number, top?: number | string, left?: number | string, right?: number | string, bottom?: number | string, horizontal?: boolean, color: string }) => (
  <div style={{
    position: 'absolute', top, left, right, bottom,
    transform: horizontal ? 'translateX(-50%)' : 'translateY(-50%)',
    background: 'rgba(15,22,35,0.95)', color, fontSize: 8, fontFamily: 'monospace', fontWeight: 'bold',
    padding: '1px 4px', borderRadius: 2, border: `1px solid ${color}80`, whiteSpace: 'nowrap', zIndex: 1100,
    pointerEvents: 'none', boxShadow: '0 2px 5px rgba(0,0,0,0.4)'
  }}>
    {Math.round(val)}
  </div>
);

interface Props {
  element: CanvasElementProps;
  isSelected: boolean;
  selectedChildIds: string[];
  canvasPositionOverride?: { x: number; y: number } | null;
  scale: number;
  planeWidth: number;
  planeHeight: number;
  otherElements: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  isDimmed: boolean;
  isEditMode: boolean;
  onDragActiveChange: (active: boolean) => void;
  onSelect: (opts?: { additive?: boolean }) => void;
  onUpdate: (patch: Partial<CanvasElementProps>) => void;
  onDelete: () => void;
  onAddChild: (widgetType: WidgetType, x: number, y: number) => void;
  onSelectChild: (childId: string, opts?: { additive?: boolean }) => void;
  onSelectChildren: (childIds: string[], opts?: { additive?: boolean }) => void;
  onUpdateChild: (childId: string, patch: Partial<ChildWidget>) => void;
  onBatchUpdateChildren: (updates: Array<{ childId: string; patch: Partial<ChildWidget> }>) => void;
  onDeleteChild: (childId: string) => void;
  onEnterEditGroupMode?: (groupId: string) => void;
  onEditSessionStart?: () => void;
  onCanvasGroupDragStart?: (anchorId: string) => void;
  onCanvasGroupDragMove?: (anchorId: string, x: number, y: number) => void;
  onCanvasGroupDragStop?: (anchorId: string, x: number, y: number) => void;
}

export function CanvasElement({
  element, isSelected, selectedChildIds, canvasPositionOverride, scale,
  planeWidth, planeHeight, otherElements, isDimmed, isEditMode,
  onDragActiveChange,
  onSelect, onUpdate, onDelete,
  onAddChild, onSelectChild, onSelectChildren, onUpdateChild, onBatchUpdateChildren, onDeleteChild,
  onEnterEditGroupMode, onEditSessionStart,
  onCanvasGroupDragStart, onCanvasGroupDragMove, onCanvasGroupDragStop,
}: Props) {
  const hasChildSelection = selectedChildIds.length > 0;
  const { modifier: modifierHeld } = useModifierHeld();
  const { issueMap } = useBindingHealth();
  const canvasIssue = issueMap.get(element.id);
  const [isDragOver, setIsDragOver] = useState(false);
  const [labelHover, setLabelHover] = useState(false);
  const [childListOpen, setChildListOpen] = useState(false);
  const labelRef = useRef<HTMLDivElement>(null);
  const childListRootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [isResizingCanvas, setIsResizingCanvas] = useState(false);
  const [canDropCanvas, setCanDropCanvas] = useState(true);
  const [canvasResetKey] = useState(0);
  const [currentCanvasPos, setCurrentCanvasPos] = useState({ x: 0, y: 0 });
  const [currentCanvasSize, setCurrentCanvasSize] = useState({ width: 0, height: 0 });
  const [canvasDragPos, setCanvasDragPos] = useState<{ x: number; y: number } | null>(null);
  const [canvasResizeRect, setCanvasResizeRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [canvasSnapGuides, setCanvasSnapGuides] = useState<AlignGuideLine[]>([]);
  const [childSnapGuides, setChildSnapGuides] = useState<AlignGuideLine[]>([]);

  const snapCanvasAt = useCallback(
    (x: number, y: number) => {
      const peers = otherElements.map(e => ({
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
      }));
      return snapDashboardPosition(
        { x, y, width: element.width, height: element.height },
        peers,
        { x: 0, y: 0, width: planeWidth, height: planeHeight },
      );
    },
    [otherElements, element.width, element.height, planeWidth, planeHeight],
  );

  const [, setDraggingChildId] = useState<string | null>(null);
  const [, setCanDropChild] = useState(true);
  const [childResetKey, setChildResetKey] = useState(0);
  const [childMarquee, setChildMarquee] = useState<MarqueeRect | null>(null);
  const [childGroupDrag, setChildGroupDrag] = useState<{
    anchorId: string;
    origins: Record<string, { x: number; y: number }>;
    delta: { x: number; y: number };
  } | null>(null);
  const childGroupDragRef = useRef(childGroupDrag);
  childGroupDragRef.current = childGroupDrag;
  const selectedChildIdsRef = useRef(selectedChildIds);
  selectedChildIdsRef.current = selectedChildIds;

  const setGroupDrag = useCallback((
    next: {
      anchorId: string;
      origins: Record<string, { x: number; y: number }>;
      delta: { x: number; y: number };
    } | null,
  ) => {
    childGroupDragRef.current = next;
    setChildGroupDrag(next);
  }, []);

  const [, setResizingChildId] = useState<string | null>(null);
  const [, setCurrentChildPos] = useState({ x: 0, y: 0 });
  const [, setCurrentChildSize] = useState({ width: 0, height: 0 });

  function handleDragOver(e: React.DragEvent) {
    if (!isEditMode || !e.dataTransfer.types.includes('widgettype')) return;
    e.preventDefault(); e.stopPropagation();
    setIsDragOver(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    if (!innerRef.current?.contains(e.relatedTarget as Node)) setIsDragOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    if (!isEditMode) return;
    e.preventDefault(); e.stopPropagation();
    setIsDragOver(false);
    const widgetType = e.dataTransfer.getData('widgetType') as WidgetType;
    if (!widgetType || !innerRef.current) return;
    if (!canAddWidgetToCanvas(element, widgetType)) return;
    const rect = innerRef.current.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / scale);
    const y = Math.round((e.clientY - rect.top) / scale);
    onAddChild(widgetType, x, y);
  }

  function handleCanvasDragStart() {
    onEditSessionStart?.();
    if (!isSelected) onSelect();
    setIsDraggingCanvas(true);
    setCurrentCanvasPos({ x: element.x, y: element.y });
    onDragActiveChange(true);
    onCanvasGroupDragStart?.(element.id);
  }
  function handleCanvasDrag(_e: unknown, d: { x: number; y: number }) {
    const snapped = snapCanvasAt(d.x, d.y);
    setCanvasDragPos({ x: snapped.x, y: snapped.y });
    setCanvasSnapGuides(snapped.guides);
    setCurrentCanvasPos({ x: snapped.x, y: snapped.y });
    setCanDropCanvas(true);
    onCanvasGroupDragMove?.(element.id, snapped.x, snapped.y);
  }
  function handleCanvasDragStop(_e: unknown, d: { x: number; y: number }) {
    const snapped = snapCanvasAt(d.x, d.y);
    onCanvasGroupDragStop?.(element.id, snapped.x, snapped.y);
    if (!onCanvasGroupDragStop) {
      onUpdate({ x: snapped.x, y: snapped.y });
    }
    setCanvasDragPos(null);
    setCanvasSnapGuides([]);
    setIsDraggingCanvas(false);
    setCanDropCanvas(true);
    onDragActiveChange(false);
  }

  /** 標籤在畫布外側，react-rnd handle 無法可靠觸發，改用手動 pointer 拖曳 */
  const handleLabelPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isEditMode || e.button !== 0 || hasChildSelection) return;
      e.preventDefault();
      e.stopPropagation();
      onEditSessionStart?.();
      if (!isSelected) onSelect();

      const startX = e.clientX;
      const startY = e.clientY;
      const origX = element.x;
      const origY = element.y;
      const pointerId = e.pointerId;
      const labelEl = labelRef.current;
      labelEl?.setPointerCapture(pointerId);

      setIsDraggingCanvas(true);
      setCurrentCanvasPos({ x: origX, y: origY });
      onDragActiveChange(true);

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const rawX = origX + (ev.clientX - startX) / scale;
        const rawY = origY + (ev.clientY - startY) / scale;
        const snapped = snapCanvasAt(rawX, rawY);
        setCanvasDragPos({ x: snapped.x, y: snapped.y });
        setCanvasSnapGuides(snapped.guides);
        setCurrentCanvasPos({ x: snapped.x, y: snapped.y });
        setCanDropCanvas(true);
        onUpdate({ x: snapped.x, y: snapped.y });
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const rawX = origX + (ev.clientX - startX) / scale;
        const rawY = origY + (ev.clientY - startY) / scale;
        const snapped = snapCanvasAt(rawX, rawY);
        onUpdate({ x: snapped.x, y: snapped.y });
        setCanvasDragPos(null);
        setCanvasSnapGuides([]);
        setIsDraggingCanvas(false);
        setCanDropCanvas(true);
        onDragActiveChange(false);
        try {
          labelEl?.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [
      isEditMode,
      hasChildSelection,
      isSelected,
      element.x,
      element.y,
      scale,
      onEditSessionStart,
      onSelect,
      onUpdate,
      onDragActiveChange,
      snapCanvasAt,
    ],
  );

  function handleResizeStart() {
    onEditSessionStart?.();
    setIsResizingCanvas(true);
    setCurrentCanvasSize({ width: element.width, height: element.height });
  }

  const snapCanvasResizeAt = useCallback(
    (rect: { x: number; y: number; width: number; height: number }, dir: ResizeDirection) => {
      const peers = otherElements.map(e => ({
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
      }));
      return snapDashboardResize(
        rect,
        dir,
        peers,
        { x: 0, y: 0, width: planeWidth, height: planeHeight },
        { width: 120, height: 80 },
      );
    },
    [otherElements, planeWidth, planeHeight],
  );

  function handleResize(
    _e: unknown,
    dir: ResizeDirection,
    ref: HTMLElement,
    _delta: unknown,
    pos: { x: number; y: number },
  ) {
    const raw = {
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      width: Math.round(parseInt(ref.style.width)),
      height: Math.round(parseInt(ref.style.height)),
    };
    const snapped = snapCanvasResizeAt(raw, dir);
    setCanvasResizeRect(snapped.rect);
    setCanvasSnapGuides(snapped.guides);
    setCurrentCanvasSize({ width: snapped.rect.width, height: snapped.rect.height });
    setCurrentCanvasPos({ x: snapped.rect.x, y: snapped.rect.y });
  }

  function handleResizeStop(
    _e: unknown,
    dir: ResizeDirection,
    ref: HTMLElement,
    _delta: unknown,
    pos: { x: number; y: number },
  ) {
    const raw = {
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      width: Math.round(parseInt(ref.style.width)),
      height: Math.round(parseInt(ref.style.height)),
    };
    const snapped = snapCanvasResizeAt(raw, dir);
    onUpdate({
      width: snapped.rect.width,
      height: snapped.rect.height,
      x: snapped.rect.x,
      y: snapped.rect.y,
    });
    setCanvasResizeRect(null);
    setCanvasSnapGuides([]);
    setIsResizingCanvas(false);
  }

  const isMapPlatform = element.canvasKind === 'map-platform';
  const vehicleTemplate = useMemo(
    () => (isMapPlatform ? resolveMapVehicleTemplate(element) : null),
    [element, isMapPlatform],
  );
  const boxShadow = isEditMode && isSelected
    ? (canDropCanvas ? '0 0 0 2px #06b6d4, 0 0 12px rgba(6,182,212,0.25)' : '0 0 0 4px #ef4444, 0 0 20px rgba(239,68,68,0.5)')
    : isMapPlatform
      ? '0 0 0 1px rgba(14,165,233,0.35)'
      : '0 0 0 1px rgba(255,255,255,0.08)';

  const dimOpacity = isDimmed && !isDraggingCanvas ? 0.6 : 1;
  const isOverlayLayer = element.canvasLayer === 'overlay';
  const passThroughOverlay = isOverlayLayer && !isSelected;

  const showCanvasLabel =
    isEditMode &&
    !isDraggingCanvas &&
    !isResizingCanvas;

  useEffect(() => {
    if (!isSelected) setChildListOpen(false);
  }, [isSelected]);

  const closeChildList = useCallback(() => setChildListOpen(false), []);

  const beginChildMarquee = useCallback((
    clientX: number,
    clientY: number,
    additive: boolean,
  ) => {
    if (!isEditMode || element.isGroup) return;
    const rect = innerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const startX = (clientX - rect.left) / scale;
    const startY = (clientY - rect.top) / scale;
    let endX = startX;
    let endY = startY;

    const onMove = (ev: MouseEvent) => {
      if (!innerRef.current) return;
      const r = innerRef.current.getBoundingClientRect();
      endX = (ev.clientX - r.left) / scale;
      endY = (ev.clientY - r.top) / scale;
      setChildMarquee(normalizeMarqueeRect(startX, startY, endX, endY));
    };

    const onUp = (ev: MouseEvent) => {
      const marquee = normalizeMarqueeRect(startX, startY, endX, endY);
      setChildMarquee(null);
      if (isMarqueeDrag(marquee)) {
        const hits = element.children
          .filter(c => marqueeRectsIntersect(marquee, { x: c.x, y: c.y, width: c.width, height: c.height }))
          .map(c => c.id);
        onSelectChildren(hits, { additive: additive || ev.shiftKey });
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isEditMode, element.isGroup, element.children, scale, onSelectChildren]);

  useEffect(() => {
    const onClose = (e: Event) => {
      const canvasId = (e as CustomEvent<{ canvasId: string }>).detail?.canvasId;
      if (canvasId === element.id) closeChildList();
    };
    window.addEventListener(CANVAS_CHILD_LIST_CLOSE_EVENT, onClose);
    return () => window.removeEventListener(CANVAS_CHILD_LIST_CLOSE_EVENT, onClose);
  }, [element.id, closeChildList]);

  return (
    <Rnd
      key={canvasResetKey}
      className="dashboard-canvas-rnd"
      position={{
        x: canvasPositionOverride?.x ?? canvasResizeRect?.x ?? canvasDragPos?.x ?? element.x,
        y: canvasPositionOverride?.y ?? canvasResizeRect?.y ?? canvasDragPos?.y ?? element.y,
      }}
      size={{
        width: canvasResizeRect?.width ?? element.width,
        height: canvasResizeRect?.height ?? element.height,
      }}
      scale={scale}
      bounds="parent"
      minWidth={120}
      minHeight={80}
      dragGrid={[1, 1]}
      resizeGrid={[1, 1]}
      dragHandleClassName="canvas-drag-handle"
      cancel=".child-widget-container"
      disableDragging={!isEditMode || (hasChildSelection && isSelected) || modifierHeld}
      enableResizing={isEditMode && isSelected && !hasChildSelection && element.id !== 'template-canvas'}
      resizeHandleStyles={isEditMode && isSelected ? {
        bottomRight: { width: 12, height: 12, bottom: -4, right: -4, background: '#06b6d4', borderRadius: '50%', border: '2px solid #fff', zIndex: 100 },
        bottomLeft:  { width: 8, height: 8, bottom: -2, left: -2, background: '#06b6d4', borderRadius: '50%', zIndex: 100 },
        topRight:    { width: 8, height: 8, top: -2, right: -2, background: '#06b6d4', borderRadius: '50%', zIndex: 100 },
        topLeft:     { width: 8, height: 8, top: -2, left: -2, background: '#06b6d4', borderRadius: '50%', zIndex: 100 },
      } : {}}
      onDragStart={handleCanvasDragStart}
      onDrag={handleCanvasDrag}
      onDragStop={handleCanvasDragStop}
      onResizeStart={handleResizeStart}
      onResize={handleResize}
      onResizeStop={handleResizeStop}
      onClick={(e: React.MouseEvent) => {
        if (passThroughOverlay || !isEditMode) return;
        if ((e.target as HTMLElement).closest('.child-widget-container')) return;
        e.stopPropagation();
        onSelect({ additive: e.shiftKey });
      }}
      onDoubleClick={(e: React.MouseEvent) => {
        if (!isEditMode || !element.isGroup) return;
        if ((e.target as HTMLElement).closest('.child-widget-container')) return;
        e.stopPropagation();
        onSelect();
        onEnterEditGroupMode?.(element.id);
      }}
      style={{
        zIndex: (isDraggingCanvas || isResizingCanvas)
          ? 1000
          : isSelected
            ? (isOverlayLayer ? 8 : 12)
            : (isOverlayLayer ? 0 : element.isGroup ? 3 : 1),
        pointerEvents: passThroughOverlay ? 'none' : (isEditMode ? 'auto' : 'none'),
        overflow: isEditMode ? 'visible' : undefined,
      }}
    >
      {showCanvasLabel && (
        <>
          <CanvasChildListPortal
            open={childListOpen}
            anchorRef={childListRootRef}
            canvasLabel={element.label}
            childWidgets={element.children}
            selectedChildIds={selectedChildIds}
            onSelectCanvas={() => onSelect()}
            onSelectChild={(childId) => onSelectChild(childId)}
          />
          <div
            ref={childListRootRef}
            data-canvas-child-list-root
            style={{
              position: 'absolute',
              left: 0,
              bottom: '100%',
              marginBottom: 4,
              zIndex: 2100,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'stretch',
              maxWidth: 520,
              pointerEvents: 'auto',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              title={childListOpen ? '收合元件清單' : '展開元件清單'}
              aria-expanded={childListOpen}
              onClick={(e) => {
                e.stopPropagation();
                if (!isSelected) onSelect();
                setChildListOpen((open) => !open);
              }}
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                marginRight: 2,
                border: childListOpen
                  ? '1px solid rgba(6,182,212,0.7)'
                  : '1px solid rgba(6,182,212,0.35)',
                borderRadius: '3px 0 0 3px',
                background: childListOpen
                  ? 'rgba(6,182,212,0.35)'
                  : 'rgba(6,182,212,0.15)',
                color: '#e0f2fe',
                cursor: 'pointer',
              }}
            >
              <List size={12} aria-hidden />
            </button>
            <div
              ref={labelRef}
              title="拖曳以移動畫布"
              onPointerDown={handleLabelPointerDown}
              onMouseEnter={() => setLabelHover(true)}
              onMouseLeave={() => setLabelHover(false)}
              style={{
                minWidth: 48,
                maxWidth: 280,
                background: isSelected ? '#06b6d4' : 'rgba(6,182,212,0.72)',
                color: 'white',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: isSelected ? 'bold' : 600,
                padding: '2px 8px',
                borderRadius: '0 3px 3px 0',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                touchAction: 'none',
                userSelect: 'none',
                cursor: isDraggingCanvas ? 'grabbing' : 'grab',
                boxShadow: labelHover
                  ? '0 2px 10px rgba(6,182,212,0.45)'
                  : '0 1px 4px rgba(0,0,0,0.35)',
                opacity: isSelected || labelHover ? 1 : 0.88,
              }}
            >
              {element.label}
            </div>
          </div>
        </>
      )}
      <div
        ref={innerRef}
        style={{
          width: '100%', height: '100%', borderRadius: 4, position: 'relative',
          overflow: isEditMode ? 'visible' : 'hidden',
          opacity: (element.opacity / 100) * dimOpacity,
          background: isMapPlatform
            ? 'transparent'
            : element.backgroundImage
              ? `url(${element.backgroundImage}) center/cover no-repeat`
              : element.backgroundColor,
          boxShadow,
          transition: (isDraggingCanvas || isResizingCanvas) ? 'none' : 'box-shadow 0.12s ease, opacity 0.2s ease',
        }}
        className="canvas-drag-handle"
        onMouseDown={(e) => {
          if (!isEditMode || e.button !== 0) return;
          const target = e.target as HTMLElement;
          if (target.closest('.child-widget-container')) return;
          if (e.shiftKey || e.altKey || modifierHeld) {
            e.preventDefault();
            e.stopPropagation();
            beginChildMarquee(e.clientX, e.clientY, true);
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <BindingWarningIcon issue={canvasIssue} />
        {/* Drag-over Highlight */}
        {isDragOver && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 999, background: 'rgba(34,211,238,0.04)', border: '2px dashed rgba(34,211,238,0.4)', borderRadius: 4, pointerEvents: 'none' }} />
        )}

        {isMapPlatform && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
            <MapPlatformLayer
              mapId={element.mapId ?? ''}
              zoomFactor={element.zoomFactor ?? 1.35}
              vehicleTemplate={vehicleTemplate}
              isEditMode={isEditMode}
            />
          </div>
        )}

        {/* Children Widgets or Group Renderer */}
        {element.isGroup ? (
          <GroupCanvasRenderer
            element={element}
            isEditMode={isEditMode}
            isCanvasSelected={isSelected}
            onEnterEditMode={() => onEnterEditGroupMode?.(element.id)}
          />
        ) : (
          element.children
            .filter((child) => !(isMapPlatform && !isEditMode && child.type === 'vehicle-container'))
            .map(child => {
            const isChildSelected = selectedChildIds.includes(child.id);
            const groupOrigin = childGroupDrag?.origins[child.id];
            const isGroupAnchor = childGroupDrag?.anchorId === child.id;
            const isGroupFollower = Boolean(childGroupDrag && isChildSelected && !isGroupAnchor);
            const followerPositionOverride = isGroupFollower && groupOrigin && childGroupDrag
              ? { x: groupOrigin.x + childGroupDrag.delta.x, y: groupOrigin.y + childGroupDrag.delta.y }
              : null;

            return (
            <ChildWidgetRnd
              key={`${child.id}-${childResetKey}`}
              canvasId={element.id}
              child={child}
              peerChildren={element.children
                .filter(c => c.id !== child.id && !selectedChildIds.includes(c.id))
                .map(c => ({ id: c.id, x: c.x, y: c.y, width: c.width, height: c.height }))}
              parentBounds={{ width: element.width, height: element.height }}
              bindingIssue={issueMap.get(child.id)}
              isSelected={isChildSelected}
              positionOverride={followerPositionOverride}
              disableDrag={isGroupFollower || childMarquee !== null}
              scale={scale}
              isEditMode={isEditMode}
              onSelect={(additive) => { if (isEditMode) onSelectChild(child.id, { additive }); }}
              onShiftMarqueePointerDown={(e) => beginChildMarquee(e.clientX, e.clientY, true)}
              onUpdate={(patch) => {
                onUpdateChild(child.id, patch);
                if (
                  isMapPlatform
                  && child.type === 'vehicle-container'
                  && (patch.width !== undefined || patch.height !== undefined)
                ) {
                  onUpdate({
                    vehicleDisplayWidthPx: patch.width ?? child.width,
                    vehicleDisplayHeightPx: patch.height ?? child.height,
                  });
                }
              }}
              onDelete={() => onDeleteChild(child.id)}
              onDragStart={() => { 
                onEditSessionStart?.();
                closeChildList();
                setDraggingChildId(child.id);
                if (!isChildSelected && !modifierHeld) onSelectChild(child.id);
                setCurrentChildPos({ x: child.x, y: child.y });
                const activeIds = selectedChildIdsRef.current;
                if (activeIds.length > 1 && activeIds.includes(child.id)) {
                  const origins = Object.fromEntries(
                    element.children
                      .filter(c => activeIds.includes(c.id))
                      .map(c => [c.id, { x: c.x, y: c.y }]),
                  );
                  setGroupDrag({ anchorId: child.id, origins, delta: { x: 0, y: 0 } });
                } else {
                  setGroupDrag(null);
                }
              }}
              onDragEnd={(valid) => {
                if (!valid) {
                  setChildResetKey(k => k + 1);
                  setGroupDrag(null);
                }
                setDraggingChildId(null);
                setCanDropChild(true);
                setChildSnapGuides([]);
              }}
              onSnapGuidesChange={setChildSnapGuides}
              onDragMove={(valid, x, y) => { 
                setCanDropChild(valid);
                setCurrentChildPos({ x: Math.round(x), y: Math.round(y) });
                const group = childGroupDragRef.current;
                if (group?.anchorId === child.id) {
                  const origin = group.origins[child.id];
                  setGroupDrag({
                    ...group,
                    delta: { x: x - origin.x, y: y - origin.y },
                  });
                }
              }}
              onDragStop={(x, y) => {
                const group = childGroupDragRef.current;
                if (group?.anchorId === child.id) {
                  const origin = group.origins[child.id];
                  const delta = { x: x - origin.x, y: y - origin.y };
                  const updates = selectedChildIdsRef.current
                    .filter(id => group.origins[id])
                    .map(id => {
                      const o = group.origins[id];
                      return {
                        childId: id,
                        patch: {
                          x: Math.round((o.x + delta.x) * 2) / 2,
                          y: Math.round((o.y + delta.y) * 2) / 2,
                        },
                      };
                    });
                  onBatchUpdateChildren(updates);
                  setGroupDrag(null);
                  return;
                }
                onUpdateChild(child.id, { x, y });
              }}
              onResizeStart={() => {
                onEditSessionStart?.();
                closeChildList();
                setResizingChildId(child.id);
                setCurrentChildSize({ width: child.width, height: child.height });
                setCurrentChildPos({ x: child.x, y: child.y });
              }}
              onResize={(w, h, x, y) => {
                setCurrentChildSize({ width: w, height: h });
                setCurrentChildPos({ x, y });
              }}
              onResizeEnd={(valid) => {
                if (!valid) setChildResetKey(k => k + 1);
                setResizingChildId(null);
              }}
            />
            );
          })
        )}


        {/* Utilities */}
        {childMarquee && (
          <div
            style={{
              position: 'absolute',
              left: childMarquee.x,
              top: childMarquee.y,
              width: childMarquee.width,
              height: childMarquee.height,
              border: '1px dashed rgba(34,211,238,0.9)',
              background: 'rgba(34,211,238,0.12)',
              pointerEvents: 'none',
              zIndex: 3000,
            }}
          />
        )}

        {isSelected && !hasChildSelection && (
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ position: 'absolute', top: 4, right: 4, zIndex: 100, background: 'rgba(239,68,68,0.85)', border: 'none', borderRadius: 4, padding: '3px 5px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'white' }}>
            <Trash2 size={11} />
          </button>
        )}
        {isEditMode && (
          <div style={{ position: 'absolute', bottom: 4, right: 6, fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.15)', pointerEvents: 'none' }}>
            {element.width} × {element.height}
          </div>
        )}

        {/* 子元件對齊輔助線（畫布座標，避免被元件 overflow 裁切） */}
        {isEditMode && childSnapGuides.length > 0 && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1999 }}>
            <SnapGuideLines guides={childSnapGuides} color="#f472b6" />
          </div>
        )}
      </div>

      {/* Alignment & Vertex Guides - Outside Overflow */}
      {(isDraggingCanvas || isResizingCanvas) && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2000 }}>
          <SnapGuideLines
            guides={canvasSnapGuides}
            originX={currentCanvasPos.x}
            originY={currentCanvasPos.y}
          />
          {/* 中心線與中心座標 */}
          {!isResizingCanvas && (
            <>
              <div style={{ position: 'absolute', left: '50%', top: -5000, bottom: -5000, width: 0.5, background: 'rgba(34,211,238,0.75)' }} />
              <div style={{ position: 'absolute', top: '50%', left: -5000, right: -5000, height: 0.5, background: 'rgba(34,211,238,0.75)' }} />
              <div style={{
                position: 'absolute', left: '50%', top: '50%', transform: 'translate(10px, 10px)',
                background: 'rgba(15,22,35,0.95)', color: canDropCanvas ? '#22d3ee' : '#ef4444',
                padding: '3px 10px', borderRadius: 4, fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace',
                border: '1px solid rgba(34,211,238,0.4)', boxShadow: '0 4px 15px rgba(0,0,0,0.6)', whiteSpace: 'nowrap'
              }}>
                {Math.round(currentCanvasPos.x + (isResizingCanvas ? currentCanvasSize.width : element.width) / 2)}, 
                {Math.round(currentCanvasPos.y + (isResizingCanvas ? currentCanvasSize.height : element.height) / 2)}
              </div>
            </>
          )}

          {/* 頂點延伸引導線 (四個頂點) */}
          <div style={{ position: 'absolute', left: 0, top: -5000, bottom: -5000, width: 1, borderLeft: '1px dashed rgba(34,211,238,0.4)' }} />
          <div style={{ position: 'absolute', right: 0, top: -5000, bottom: -5000, width: 1, borderLeft: '1px dashed rgba(34,211,238,0.4)' }} />
          <div style={{ position: 'absolute', top: 0, left: -5000, right: -5000, height: 1, borderTop: '1px dashed rgba(34,211,238,0.4)' }} />
          <div style={{ position: 'absolute', bottom: 0, left: -5000, right: -5000, height: 1, borderTop: '1px dashed rgba(34,211,238,0.4)' }} />

          {/* 頂點標籤 - 獨立定位確保顯示 */}
          <DistLabel val={currentCanvasPos.x} left={0} top={-40} horizontal />
          <DistLabel val={currentCanvasPos.x + (isResizingCanvas ? currentCanvasSize.width : element.width)} left="100%" top={-40} horizontal />
          <DistLabel val={currentCanvasPos.y} top={0} left={-45} />
          <DistLabel val={currentCanvasPos.y + (isResizingCanvas ? currentCanvasSize.height : element.height)} top="100%" left={-45} />

          {/* 動態尺寸顯示 */}
          {isResizingCanvas && (
            <div style={{
              position: 'absolute', bottom: -30, left: '50%', transform: 'translateX(-50%)',
              background: '#06b6d4', color: 'white', padding: '3px 12px', borderRadius: 4,
              fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace', boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
            }}>
              W: {currentCanvasSize.width} H: {currentCanvasSize.height}
            </div>
          )}
        </div>
      )}
    </Rnd>
  );
}

// ─── ChildWidgetRnd ──────────────────────────────────────────────────

interface ChildRndProps {
  canvasId: string;
  child: ChildWidget;
  peerChildren: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  parentBounds: { width: number; height: number };
  bindingIssue?: import('./template/bindingHealth').BindingIssue;
  isSelected: boolean;
  positionOverride?: { x: number; y: number } | null;
  disableDrag?: boolean;
  scale: number;
  isEditMode: boolean;
  onSelect: (additive: boolean) => void;
  onShiftMarqueePointerDown?: (e: { clientX: number; clientY: number }) => void;
  onUpdate: (patch: Partial<ChildWidget>) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: (valid: boolean) => void;
  onDragMove: (canDrop: boolean, x: number, y: number) => void;
  onDragStop: (x: number, y: number) => void;
  onResizeStart: () => void;
  onResize: (w: number, h: number, x: number, y: number) => void;
  onResizeEnd: (valid: boolean) => void;
  onSnapGuidesChange?: (guides: AlignGuideLine[]) => void;
  onDoubleClick?: () => void;
}

const CHILD_RESIZE_HANDLES = {
  top: true, right: true, bottom: true, left: true,
  topRight: true, bottomRight: true, bottomLeft: true, topLeft: true,
} as const;

const childResizeHandleStyle = (color: string) => ({
  bottomRight: { width: 10, height: 10, bottom: -4, right: -4, background: color, borderRadius: 2, border: '1.5px solid #fff', zIndex: 200 },
  bottomLeft: { width: 8, height: 8, bottom: -3, left: -3, background: color, borderRadius: 2, border: '1.5px solid #fff', zIndex: 200 },
  topRight: { width: 8, height: 8, top: -3, right: -3, background: color, borderRadius: 2, border: '1.5px solid #fff', zIndex: 200 },
  topLeft: { width: 8, height: 8, top: -3, left: -3, background: color, borderRadius: 2, border: '1.5px solid #fff', zIndex: 200 },
  right: { width: 6, height: 20, right: -3, top: '50%', marginTop: -10, background: color, borderRadius: 2, zIndex: 200 },
  left: { width: 6, height: 20, left: -3, top: '50%', marginTop: -10, background: color, borderRadius: 2, zIndex: 200 },
  bottom: { height: 6, width: 20, bottom: -3, left: '50%', marginLeft: -10, background: color, borderRadius: 2, zIndex: 200 },
  top: { height: 6, width: 20, top: -3, left: '50%', marginLeft: -10, background: color, borderRadius: 2, zIndex: 200 },
});

function ChildWidgetRnd({
  canvasId,
  child,
  peerChildren,
  parentBounds,
  bindingIssue,
  isSelected,
  positionOverride,
  disableDrag,
  scale,
  isEditMode,
  onSelect,
  onShiftMarqueePointerDown,
  onUpdate,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragMove,
  onDragStop,
  onResizeStart,
  onResize,
  onResizeEnd,
  onSnapGuidesChange,
  onDoubleClick,
}: ChildRndProps) {
  const fp = useFormatPainter();
  const { modifier: modifierHeld } = useModifierHeld();
  const painterActive = !!fp?.armed;
  const canReceivePaint = painterActive && (fp?.canApplyTo(child) ?? false);
  const isPaintSource = painterActive && fp?.armed?.sourceType === child.type && isSelected;

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [resizeRect, setResizeRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [curX, setCurX] = useState(child.x);
  const [curY, setCurY] = useState(child.y);
  const [curW, setCurW] = useState(child.width);
  const [curH, setCurH] = useState(child.height);

  const snapChildAt = useCallback(
    (x: number, y: number) =>
      snapDashboardPosition(
        { x, y, width: child.width, height: child.height },
        peerChildren,
        { x: 0, y: 0, width: parentBounds.width, height: parentBounds.height },
      ),
    [child.width, child.height, peerChildren, parentBounds.width, parentBounds.height],
  );

  const snapChildResizeAt = useCallback(
    (rect: { x: number; y: number; width: number; height: number }, dir: ResizeDirection) =>
      snapDashboardResize(
        rect,
        dir,
        peerChildren,
        { x: 0, y: 0, width: parentBounds.width, height: parentBounds.height },
        { width: 10, height: 10 },
      ),
    [peerChildren, parentBounds.width, parentBounds.height],
  );

const color =  {
    text: '#f59e0b', image: '#10b981', 'line-chart': '#06b6d4', database: '#a78bfa',
    gauge: '#ec4899', 'slot-grid': '#f43f5e', 'route-progress': '#3b82f6',
    'color-block': '#64748b', 'status-badge': '#22c55e', 'stat-card': '#e879f9',
    'progress-bar': '#38bdf8', clock: '#a3e635',
    'segment-bar': '#22c55e', 'bar-chart': '#f97316', 'map-canvas': '#0ea5e9',
    'empty-state': '#94a3b8',
    'unit-telemetry-card': '#a78bfa',
    'alert-banner': '#f97316',
    'vehicle-alert-banner': '#f97316',
    'vehicle-container': '#f59e0b',
  }[child.type] || '#94a3b8';
  const label = {
    text: 'TEXT', image: 'IMG', 'line-chart': 'CHART', database: 'DB',
    gauge: 'GAUGE', 'slot-grid': 'SLOTS', 'route-progress': 'ROUTE',
    'color-block': 'COLOR', 'status-badge': 'BADGE', 'stat-card': 'KPI',
    'progress-bar': 'BAR', clock: 'CLOCK',
    'segment-bar': 'SEG', 'bar-chart': 'BARS', 'map-canvas': 'MAP',
    'empty-state': 'EMPTY',
    'unit-telemetry-card': 'TELEM',
    'alert-banner': 'ALERT',
    'vehicle-alert-banner': 'ALERT',
    'vehicle-container': 'VEH',
  }[child.type] || 'WIDGET';

  const rotationDeg = child.rotationDeg ?? 0;
  const isRotated = normalizeDegrees(rotationDeg) % 360 !== 0;

  const onRotatedResizePointerDown = useCallback(
    (edge: ElementResizeEdge, e: React.PointerEvent) => {
      if (!isEditMode) return;
      e.stopPropagation();
      e.preventDefault();
      onResizeStart();
      setIsResizing(true);
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = {
        x: child.x,
        y: child.y,
        width: child.width,
        height: child.height,
      };
      let last = origin;
      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        const local = screenDeltaToLocal(dx, dy, rotationDeg);
        const result = applyElementResize(edge, local.dx, local.dy, origin, {
          anchorCenter: true,
        });
        last = result;
        setResizeRect(result);
        setCurW(result.width);
        setCurH(result.height);
        setCurX(result.x);
        setCurY(result.y);
        onResize(result.width, result.height, result.x, result.y);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        onUpdate({
          width: last.width,
          height: last.height,
          x: last.x,
          y: last.y,
        } as Partial<ChildWidget>);
        setResizeRect(null);
        setIsResizing(false);
        onResizeEnd(true);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [child.x, child.y, child.width, child.height, isEditMode, onResize, onResizeEnd, onResizeStart, onUpdate, rotationDeg, scale],
  );

  return (
    <Rnd
      key={child.id}
      position={{
        x: positionOverride?.x ?? resizeRect?.x ?? dragPos?.x ?? child.x,
        y: positionOverride?.y ?? resizeRect?.y ?? dragPos?.y ?? child.y,
      }}
      size={{
        width: resizeRect?.width ?? child.width,
        height: resizeRect?.height ?? child.height,
      }}
      scale={scale}
      bounds="parent"
      minWidth={10}
      minHeight={10}
      dragGrid={[1, 1]}
      resizeGrid={[1, 1]}
      disableDragging={!isEditMode || painterActive || disableDrag || modifierHeld}
      cancel={undefined}
      enableResizing={isEditMode && isSelected && !isRotated ? CHILD_RESIZE_HANDLES : false}
      resizeHandleStyles={isEditMode && isSelected && !isRotated ? childResizeHandleStyle(color) : {}}
      className="child-widget-container"
      onDragStart={() => { setIsDragging(true); setCurX(child.x); setCurY(child.y); onDragStart(); }}
      onDrag={(_e, d) => {
        const snapped = snapChildAt(d.x, d.y);
        setDragPos({ x: snapped.x, y: snapped.y });
        onSnapGuidesChange?.(snapped.guides);
        setCurX(snapped.x);
        setCurY(snapped.y);
        onDragMove(true, snapped.x, snapped.y);
      }}
      onDragStop={(_e, d) => {
        const snapped = snapChildAt(d.x, d.y);
        setIsDragging(false);
        setDragPos(null);
        onSnapGuidesChange?.([]);
        onDragStop(snapped.x, snapped.y);
        onDragEnd(true);
      }}
      onResizeStart={() => {
        setIsResizing(true);
        setCurW(child.width);
        setCurH(child.height);
        setCurX(child.x);
        setCurY(child.y);
        onResizeStart();
      }}
      onResize={(_e, dir, ref, _delta, pos) => {
        const raw = {
          x: Math.round(pos.x),
          y: Math.round(pos.y),
          width: Math.round(parseInt(ref.style.width)),
          height: Math.round(parseInt(ref.style.height)),
        };
        const snapped = snapChildResizeAt(raw, dir);
        setResizeRect(snapped.rect);
        onSnapGuidesChange?.(snapped.guides);
        setCurW(snapped.rect.width);
        setCurH(snapped.rect.height);
        setCurX(snapped.rect.x);
        setCurY(snapped.rect.y);
        onResize(snapped.rect.width, snapped.rect.height, snapped.rect.x, snapped.rect.y);
        if (child.type === 'line-chart') {
          onUpdate({
            width: snapped.rect.width,
            height: snapped.rect.height,
            x: snapped.rect.x,
            y: snapped.rect.y,
          } as Partial<ChildWidget>);
        }
      }}
      onResizeStop={(_e, dir, ref, _delta, pos) => {
        const raw = {
          x: Math.round(pos.x),
          y: Math.round(pos.y),
          width: Math.round(parseInt(ref.style.width)),
          height: Math.round(parseInt(ref.style.height)),
        };
        const snapped = snapChildResizeAt(raw, dir);
        onUpdate({
          width: snapped.rect.width,
          height: snapped.rect.height,
          x: snapped.rect.x,
          y: snapped.rect.y,
        } as Partial<ChildWidget>);
        setResizeRect(null);
        onSnapGuidesChange?.([]);
        setIsResizing(false);
        onResizeEnd(true);
      }}
      onMouseDown={(e) => {
        if (!isEditMode || e.button !== 0) return;
        e.stopPropagation();
        if (painterActive && fp?.armed) {
          e.preventDefault();
          if (fp.canApplyTo(child)) fp.apply(canvasId, child);
          return;
        }
        const modifier = e.shiftKey || e.altKey || modifierHeld;
        if (modifier) {
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          let marqueeStarted = false;

          onSelect(true);

          const onMove = (ev: MouseEvent) => {
            if (marqueeStarted) return;
            if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) {
              marqueeStarted = true;
              onShiftMarqueePointerDown?.({ clientX: startX, clientY: startY });
            }
          };

          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };

          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
          return;
        }
        if (!isSelected) {
          onSelect(false);
        }
      }}
      onClick={(e: React.MouseEvent) => {
        if (!isEditMode) return;
        e.stopPropagation();
        if (isSelected && !e.shiftKey && !e.altKey && !modifierHeld) {
          onSelect(false);
        }
      }}
      onDoubleClick={(e: React.MouseEvent) => {
        if (!isEditMode || !onDoubleClick) return;
        e.stopPropagation();
        onDoubleClick();
      }}
      style={{
        zIndex: (isDragging || isResizing)
          ? 500
          : positionOverride
            ? 450
            : isEditMode && isSelected
              ? 50
              : (child.type === 'color-block' ? 1 : 5),
        pointerEvents: isEditMode ? 'auto' : 'none',
      }}
    >
      <div style={{
        width: '100%', height: '100%', position: 'relative',
        transform: isRotated ? `rotate(${rotationDeg}deg)` : undefined,
        transformOrigin: 'center center',
        boxShadow: isEditMode && isSelected && !isRotated ? `0 0 0 2px ${color}, 0 0 8px ${color}40` : 'none',
        overflow: child.type === 'vehicle-container' || (isEditMode && isSelected) ? 'visible' : 'hidden',
        cursor: painterActive
          ? (canReceivePaint ? 'copy' : 'not-allowed')
          : (isEditMode ? 'move' : 'default'),
      }}>
        {isEditMode && isSelected && isRotated && (
          <div className="absolute inset-0 z-[300]">
            <RotatedElementResizeHandles
              rotationDeg={rotationDeg}
              dataAttribute="data-dashboard-resize-handle"
              onResizePointerDown={onRotatedResizePointerDown}
            />
          </div>
        )}
        {canReceivePaint && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 998,
            border: '2px dashed #d946ef', borderRadius: 2, pointerEvents: 'none',
            boxShadow: '0 0 10px rgba(217,70,239,0.35)',
          }} />
        )}
        <BindingWarningIcon issue={bindingIssue} />
        <div style={{ width: '100%', height: '100%', pointerEvents: isEditMode ? 'none' : 'auto', userSelect: 'none' }}>
          <EditModeProvider value={isEditMode}>
            <WidgetRenderer
              widget={child}
              isSelected={isSelected}
              editorScale={scale}
              onPatchWidget={(patch) => onUpdate(patch)}
            />
          </EditModeProvider>
        </div>
      </div>

      {/* Child Labels + 格式刷 */}
      {isEditMode && isSelected && !isDragging && !isResizing && (
        <div style={{
          position: 'absolute', top: -18, left: 0, zIndex: 210,
          display: 'flex', alignItems: 'stretch', pointerEvents: 'auto',
        }}>
          <span style={{
            background: color, color: 'white', fontSize: 9, fontFamily: 'monospace',
            fontWeight: 'bold', padding: '1px 5px', borderRadius: '2px 0 0 0',
          }}>
            {label}
          </span>
          <button
            type="button"
            title="複製格式：點選其他同類型元件套用"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              fp?.arm(child);
            }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isPaintSource ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.35)',
              border: 'none', borderRadius: '0 2px 0 0', padding: '1px 5px',
              cursor: 'pointer', color: 'white',
            }}
          >
            <Paintbrush size={9} />
          </button>
        </div>
      )}
      {isEditMode && isSelected && !isDragging && !isResizing && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ position: 'absolute', top: 2, right: 2, zIndex: 200, background: 'rgba(239,68,68,0.9)', border: 'none', borderRadius: 3, padding: '2px 4px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'white' }}>
          <Trash2 size={9} />
        </button>
      )}

      {/* Vertex Guides (Child) */}
      {isEditMode && (isDragging || isResizing) && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1000 }}>
          {!isResizing && (
            <>
              <div style={{ position: 'absolute', left: '50%', top: -5000, bottom: -5000, width: 0.5, background: color, opacity: 0.75 }} />
              <div style={{ position: 'absolute', top: '50%', left: -5000, right: -5000, height: 0.5, background: color, opacity: 0.75 }} />
              <div style={{
                position: 'absolute', left: '50%', top: '50%', transform: 'translate(8px, 8px)',
                background: 'rgba(15,22,35,0.95)', color, padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 'bold', fontFamily: 'monospace',
                border: `1px solid ${color}60`, boxShadow: '0 4px 10px rgba(0,0,0,0.4)', whiteSpace: 'nowrap'
              }}>
                {Math.round(curX + curW / 2)}, {Math.round(curY + curH / 2)}
              </div>
            </>
          )}

          {/* 頂點延伸引導線 (Child - 四邊) */}
          <div style={{ position: 'absolute', left: 0, top: -5000, bottom: -5000, width: 1, borderLeft: `1px dashed ${color}80` }} />
          <div style={{ position: 'absolute', right: 0, top: -5000, bottom: -5000, width: 1, borderLeft: `1px dashed ${color}80` }} />
          <div style={{ position: 'absolute', top: 0, left: -5000, right: -5000, height: 1, borderTop: `1px dashed ${color}80` }} />
          <div style={{ position: 'absolute', bottom: 0, left: -5000, right: -5000, height: 1, borderTop: `1px dashed ${color}80` }} />

          {/* 頂點標籤 (Child) */}
          <DistLabelChild val={curX} left={0} top={-30} horizontal color={color} />
          <DistLabelChild val={curX + curW} left="100%" top={-30} horizontal color={color} />
          <DistLabelChild val={curY} top={0} left={-35} color={color} />
          <DistLabelChild val={curY + curH} top="100%" left={-35} color={color} />

          {isResizing && (
            <div style={{
              position: 'absolute', bottom: -20, left: '50%', transform: 'translateX(-50%)',
              background: color, color: 'white', padding: '1px 8px', borderRadius: 3,
              fontSize: 10, fontWeight: 'bold', fontFamily: 'monospace', boxShadow: '0 4px 10px rgba(0,0,0,0.4)'
            }}>
              {curW} x {curH}
            </div>
          )}
        </div>
      )}
    </Rnd>
  );
}
