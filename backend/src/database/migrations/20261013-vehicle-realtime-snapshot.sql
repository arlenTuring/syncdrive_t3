-- 載具即時清單：延伸既有一車一筆 vehicle_monitor_demo，不建立第二套快照。
-- 可重複執行；既有位置、速度、電量與示範欄位均保留。
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS map_id VARCHAR(128);
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS position_z DOUBLE PRECISION;
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS heading_rad DOUBLE PRECISION;
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS gear VARCHAR(4);

ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS telemetry_payload JSONB;
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS telemetry_derived JSONB;
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS telemetry_data_at BIGINT;
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS telemetry_received_at BIGINT;

ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS operation_payload JSONB;
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS operation_data_at BIGINT;
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS operation_received_at BIGINT;

ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS health_payload JSONB;
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS health_data_at BIGINT;
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS health_received_at BIGINT;
-- 只有 timestamp 前進的新心跳才更新；Retain／重送不得讓車輛假上線。
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS health_fresh_received_at BIGINT;

CREATE INDEX IF NOT EXISTS idx_vehicle_monitor_telemetry_at
  ON vehicle_monitor_demo (telemetry_data_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_monitor_health_fresh_at
  ON vehicle_monitor_demo (health_fresh_received_at DESC);
