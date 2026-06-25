-- 正線／整備班次欄位（可重複執行）
-- 班次／整備任務列改由 DEMO-ORD 訂單 + 模擬器 syncVehicleTrackSql 同步，不再寫入 DEMO-ML/DEMO-MT 靜態列

ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS line_kind varchar(32);
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS delay_minutes int DEFAULT 0;
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS next_station varchar(32);
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS eta_remain varchar(32);
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS planned_start bigint;
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS planned_end bigint;
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS maint_type_label varchar(32);
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS maint_type_bg varchar(32);
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS maint_type_color varchar(32);
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS maint_station varchar(32);
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS icon_bg_color varchar(32);
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS progress_marker_icon varchar(32);

DELETE FROM operation_orders WHERE order_id LIKE 'DEMO-ML-%' OR order_id LIKE 'DEMO-MT-%';

WITH mainline AS (
  SELECT
    order_id,
    LEFT(trip_code, 1) AS direction,
    (SUBSTRING(trip_code, 2, 2)::int * 60 + SUBSTRING(trip_code, 4, 2)::int) AS start_minutes
  FROM operation_orders
  WHERE order_id LIKE 'DEMO-ORD-%'
    AND line_kind = 'MAINLINE'
    AND trip_code ~ '^[DU][0-9]{4}$'
    AND SUBSTRING(trip_code, 2, 2)::int BETWEEN 0 AND 23
    AND SUBSTRING(trip_code, 4, 2)::int BETWEEN 0 AND 59
)
UPDATE operation_orders AS o
SET planned_start = (
      EXTRACT(EPOCH FROM (
        date_trunc('day', NOW()) + (m.start_minutes * INTERVAL '1 minute')
      )) * 1000
    )::bigint,
    planned_end = (
      EXTRACT(EPOCH FROM (
        date_trunc('day', NOW()) + ((m.start_minutes + 6) * INTERVAL '1 minute')
      )) * 1000
    )::bigint,
    created_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint,
    eta_remain = COALESCE(o.eta_remain, '00:06'),
    next_station = COALESCE(NULLIF(o.next_station, ''), NULLIF(o.payload->>'segment_label', '')),
    payload = COALESCE(o.payload, '{}'::jsonb) || jsonb_build_object(
      'route_origin', CASE WHEN m.direction = 'U' THEN 'S2W' ELSE 'N2W' END,
      'route_mid', 'T3',
      'route_destination', CASE WHEN m.direction = 'U' THEN 'N2W' ELSE 'S2W' END,
      'st_a', CASE WHEN m.direction = 'U' THEN 'S2W' ELSE 'N2W' END,
      'st_b', 'T3',
      'st_c', CASE WHEN m.direction = 'U' THEN 'N2W' ELSE 'S2W' END,
      'direction_label', CASE WHEN m.direction = 'U' THEN '上行' ELSE '下行' END,
      'segment_index', 0,
      'segment_remain_pct', 100
    )
FROM mainline AS m
WHERE o.order_id = m.order_id;
