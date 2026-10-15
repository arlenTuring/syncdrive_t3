/** 回放畫面共用的中文標籤 */
export const GAP_REASON: Record<string, string> = {
  write_failed: "寫入失敗",
  backpressure: "資料量過大，暫停錄製",
  backend_restart: "後端重啟／停止",
  clock_run_changed: "營運時鐘換了另一輪",
  clock_unsynced: "營運時鐘未同步",
  frame_limit: "超過保存上限",
  not_recorded: "未錄製",
};

export const STREAM_LABEL: Record<string, string> = {
  telemetry: "遙測",
  operation: "營運狀態",
  health: "健康",
  event: "事件",
  command_ack: "指令回應",
  facility: "場站設施",
  order: "訂單",
  order_route: "訂單路線",
  order_action: "站點動作",
  map: "地圖版本",
  model: "車輛模型",
  clock: "營運時鐘",
};

export const SOURCE_LABEL: Record<string, string> = {
  mqtt: "MQTT 收到",
  db: "資料庫變更",
  system: "系統記錄",
};
