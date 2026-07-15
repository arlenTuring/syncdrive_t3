/**
 * 圖台車輛 MQTT 播放緩衝（FMS 圖台平滑設定）
 *
 * 行為：先存滿 N 幀 telemetry 再啟用 lerp；顯示始終貼最新幀，僅在相鄰兩幀間插值（不回跳第 1 幀）。
 * 調整此常數即可改暖機深度（例如 5 幀、10 幀）。
 *
 * 暖機時間（1x）≈ MAP_VEHICLE_PLAYOUT_FRAME_COUNT × MAP_VEHICLE_TELEMETRY_INTERVAL_MS
 * 須與後端 `TELEMETRY_SIM_INTERVAL_MS`（vtms-shift-demo-simulator.js）一致。
 */
export const MAP_VEHICLE_PLAYOUT_FRAME_COUNT = 3;

/** 模擬 telemetry 場域取樣間隔（ms）；與後端 TELEMETRY_SIM_INTERVAL_MS 對齊 */
export const MAP_VEHICLE_TELEMETRY_INTERVAL_MS = 200;

/** 1x 倍速下，存滿緩衝幀所需的場域時間（ms） */
export const MAP_VEHICLE_PLAYOUT_WARMUP_MS =
  MAP_VEHICLE_PLAYOUT_FRAME_COUNT * MAP_VEHICLE_TELEMETRY_INTERVAL_MS;
