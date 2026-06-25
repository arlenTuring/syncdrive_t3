import type { CanvasElementProps } from '../types';
import {
  MAINLINE_SHIFTS_SQL,
  MAINTENANCE_SHIFTS_SQL,
  MAINLINE_FLEET_STATUS_SQL,
} from '../constants/demoSql';

/** 內建群組 SQL：槽位名冊（低頻）；即時欄位由 MQTT operation/update */
export const SHIFT_ROSTER_REFRESH_INTERVAL = 0;

export function resolveBuiltinGroupSql(element: CanvasElementProps): {
  sqlQuery?: string;
  refreshInterval?: number;
} {
  if (!element.isGroup) return { sqlQuery: element.sqlQuery, refreshInterval: element.refreshInterval };
  if (element.label === '正線班次') {
    return { sqlQuery: MAINLINE_SHIFTS_SQL, refreshInterval: SHIFT_ROSTER_REFRESH_INTERVAL };
  }
  if (element.label === '整備班表') {
    return { sqlQuery: MAINTENANCE_SHIFTS_SQL, refreshInterval: SHIFT_ROSTER_REFRESH_INTERVAL };
  }
  return { sqlQuery: element.sqlQuery, refreshInterval: element.refreshInterval };
}

/** 正線營運 X/Y：Y 為當前正線名冊訂單數，非寫死場上容量（模擬器 4 台為示範設定） */
export const MAINLINE_FLEET_REFRESH_INTERVAL = 15;

export function resolveBuiltinFleetSql(content: string, valueField?: string): string | undefined {
  if (valueField === 'mainline_fleet_line' || content.includes('正線營運')) {
    return MAINLINE_FLEET_STATUS_SQL;
  }
  return undefined;
}
