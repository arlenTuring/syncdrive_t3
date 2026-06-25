import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { VehicleRotationToolbar } from '../components/VehicleRotationToolbar';
import type { VehicleDefinition, VehicleElement } from '../types';
import type { IconContentMetrics } from '../utils/fitIconBounds';
import { RotatedElementResizeHandles } from '../../../lib/RotatedElementResizeHandles';
import {
  applyVehicleElementResize,
  screenDeltaToLocal,
  type VehicleResizeEdge,
} from '../utils/elementResize';
import {
  elementReportsContentMetrics,
} from '../utils/elementIconFit';
import {
  snapVehicleElementPosition,
  type AlignGuideLine,
} from '../utils/vehicleElementSnap';
import { VehicleElementRenderer } from './VehicleElementRenderer';

export function VehicleElementNode({
  element,
  vehicle,
  isEditMode,
  selected,
  scale,
  onSelect,
  onUpdate,
  onRotateLeft90,
  onRotateRight90,
  onRotateDelta,
  onDragSessionStart,
  onGroupDragDelta,
  onDragMove,
  onDragEnd,
  onAlignGuidesChange,
  positionOverride,
  disableDrag = false,
  multiSelectCount = 0,
  peerElements = [],
}: {
  element: VehicleElement;
  vehicle: VehicleDefinition;
  isEditMode: boolean;
  selected: boolean;
  scale: number;
  positionOverride?: { x: number; y: number; width?: number };
  disableDrag?: boolean;
  /** 目前多選數量（>1 時點已選元件不取消全選） */
  multiSelectCount?: number;
  peerElements?: VehicleElement[];
  onSelect: (id: string, opts?: { additive?: boolean }) => void;
  onUpdate: (
    id: string,
    patch: Partial<VehicleElement>,
    options?: { recordHistory?: boolean },
  ) => void;
  onRotateLeft90?: (id: string) => void;
  onRotateRight90?: (id: string) => void;
  onRotateDelta?: (id: string, delta: number) => void;
  onDragSessionStart?: () => void;
  /** 多選群組拖曳：以畫布位移更新整組 */
  onGroupDragDelta?: (dx: number, dy: number) => void;
  onDragMove?: (id: string, x: number, y: number) => void;
  onDragEnd?: (id: string) => void;
  onAlignGuidesChange?: (guides: AlignGuideLine[] | null) => void;
}) {
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  /** 拖曳／縮放進行中，避免自動貼齊與手動調整互搶 */
  const interactionSessionRef = useRef(false);

  const rotationDeg = element.rotationDeg ?? 0;
  const [contentMetrics, setContentMetrics] = useState<IconContentMetrics | null>(null);
  /** 選取框／縮放把手貼齊可視圖示（含車燈 alpha 邊界） */
  const interactionHostStyle: CSSProperties | undefined =
    isEditMode && selected
      ? contentMetrics
        ? {
            left: contentMetrics.x,
            top: contentMetrics.y,
            width: contentMetrics.width,
            height: contentMetrics.height,
          }
        : { inset: 0 }
      : undefined;

  useEffect(() => {
    setContentMetrics(null);
  }, [element.id]);

  const useContentSelection = isEditMode && selected && contentMetrics != null;
  const usesContentHitArea =
    isEditMode && elementReportsContentMetrics(element) && contentMetrics != null;

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!isEditMode) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-vehicle-rotation-toolbar]')) return;
      if (target.closest('[data-vehicle-resize-handle]')) return;
      e.stopPropagation();
      const keepMultiSelect = multiSelectCount > 1 && selected && !e.shiftKey;
      if (!keepMultiSelect) {
        onSelect(element.id, { additive: e.shiftKey });
      }
      if (disableDrag) return;
      onDragSessionStart?.();
      interactionSessionRef.current = true;
      const startX = e.clientX;
      const startY = e.clientY;
      dragRef.current = {
        startX,
        startY,
        originX: element.x,
        originY: element.y,
      };

      const isGroupDrag = multiSelectCount > 1 && selected;

      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        const dx = (ev.clientX - dragRef.current.startX) / scale;
        const dy = (ev.clientY - dragRef.current.startY) / scale;
        if (isGroupDrag) {
          onGroupDragDelta?.(dx, dy);
          return;
        }
        const rawX = dragRef.current.originX + dx;
        const rawY = dragRef.current.originY + dy;
        const snapped = snapVehicleElementPosition(
          {
            x: rawX,
            y: rawY,
            width: element.width,
            height: element.height,
          },
          peerElements,
          vehicle.width,
          vehicle.height,
          Math.max(2, 4 / Math.max(0.25, scale)),
        );
        onAlignGuidesChange?.(snapped.guides.length > 0 ? snapped.guides : null);
        onUpdate(
          element.id,
          { x: snapped.x, y: snapped.y },
          { recordHistory: false },
        );
        onDragMove?.(element.id, snapped.x, snapped.y);
      };
      const onUp = () => {
        dragRef.current = null;
        interactionSessionRef.current = false;
        onAlignGuidesChange?.(null);
        onDragEnd?.(element.id);
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
      disableDrag,
      multiSelectCount,
      selected,
      element.id,
      element.x,
      element.y,
      element.width,
      element.height,
      scale,
      vehicle.width,
      vehicle.height,
      peerElements,
      onSelect,
      onUpdate,
      onDragSessionStart,
      onGroupDragDelta,
      onDragMove,
      onDragEnd,
      onAlignGuidesChange,
    ],
  );

  const onResizePointerDown = useCallback(
    (edge: VehicleResizeEdge, e: ReactPointerEvent) => {
      if (!isEditMode) return;
      e.stopPropagation();
      e.preventDefault();
      onDragSessionStart?.();
      interactionSessionRef.current = true;
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      };
      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        const local = screenDeltaToLocal(dx, dy, rotationDeg);
        const anchorCenter = rotationDeg % 360 !== 0;
        onUpdate(
          element.id,
          applyVehicleElementResize(edge, local.dx, local.dy, origin, { anchorCenter }),
          { recordHistory: false },
        );
      };
      const onUp = () => {
        interactionSessionRef.current = false;
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
      element.id,
      element.x,
      element.y,
      element.width,
      element.height,
      rotationDeg,
      scale,
      onUpdate,
      onDragSessionStart,
    ],
  );

  const stopBubble = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const displayX = positionOverride?.x ?? element.x;
  const displayY = positionOverride?.y ?? element.y;

  return (
    <div
      data-vehicle-element={element.id}
      className={`absolute ${isEditMode && !disableDrag && !usesContentHitArea ? 'cursor-move' : ''}`}
      style={{
        left: displayX,
        top: displayY,
        width: positionOverride?.width ?? element.width,
        height: element.height,
        zIndex: selected ? 50 : 10,
        pointerEvents: usesContentHitArea ? 'none' : undefined,
        boxShadow:
          selected && isEditMode && !useContentSelection
            ? '0 0 0 1px rgba(34,211,238,0.85)'
            : undefined,
      }}
      onPointerDown={usesContentHitArea ? undefined : onPointerDown}
      onClick={usesContentHitArea ? undefined : stopBubble}
    >
      <div
        className={`relative h-full w-full ${isEditMode && !disableDrag && !usesContentHitArea ? 'cursor-move' : ''}`}
        style={{
          transform: `rotate(${rotationDeg}deg)`,
          transformOrigin: 'center center',
          pointerEvents: usesContentHitArea ? 'none' : undefined,
        }}
      >
        {isEditMode && element.editPlaceholder && !selected && (
          <div className="pointer-events-none absolute -top-4 left-0 text-[8px] text-zinc-500">
            {element.editPlaceholder}
          </div>
        )}
        <VehicleElementRenderer
          element={element}
          vehicle={vehicle}
          isEditMode={isEditMode}
          onContentMetrics={
            elementReportsContentMetrics(element) ? setContentMetrics : undefined
          }
        />
        {usesContentHitArea && (
          <div
            className={`absolute z-[5] ${!disableDrag ? 'cursor-move' : 'cursor-pointer'}`}
            style={{
              left: contentMetrics!.x,
              top: contentMetrics!.y,
              width: contentMetrics!.width,
              height: contentMetrics!.height,
              pointerEvents: 'auto',
            }}
            onPointerDown={onPointerDown}
            onClick={stopBubble}
            aria-hidden
          />
        )}
        {isEditMode && selected && multiSelectCount > 1 && !disableDrag && (
          <div
            className="absolute inset-0 z-[15] cursor-move"
            aria-hidden
          />
        )}
        {isEditMode && selected && multiSelectCount <= 1 && (
          <div
            className="pointer-events-none absolute z-10"
            style={interactionHostStyle ?? { inset: 0 }}
          >
            <RotatedElementResizeHandles
              rotationDeg={rotationDeg}
              dataAttribute="data-vehicle-resize-handle"
              onResizePointerDown={onResizePointerDown}
            />
          </div>
        )}
        {isEditMode && selected && multiSelectCount > 1 && (
          <div
            className="pointer-events-none absolute inset-0 z-10 rounded border border-cyan-400/85"
            style={interactionHostStyle ?? { inset: 0 }}
            aria-hidden
          />
        )}
      </div>

      {isEditMode && selected && !disableDrag && onRotateLeft90 && onRotateRight90 && onRotateDelta && (
        <VehicleRotationToolbar
          rotationDeg={rotationDeg}
          screenScale={scale}
          onRotateLeft90={() => onRotateLeft90(element.id)}
          onRotateRight90={() => onRotateRight90(element.id)}
          onRotateDelta={(delta) => onRotateDelta(element.id, delta)}
        />
      )}
    </div>
  );
}
