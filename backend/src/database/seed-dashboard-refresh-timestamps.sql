-- 將示範列 created_at 刷新為現在（跨日後儀表板「今日」篩選仍可命中）
-- 可重複執行
-- 只動 DEMO- 示範單；PMS 車隊的調度／模擬訂單是真實資料，不可覆寫 created_at
-- （舊條件 OR vehicle_code LIKE 'PMS%' 每次開機會改寫並鎖住上萬筆真實訂單）

UPDATE operation_orders
SET created_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
WHERE order_id LIKE 'DEMO-%';

WITH ranked AS (
  SELECT event_id, ROW_NUMBER() OVER (ORDER BY event_id) AS rn
  FROM security_event_logs
  WHERE event_id LIKE 'DEMO-EVT-%'
)
UPDATE security_event_logs AS s
SET created_at = (EXTRACT(EPOCH FROM NOW() - (r.rn - 1) * INTERVAL '25 minutes') * 1000)::bigint
FROM ranked AS r
WHERE s.event_id = r.event_id;
