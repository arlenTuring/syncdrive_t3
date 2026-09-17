import type { CanvasElementProps } from '../types';
import {
  MAINLINE_SHIFTS_SQL,
  MAINTENANCE_SHIFTS_SQL,
  MAINLINE_FLEET_STATUS_SQL,
} from '../constants/demoSql';

/**
 * 名冊多久重查一次。
 *
 * 原本是 0——只在載入時查一次，之後全靠 MQTT operation/update 推。問題是車端只報
 * 單號、目標站與剩餘秒數，不報這一班停哪些站；排班引擎每隔一兩分鐘就換一班，名冊
 * 不重查就會停在上一班的站序。十秒重查一次，SQL 的落後就限制在十秒內。
 */
export const SHIFT_ROSTER_REFRESH_INTERVAL = 10_000;

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
