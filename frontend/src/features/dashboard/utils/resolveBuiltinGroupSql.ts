import type { CanvasElementProps } from '../types';

/**
 * 名冊多久重查一次。
 *
 * 原本是 0——只在載入時查一次，之後全靠 MQTT operation/update 推。問題是車端只報
 * 單號、目標站與剩餘秒數，不報這一班停哪些站；排班引擎每隔一兩分鐘就換一班，名冊
 * 不重查就會停在上一班的站序。十秒重查一次，SQL 的落後就限制在十秒內。
 */
// refreshInterval 的單位是秒；10_000 會變成 2 小時 46 分，班次切換後卡片自然不更新。
export const SHIFT_ROSTER_REFRESH_INTERVAL = 10;

/**
 * 群組實際執行的查詢＝群組自己存的綁定。
 *
 * 這裡原本依群組名稱（正線班次／整備班表／車輛狀態）把查詢換成程式裡寫死的那一份，
 * 屬性面板上看到的 SQL 跟實際跑的不是同一份，使用者改了也沒用。現在一律照存的跑；
 * 舊版查詢由載入時的 patchDashboardRuntimeFixes 一次升級並存回綁定，面板看得到。
 */
export function resolveBuiltinGroupSql(element: CanvasElementProps): {
  sqlQuery?: string;
  refreshInterval?: number;
} {
  return { sqlQuery: element.sqlQuery, refreshInterval: element.refreshInterval };
}

/** 正線營運 X/Y：寫庫後推送失效，非 15s 輪詢 */
export const MAINLINE_FLEET_REFRESH_INTERVAL = 0;
