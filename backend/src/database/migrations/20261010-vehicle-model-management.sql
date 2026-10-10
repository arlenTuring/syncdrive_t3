-- 車輛模型管理移至圖資管理。
-- 模型仍是 vehicle_definitions；地圖用哪個模型存在 system_settings（vehicle_model.*），
-- 降級回放另存當時的模型快照。只新增欄位，不改既有資料；可重複執行。

ALTER TABLE vehicle_definitions
  ADD COLUMN IF NOT EXISTS rear_axle_from_tail_ratio double precision;

ALTER TABLE degraded_replay_sessions
  ADD COLUMN IF NOT EXISTS vehicle_model jsonb;
