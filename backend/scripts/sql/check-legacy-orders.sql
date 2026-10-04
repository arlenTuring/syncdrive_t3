-- 舊訂單資料檢查（唯讀）。對應整合分支 integration/order-lifecycle-2026-10-05 的規則調整：
-- 車次代號不再決定分類／開始／計畫時刻、MQTT 故障不再替車端結案、模擬執行追蹤改用 plan_* 欄位。
--
-- 只有 SELECT；開頭把整個連線設成唯讀，就算誤貼 UPDATE 也會被資料庫拒絕。
-- 用法見 document/維運/舊訂單資料檢查與升級-2026-10-05.md。

SET default_transaction_read_only = on;

-- 1. 業務分類不明的單（line_kind 空白，payload 也沒有 kind／task_type）。
--    新版班次運行紀錄的兩個分頁與班次卡都不列；舊版會靠 D/U 代號把其中一部分擠進正線分頁。
SELECT 'unclassified' AS check_name,
       status,
       (trip_code ~ '^[DU][0-9]{4}$') AS du_trip_code,
       COUNT(*) AS orders,
       MIN(order_id) AS sample_order_id
FROM operation_orders
WHERE COALESCE(line_kind, '') = ''
  AND COALESCE(payload->>'kind', '') = ''
  AND COALESCE(payload->>'task_type', '') = ''
  AND COALESCE(payload->>'maintenance_task_type', '') = ''
GROUP BY status, du_trip_code
ORDER BY status, du_trip_code;

-- 2. 沒有計畫發車／結束時刻的單。新版不從 D/U 代號推時刻，畫面會顯示「—」。
--    has_payload_planned：payload 裡有調度引擎記下的 planned_depart_at，可以照它補（見升級說明）。
SELECT 'missing_planned_time' AS check_name,
       status,
       (trip_code ~ '^[DU][0-9]{4}$') AS du_trip_code,
       (payload ? 'planned_depart_at') AS has_payload_planned,
       COUNT(*) AS orders,
       MIN(order_id) AS sample_order_id
FROM operation_orders
WHERE planned_start IS NULL OR planned_end IS NULL
GROUP BY status, du_trip_code, has_payload_planned
ORDER BY status;

-- 3. 待發中、但車端已回報行駛／停靠的單。舊版 D/U 代號的單會被 MQTT 直接改成 PROCESSING，
--    新版只認車端 REST 回報開始；這些單要等車端呼叫 updateOrderProgress?status=PROCESSING。
SELECT 'pending_but_vehicle_moving' AS check_name,
       vehicle_code,
       COUNT(*) AS orders,
       MIN(order_id) AS sample_order_id
FROM operation_orders
WHERE status = 'PENDING'
  AND UPPER(COALESCE(payload->>'vehicle_phase', '')) IN ('TRANSITING', 'RUNNING', 'DWELLING', 'DOCKING')
GROUP BY vehicle_code
ORDER BY vehicle_code;

-- 4. 未結束、沒有來源標記的正線 D/U 單。舊版後端示範會依代號把這類單結束；新版只結束
--    payload.source='backend_demo' 的單，這些不會再被自動結束。
SELECT 'open_unsourced_du_mainline' AS check_name,
       status,
       COUNT(*) AS orders,
       MIN(order_id) AS sample_order_id
FROM operation_orders
WHERE status IN ('PENDING', 'PROCESSING')
  AND line_kind = 'MAINLINE'
  AND trip_code ~ '^[DU][0-9]{4}$'
  AND COALESCE(payload->>'source', '') = ''
GROUP BY status;

-- 5. 舊規則由 MQTT／嚴重事件直接結案成 FAULTED 的單（沒有車端 REST 結案紀錄）。
--    只供了解：新版不會再這樣結案，舊資料不需要改。
SELECT 'faulted_by_mqtt_rule' AS check_name,
       payload->>'fault_reason' AS fault_reason,
       COUNT(*) AS orders,
       MIN(order_id) AS sample_order_id
FROM operation_orders
WHERE status = 'FAULTED'
  AND payload ? 'fault_reason'
  AND NOT (payload ? 'vehicle_progress_at')
GROUP BY fault_reason
ORDER BY orders DESC;

-- 6. 模擬器重播單的追蹤欄位。沒有 plan_run_total 的舊單，追蹤 API 回 plan_size_unknown（不宣稱完成）；
--    line_kind='TEST' 的舊重播單可用 backend/scripts/reclassify-plan-replay-orders.js 預覽修正。
SELECT 'plan_replay_tracking' AS check_name,
       (payload ? 'plan_run_total') AS has_run_total,
       line_kind,
       COUNT(*) AS orders,
       COUNT(DISTINCT payload->>'plan_run_id') AS runs,
       COUNT(*) FILTER (WHERE status IN ('PENDING', 'PROCESSING')) AS open_orders
FROM operation_orders
WHERE payload->>'source' = 'plan_replay'
GROUP BY has_run_total, line_kind
ORDER BY has_run_total, line_kind;

-- 7. 目前「車輛故障，訂單結案待確認」的單（新規則上線後才會出現；應該在車端 REST 結案後消失）。
SELECT 'vehicle_fault_pending' AS check_name,
       vehicle_code,
       order_id,
       status,
       payload->'vehicle_fault' AS vehicle_fault
FROM operation_orders
WHERE status IN ('PENDING', 'PROCESSING')
  AND (COALESCE(payload->'vehicle_fault', 'null'::jsonb) <> 'null'::jsonb
       OR UPPER(COALESCE(payload->>'vehicle_phase', '')) = 'FAULTED')
ORDER BY vehicle_code;
