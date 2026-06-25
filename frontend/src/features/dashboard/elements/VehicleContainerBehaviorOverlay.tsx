import { useCallback, useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import { VehicleContainedIcon } from '../../vehicle-editor/elements/VehicleContainedIcon';
import { useEditMode } from '../context/EditModeContext';
import { useMqttData } from './useMqttData';
import { useWidgetData } from './useWidgetData';
import { useVariables } from '../VariableContext';
import type { VehicleContainerWidget } from '../types';
import {
  BEHAVIOR_LAYOUT_GAP,
  behaviorIconsLayoutWidth,
  resolveVehicleContainerBehaviorIconUrls,
} from '../utils/resolveVehicleContainerBehaviorIcons';

const MIN_BEHAVIOR_ICON_SIZE = 8;
const MAX_BEHAVIOR_ICON_SIZE = 64;

const EDIT_FRAME =
  'pointer-events-none absolute inset-0 rounded border border-dashed border-violet-400/70 bg-violet-500/12';

export function VehicleContainerBehaviorOverlay({
  widget,
  vehicleCenterX,
  vehicleCenterY,
  isSelected,
  editorScale = 1,
  onPatch,
}: {
  widget: VehicleContainerWidget;
  vehicleCenterX: number;
  vehicleCenterY: number;
  isSelected: boolean;
  editorScale?: number;
  onPatch?: (patch: Partial<VehicleContainerWidget>) => void;
}) {
  const isEditMode = useEditMode();
  const variables = useVariables();
  const { data: sqlRows } = useWidgetData(widget);
  const mqtt = useMqttData(widget);
  const sqlRow = sqlRows[0] ?? null;

  const iconSize = widget.behaviorIconSize ?? 20;
  const offsetX = widget.behaviorOffsetX ?? 0;
  const offsetY = widget.behaviorOffsetY ?? -28;
  const rules = widget.actionIconRules;

  const mqttPayload = useMemo(() => {
    const raw = mqtt.data;
    if (!raw) return null;
    if ('value' in raw && Object.keys(raw).length <= 2) {
      return typeof raw.value === 'object' && raw.value !== null
        ? (raw.value as Record<string, unknown>)
        : { operation_action: raw.value };
    }
    return raw;
  }, [mqtt.data]);

  const activeUrls = useMemo(
    () => resolveVehicleContainerBehaviorIconUrls(rules, variables, sqlRow, mqttPayload),
    [rules, variables, sqlRow, mqttPayload],
  );

  const showUrls = activeUrls;
  const layoutWidth = behaviorIconsLayoutWidth(Math.max(showUrls.length, 1), iconSize);

  const anchorLeft = vehicleCenterX + offsetX - layoutWidth / 2;
  const anchorTop = vehicleCenterY + offsetY - iconSize / 2;

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!isEditMode || !isSelected || !onPatch || e.button !== 0) return;
      if ((e.target as HTMLElement).closest('[data-behavior-resize-handle]')) return;
      e.stopPropagation();
      e.preventDefault();
      const scale = Math.max(0.01, editorScale);
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = offsetX;
      const origY = offsetY;

      const onMove = (ev: PointerEvent) => {
        onPatch({
          behaviorOffsetX: Math.round(origX + (ev.clientX - startX) / scale),
          behaviorOffsetY: Math.round(origY + (ev.clientY - startY) / scale),
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [editorScale, isEditMode, isSelected, offsetX, offsetY, onPatch],
  );

  const handleResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!isEditMode || !isSelected || !onPatch || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const scale = Math.max(0.01, editorScale);
      const startX = e.clientX;
      const startY = e.clientY;
      const origSize = iconSize;

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        const delta = Math.max(dx, dy);
        const next = Math.round(
          Math.min(MAX_BEHAVIOR_ICON_SIZE, Math.max(MIN_BEHAVIOR_ICON_SIZE, origSize + delta)),
        );
        onPatch({ behaviorIconSize: next });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [editorScale, iconSize, isEditMode, isSelected, onPatch],
  );

  if (!isEditMode && showUrls.length === 0) return null;
  if (isEditMode && showUrls.length === 0 && !isSelected) return null;

  return (
    <div
      className="absolute z-20"
      style={{
        left: anchorLeft,
        top: anchorTop,
        width: layoutWidth,
        height: iconSize,
        pointerEvents: isEditMode && isSelected ? 'auto' : 'none',
        cursor: isEditMode && isSelected ? 'grab' : undefined,
      }}
      data-vehicle-container-behavior
      title={isEditMode ? '拖曳移動 · 右下角調整尺寸' : undefined}
      onPointerDown={handlePointerDown}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="relative h-full w-full"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: BEHAVIOR_LAYOUT_GAP,
        }}
      >
        {isEditMode && (
          <div className={EDIT_FRAME} aria-hidden />
        )}
        {showUrls.map((url, i) => (
          <div
            key={`${url}-${i}`}
            className="relative shrink-0"
            style={{ width: iconSize, height: iconSize }}
          >
            <VehicleContainedIcon
              src={url}
              boxWidth={iconSize}
              boxHeight={iconSize}
              className="drop-shadow-md"
            />
          </div>
        ))}
        {isEditMode && showUrls.length === 0 && (
          <div className="flex h-full w-full items-center justify-center text-[9px] text-violet-300/80">
            行為
          </div>
        )}
      </div>
      {isEditMode && (
        <span className="pointer-events-none absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-violet-950/90 px-1 py-px text-[8px] font-medium text-violet-200">
          行為 {iconSize}px
        </span>
      )}
      {isEditMode && isSelected && onPatch && (
        <div
          data-behavior-resize-handle
          className="absolute -bottom-1 -right-1 z-30 h-3 w-3 cursor-se-resize rounded-sm border border-violet-200 bg-violet-500 shadow"
          title="拖曳調整圖示尺寸"
          onPointerDown={handleResizePointerDown}
          onMouseDown={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}
