import { resolveDashboardIconUrl } from '../../dashboard/constants/iconLibrary';
import { VEHICLE_BEHAVIOR_ACTION_CATALOG } from '../../vehicle-editor/constants/behaviorActionCatalog';

/**
 * 營運協議 action_type / MQTT operation_action → 班次卡作動 catalog code。
 * 對齊數據監控班次卡進度：PLATFORM_DOCKING=進站、STATION_DEPARTURE=出站。
 */
const PROTOCOL_ACTION_TO_CATALOG_CODE: Record<string, string> = {
  PLATFORM_DOCKING: 'enter',
  STATION_ARRIVAL: 'enter',
  ENTER: 'enter',
  enter: 'enter',
  STATION_DEPARTURE: 'exit',
  EXIT: 'exit',
  exit: 'exit',
  PRE_DEPARTURE_BROADCAST: 'music',
  MUSIC: 'music',
  music: 'music',
  OPEN_DOORS: 'door_open',
  DOOR_OPEN: 'door_open',
  door_open: 'door_open',
  CLOSE_DOORS: 'door_close',
  DOOR_CLOSE: 'door_close',
  door_close: 'door_close',
  ACQUIRE_INTERLOCK: 'signal',
  SIGNAL: 'signal',
  signal: 'signal',
  ALERT: 'alert',
  ALARM: 'alert',
  EMERGENCY_BRAKE: 'alert',
  alert: 'alert',
  DISPATCH: 'dispatch',
  dispatch: 'dispatch',
  CHARGING: 'charging',
  charging: 'charging',
  WASH: 'wash',
  wash: 'wash',
  MAINTENANCE: 'maintenance',
  maintain: 'maintenance',
  maintenance: 'maintenance',
  REPAIR: 'repair',
  repair: 'repair',
  PARKING: 'parking',
  park: 'parking',
  parking: 'parking',
};

export type CatalogActionVisual = {
  code: string;
  label: string;
  iconUrl: string;
};

export function catalogCodeFromActionType(actionType: string): string | null {
  const raw = actionType.trim();
  if (!raw) return null;
  return (
    PROTOCOL_ACTION_TO_CATALOG_CODE[raw]
    ?? PROTOCOL_ACTION_TO_CATALOG_CODE[raw.toUpperCase()]
    ?? PROTOCOL_ACTION_TO_CATALOG_CODE[raw.toLowerCase()]
    ?? (VEHICLE_BEHAVIOR_ACTION_CATALOG.some((a) => a.code === raw) ? raw : null)
  );
}

export function catalogVisualForCode(code: string): CatalogActionVisual | null {
  const def = VEHICLE_BEHAVIOR_ACTION_CATALOG.find((a) => a.code === code);
  if (!def) return null;
  const iconUrl = resolveDashboardIconUrl(def.iconFile);
  if (!iconUrl) return null;
  return { code: def.code, label: def.label, iconUrl };
}

export function catalogVisualForActionType(actionType: string): CatalogActionVisual | null {
  const code = catalogCodeFromActionType(actionType);
  return code ? catalogVisualForCode(code) : null;
}
