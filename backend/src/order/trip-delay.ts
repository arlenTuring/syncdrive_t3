import { DELAY_TOLERANCE_MS } from '../operating-day/operating-day';

/** 系統基礎設定「班車延誤判定」的預設秒數 */
export const DEFAULT_TRIP_DELAY_TOLERANCE_SECONDS = DELAY_TOLERANCE_MS / 1000;

/**
 * 班次延誤的唯一規則：晚於計畫結束超過允許秒數（系統基礎設定）算延誤，時間一律用營運時間。
 * 回傳晚了幾個整分鐘，最少 1——0 代表準點，允許秒數設得比一分鐘短時也要標得出延誤。
 *
 * 判定結果只寫在 operation_orders.delay_minutes：還沒完成的由 TripDelayMonitorService 持續更新，
 * 完成時由 OrderService 定案。班次統計、班次運行紀錄、儀表板、事件管理都讀這個欄位，不各自比時間；
 * 寫入後的畫面更新走 emitOrderLifecycle。車輛 ETA 的 delay_state 是到站預測，不是這個判定。
 */
export function tripDelayMinutes(
  plannedEnd: unknown,
  operatingAt: number,
  toleranceSeconds = DEFAULT_TRIP_DELAY_TOLERANCE_SECONDS,
): number {
  const end = Number(plannedEnd);
  const lateMs = operatingAt - end;
  if (!Number.isFinite(end) || end <= 0 || lateMs <= 0 || lateMs < toleranceSeconds * 1000) return 0;
  return Math.max(1, Math.floor(lateMs / 60_000));
}
