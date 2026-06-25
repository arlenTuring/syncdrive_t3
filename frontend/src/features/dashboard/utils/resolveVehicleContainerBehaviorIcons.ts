import type { RouteActionIconRule } from '../types';
import { resolveDashboardIconUrl } from '../constants/iconLibrary';
import {
  readOperationActions,
  resolveBehaviorIconUrl,
} from '../../vehicle-editor/utils/resolveBehaviorActions';

const BEHAVIOR_LAYOUT_GAP = 4;

export function resolveBehaviorRulePreviewUrls(
  rules: RouteActionIconRule[] | undefined,
): string[] {
  if (!rules?.length) return [];
  return rules
    .filter((r) => r.iconFile?.trim())
    .map((r) => resolveDashboardIconUrl(r.iconFile))
    .filter((url): url is string => Boolean(url));
}

/** 圖台／載具容器允許顯示的即時作動（號誌僅來自 MQTT 停等狀態） */
const LIVE_VEHICLE_BEHAVIOR_CODES = new Set([
  'door_open',
  'door_close',
  'dispatch',
  'signal',
]);

function filterLiveVehicleBehaviors(actions: string[]): string[] {
  return actions.filter((code) => LIVE_VEHICLE_BEHAVIOR_CODES.has(code));
}

/** 依 MQTT／群組變數／SQL 解析目前作用中的作動圖示 URL（可多個，由左至右） */
export function resolveVehicleContainerBehaviorIconUrls(
  rules: RouteActionIconRule[] | undefined,
  variables: Record<string, unknown>,
  sqlRow: Record<string, unknown> | null,
  mqttPayload: Record<string, unknown> | null,
): string[] {
  // 有 MQTT 時僅信任即時 payload，避免 SQL 假資料（如輪播 signal）蓋過或殘留
  const actions = mqttPayload
    ? filterLiveVehicleBehaviors(readOperationActions(mqttPayload))
    : filterLiveVehicleBehaviors(
        readOperationActions({
          ...(sqlRow ?? {}),
          ...variables,
        }),
      );
  if (actions.length === 0) return [];

  return actions
    .map((code) => resolveBehaviorIconUrl(rules, code))
    .filter((url): url is string => Boolean(url));
}

export function behaviorIconsLayoutWidth(iconCount: number, iconSize: number): number {
  if (iconCount <= 0) return iconSize;
  return iconCount * iconSize + Math.max(0, iconCount - 1) * BEHAVIOR_LAYOUT_GAP;
}

export { BEHAVIOR_LAYOUT_GAP };
