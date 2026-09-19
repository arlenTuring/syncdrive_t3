-- 將示範列 created_at 刷新為現在（跨日後儀表板「今日」篩選仍可命中）
-- 可重複執行

UPDATE operation_orders
SET created_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
WHERE order_id LIKE 'DEMO-%' OR vehicle_code LIKE 'PMS%';

WITH ranked AS (
  SELECT event_id, ROW_NUMBER() OVER (ORDER BY event_id) AS rn
  FROM security_event_logs
  WHERE event_id LIKE 'DEMO-EVT-%'
)
UPDATE security_event_logs AS s
SET created_at = (EXTRACT(EPOCH FROM NOW() - (r.rn - 1) * INTERVAL '25 minutes') * 1000)::bigint
FROM ranked AS r
WHERE s.event_id = r.event_id;
