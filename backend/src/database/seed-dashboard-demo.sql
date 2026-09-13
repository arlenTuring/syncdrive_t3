-- SyncDrive 總控大屏範例：11 台 PMS 車輛 + 調度訂單（v0.0.5 場域範圍軌道）
-- 供儀表板畫布群組 SQL Repeater 使用

INSERT INTO vehicles (vehicle_code, display_name, is_active, created_at, updated_at)
VALUES
  ('PMS-01', 'PMS-01', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS-02', 'PMS-02', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS-03', 'PMS-03', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS-04', 'PMS-04', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS-05', 'PMS-05', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS-06', 'PMS-06', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS-07', 'PMS-07', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS-08', 'PMS-08', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS-09', 'PMS-09', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS-10', 'PMS-10', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint),
  ('PMS-11', 'PMS-11', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint)
ON CONFLICT (vehicle_code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  is_active = true,
  updated_at = EXCLUDED.updated_at;

ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS line_kind varchar(32);

-- 訂單改由 REST 成立 + MQTT 增量更新；啟動時清除舊示範單（含歷史 -R 後綴）
DELETE FROM order_action_states
WHERE order_id IN (
  SELECT order_id FROM operation_orders
  WHERE vehicle_code LIKE 'PMS-%' OR order_id ~ '-R[0-9]+$'
);
DELETE FROM order_events
WHERE order_id IN (
  SELECT order_id FROM operation_orders
  WHERE vehicle_code LIKE 'PMS-%' OR order_id ~ '-R[0-9]+$'
);
DELETE FROM operation_orders
WHERE vehicle_code LIKE 'PMS-%' OR order_id ~ '-R[0-9]+$';
