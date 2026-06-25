import { useMemo } from 'react';
import { VehicleContainedIcon } from '../../vehicle-editor/elements/VehicleContainedIcon';
import type { RouteActionIconRule } from '../types';
import {
  BEHAVIOR_LAYOUT_GAP,
  behaviorIconsLayoutWidth,
  resolveVehicleContainerBehaviorIconUrls,
} from '../utils/resolveVehicleContainerBehaviorIcons';

export interface MapVehicleBehaviorConfig {
  actionIconRules?: RouteActionIconRule[];
  behaviorOffsetX?: number;
  behaviorOffsetY?: number;
  behaviorIconSize?: number;
}

/** 圖台即時載具：依 MQTT payload 顯示作動行為圖示（樣板規則 × 各車資料；空行為不顯示） */
export function MapVehicleBehaviorOverlay({
  config,
  vehicleCenterX,
  vehicleCenterY,
  liveData,
}: {
  config: MapVehicleBehaviorConfig;
  vehicleCenterX: number;
  vehicleCenterY: number;
  liveData: Record<string, unknown>;
}) {
  const iconSize = config.behaviorIconSize ?? 20;
  const offsetX = config.behaviorOffsetX ?? 0;
  const offsetY = config.behaviorOffsetY ?? -28;
  const rules = config.actionIconRules;

  const showUrls = useMemo(
    () => resolveVehicleContainerBehaviorIconUrls(rules, {}, null, liveData),
    [rules, liveData],
  );

  if (showUrls.length === 0) return null;

  const layoutWidth = behaviorIconsLayoutWidth(showUrls.length, iconSize);

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        left: vehicleCenterX + offsetX - layoutWidth / 2,
        top: vehicleCenterY + offsetY - iconSize / 2,
        width: layoutWidth,
        height: iconSize,
      }}
      aria-hidden
    >
      <div
        className="relative flex h-full w-full items-center"
        style={{ gap: BEHAVIOR_LAYOUT_GAP }}
      >
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
      </div>
    </div>
  );
}
