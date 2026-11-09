-- 車輛輪替：補救流程持續監看與里程帳。可重複執行。
--
-- recovery_state：輪替中止（status = 'aborted'）只代表「不對調」的決定，補救任務
--   （補發被換車的任務、接替車開回格位、收回發錯車的單）是否做完另外記：
--   none＝沒有補救；running＝還在進行，監看程序重啟後照這個欄位繼續；
--   done＝補救任務全部完成；incomplete＝有補救任務最後沒做完（原因寫在 history）。
-- history：每一次嘗試、失敗、取消、恢復與最終結果，依時間附加，結案時不清除。
ALTER TABLE vehicle_rotation_items ADD COLUMN IF NOT EXISTS recovery_state varchar(16) NOT NULL DEFAULT 'none';
ALTER TABLE vehicle_rotation_items ADD COLUMN IF NOT EXISTS history jsonb NOT NULL DEFAULT '[]';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_rotation_items_recovery_state_check') THEN
    ALTER TABLE vehicle_rotation_items ADD CONSTRAINT vehicle_rotation_items_recovery_state_check
      CHECK (recovery_state IN ('none', 'running', 'done', 'incomplete'));
  END IF;
END $$;
-- 舊資料：已中止的項目照舊結案，不重跑補救
CREATE INDEX IF NOT EXISTS idx_vehicle_rotation_items_open
  ON vehicle_rotation_items (status, recovery_state);

-- 里程帳：每張完成的訂單只算一次。用訂單編號去重，同時有兩個呼叫端在算、或同一個完成時刻的單晚到，
-- 都不會重複或漏算。
CREATE TABLE IF NOT EXISTS vehicle_rotation_mileage_ledger (
  order_id varchar(128) PRIMARY KEY,
  vehicle_code varchar(32) NOT NULL,
  km numeric(12,3) NOT NULL,
  completed_at bigint NOT NULL,
  counted_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vehicle_rotation_mileage_ledger_vehicle
  ON vehicle_rotation_mileage_ledger (vehicle_code, completed_at);
-- 改用帳之前已經算進 driven_km 的單（completed_at 不晚於 counted_until）登記成已算，避免回頭補算時重複計入
INSERT INTO vehicle_rotation_mileage_ledger (order_id, vehicle_code, km, completed_at, counted_at)
SELECT o.order_id, o.vehicle_code,
       COALESCE((SELECT SUM(v::numeric) FROM jsonb_each_text(o.payload->'leg_distance_max_m') e(k, v)), 0) / 1000,
       o.completed_at::bigint, 0
FROM operation_orders o
JOIN vehicle_rotation_vehicles c ON c.vehicle_code = o.vehicle_code
WHERE o.status = 'END' AND o.completed_at IS NOT NULL AND o.completed_at::bigint <= c.counted_until
ON CONFLICT (order_id) DO NOTHING;

-- 輪替用計畫編號找重播的單（模擬器的單把原計畫編號放在 payload.plan_order_id）
CREATE INDEX IF NOT EXISTS idx_operation_orders_plan_order_id
  ON operation_orders ((payload->>'plan_order_id'));
