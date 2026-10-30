-- 班次運行紀錄清單（order/list）用的兩個索引。可重跑；不改資料、不回填 payload。
--
-- IDX_ORDER_LIST_SORT：清單排序 planned_start DESC NULLS LAST, created_at DESC, order_id DESC
--   （order_id 是同時刻的穩定定序）。LIMIT 20 照索引順序讀到 20 筆就停，不再整表排序。
-- IDX_ORDER_LIST_KIND：精確總數。業務分類拆成「line_kind 直接是分類」與「舊資料照完整 CASE」
--   兩段分開數（order-business-kind.ts orderBusinessKindFilterSql），前一段加上常用的狀態、
--   時間、車號篩選都只讀索引，不必逐列讀 payload。
--
-- 2026-10-29 本機同資料 TEMP 複本實測（約 10,180 列）：預設分頁總數 2,356 → 47 blocks、
-- 約 20 → 1.2ms；前 20 筆 15 blocks。兩個索引合計約 1.1 MB。
--
-- deploy/migrate.sh 以單一 transaction 執行，不能用 CONCURRENTLY；表小（約一萬列），建索引持有
-- SHARE 鎖的時間在數十毫秒內，期間訂單寫入會等待、不會失敗。表若已大到不能接受這段鎖，改在
-- 維護窗另外以 CREATE INDEX CONCURRENTLY 建同名索引，這支會因 IF NOT EXISTS 略過。
-- 回復：DROP INDEX IF EXISTS "IDX_ORDER_LIST_SORT"; DROP INDEX IF EXISTS "IDX_ORDER_LIST_KIND";
CREATE INDEX IF NOT EXISTS "IDX_ORDER_LIST_SORT"
  ON operation_orders (planned_start DESC NULLS LAST, created_at DESC, order_id DESC);

CREATE INDEX IF NOT EXISTS "IDX_ORDER_LIST_KIND"
  ON operation_orders (line_kind, status, planned_start, vehicle_code);
