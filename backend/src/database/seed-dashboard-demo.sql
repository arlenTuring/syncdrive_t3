-- SyncDrive 總控大屏範例：11 台 PMS 車輛 + 調度訂單（v0.0.5 場域範圍軌道）
-- 供儀表板畫布群組 SQL Repeater 使用

INSERT INTO vehicles (vehicle_code, display_name, is_active, created_at, updated_at)
VALUES
  ('PMS01', 'PMS01', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS02', 'PMS02', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS03', 'PMS03', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS04', 'PMS04', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS05', 'PMS05', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS06', 'PMS06', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS07', 'PMS07', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS08', 'PMS08', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS09', 'PMS09', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS10', 'PMS10', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS11', 'PMS11', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint)
ON CONFLICT (vehicle_code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  is_active = true,
  updated_at = EXCLUDED.updated_at;

ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS line_kind varchar(32);

-- 訂單改由 REST 成立 + MQTT 增量更新；啟動時清除舊示範單（含歷史 -R 後綴）
DELETE FROM order_action_states
WHERE order_id IN (
  SELECT order_id FROM operation_orders
  WHERE vehicle_code LIKE 'PMS%' OR order_id ~ '-R[0-9]+$'
);
DELETE FROM order_events
WHERE order_id IN (
  SELECT order_id FROM operation_orders
  WHERE vehicle_code LIKE 'PMS%' OR order_id ~ '-R[0-9]+$'
);
DELETE FROM operation_orders
WHERE vehicle_code LIKE 'PMS%' OR order_id ~ '-R[0-9]+$';
