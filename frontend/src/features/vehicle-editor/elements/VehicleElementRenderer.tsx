import { DEFAULT_DOOR_COLOR } from '../constants/palette';
import type { IconContentMetrics } from '../utils/fitIconBounds';
import { VehicleDoorSvg } from './VehicleDoorSvg';
import { useVehicleElementData, readDoorAlarm, readDoorOpenPercent } from '../hooks/useVehicleElementData';
import type { VehicleDefinition, VehicleElement } from '../types';
import { resolveBodyAppearance } from '../utils/resolveBodyAppearance';
import { isVehicleLightOn, shouldRenderVehicleLight } from '../utils/resolveLightVisibility';
import {
  mergeVehiclePreviewData,
  resolveVehicleTextDisplay,
} from '../utils/resolveFieldValue';
import { VehicleImageLayer } from './VehicleImageLayer';

export function VehicleElementRenderer({
  element,
  vehicle,
  isEditMode,
  onContentMetrics,
  livePayloadOnly = false,
}: {
  element: VehicleElement;
  vehicle: VehicleDefinition;
  isEditMode: boolean;
  onContentMetrics?: (metrics: IconContentMetrics | null) => void;
  /** 圖台即時載具：僅用父層傳入的 liveData，不訂閱元素綁定 */
  livePayloadOnly?: boolean;
}) {
  const { row } = useVehicleElementData(element, vehicle.previewData, { livePayloadOnly });
  /** 圖台即時載具：live 營運欄位優先於樣板 previewData */
  const data = livePayloadOnly && row
    ? {
        ...(vehicle.previewData ?? {}),
        ...row,
        ...(row.trip_code || row.badge_label
          ? {
              trip_code: row.trip_code ?? row.badge_label,
              badge_label: row.badge_label ?? row.trip_code,
            }
          : {}),
      }
    : mergeVehiclePreviewData(row, vehicle.previewData);

  if (element.type === 'body') {
    const resolved = resolveBodyAppearance(element, data);
    return (
      <VehicleImageLayer
        imageFile={resolved.imageFile}
        tintColor={resolved.tintColor}
        width={element.width}
        height={element.height}
        onContentMetrics={onContentMetrics}
      />
    );
  }

  if (element.type === 'text') {
    const text = resolveVehicleTextDisplay(data, element.valueField, isEditMode);
    return (
      <div
        className="flex h-full w-full items-center overflow-hidden"
        style={{
          justifyContent:
            element.textAlign === 'left'
              ? 'flex-start'
              : element.textAlign === 'right'
                ? 'flex-end'
                : 'center',
        }}
      >
        <span
          className="truncate leading-none"
          style={{
            fontSize: element.fontSize,
            fontWeight: element.fontWeight,
            color: element.color,
            textAlign: element.textAlign,
            width: '100%',
          }}
        >
          {text}
        </span>
      </div>
    );
  }

  if (element.type === 'light') {
    if (!shouldRenderVehicleLight(data, element.visibilityField, isEditMode)) {
      return null;
    }
    const lit = isVehicleLightOn(data, element.visibilityField);
    return (
      <div
        className="h-full w-full"
        style={{ opacity: isEditMode && element.visibilityField && !lit ? 0.35 : 1 }}
        title={
          isEditMode && element.visibilityField && !lit
            ? '開關欄位為關（檢視時隱藏）'
            : undefined
        }
      >
        <VehicleImageLayer
          imageFile={element.defaultImage}
          width={element.width}
          height={element.height}
          onContentMetrics={onContentMetrics}
        />
      </div>
    );
  }

  if (element.type === 'door') {
    const openPercent = readDoorOpenPercent(
      data,
      element.openPercentField,
      element.defaultOpenPercent,
    );
    const alarm = readDoorAlarm(data, element.alarmField);
    return (
      <VehicleDoorSvg
        widthPx={element.width}
        heightPx={element.height}
        openPercent={openPercent}
        fillColor={element.defaultColor?.trim() || DEFAULT_DOOR_COLOR}
        alarm={alarm}
        animate={!isEditMode}
      />
    );
  }

  return null;
}
