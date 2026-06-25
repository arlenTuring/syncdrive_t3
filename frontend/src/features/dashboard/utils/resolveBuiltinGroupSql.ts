import type { CanvasElementProps } from '../types';
import {
  MAINLINE_SHIFTS_SQL,
  MAINTENANCE_SHIFTS_SQL,
  MAINLINE_FLEET_STATUS_SQL,
} from '../constants/demoSql';

/** 內建群組 SQL：名冊 bootstrap（載入時查一次）；槽位增刪由 MQTT operation/update 即時驅動 */
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

/** 正線營運 X/Y：寫庫後推送失效，非 15s 輪詢 */
export const MAINLINE_FLEET_REFRESH_INTERVAL = 0;

export function resolveBuiltinFleetSql(content: string, valueField?: string): string | undefined {
  if (valueField === 'mainline_fleet_line' || content.includes('正線營運')) {
    return MAINLINE_FLEET_STATUS_SQL;
  }
  return undefined;
}
