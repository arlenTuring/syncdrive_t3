-- 一般運行歷史（運行管理紀錄回放；降級回放也改讀這裡，不再重複寫同一份 MQTT）。
-- 只新增資料表、索引、觸發器與一個欄位；不改既有資料、不搬舊資料；可重複執行。
-- 功能上線前沒有錄製的期間不會有資料，畫面顯示「未錄製」，不拿現在的狀態或班表推算。
--
-- 回復：DROP TRIGGER ... ; DROP FUNCTION ... ; DROP TABLE vehicle_history_*;
--       ALTER TABLE degraded_replay_sessions DROP COLUMN IF EXISTS frames_source;
--       （降級紀錄若 frames_source='history'，回復後那幾筆的回放資料會讀不到，見部署說明）

CREATE TABLE IF NOT EXISTS vehicle_history_frames (
  seq bigserial PRIMARY KEY,
  stream varchar(16) NOT NULL,
  stream_key varchar(260) NOT NULL,
  vehicle_code varchar(64),
  topic varchar(200),
  order_id varchar(120),
  received_at bigint NOT NULL,
  operating_at bigint,
  clock_run varchar(120),
  vehicle_ts bigint,
  source varchar(8) NOT NULL,
  payload jsonb NOT NULL,
  derived jsonb
);
CREATE INDEX IF NOT EXISTS "IDX_VEHICLE_HISTORY_TIME" ON vehicle_history_frames (received_at, seq);
CREATE INDEX IF NOT EXISTS "IDX_VEHICLE_HISTORY_KEY_TIME" ON vehicle_history_frames (stream_key, received_at, seq);
CREATE INDEX IF NOT EXISTS "IDX_VEHICLE_HISTORY_RUN_OPERATING" ON vehicle_history_frames (clock_run, operating_at, seq);
CREATE INDEX IF NOT EXISTS "IDX_VEHICLE_HISTORY_ORDER" ON vehicle_history_frames (order_id);
-- 調查載具的逐幀、分頁、前後幀：先依車號篩選再依 (收到時間, 序號) 排序
CREATE INDEX IF NOT EXISTS "IDX_VEHICLE_HISTORY_VEHICLE_TIME" ON vehicle_history_frames (vehicle_code, received_at, seq);

CREATE TABLE IF NOT EXISTS vehicle_history_segments (
  id bigserial PRIMARY KEY,
  started_real bigint NOT NULL,
  last_alive_real bigint NOT NULL,
  ended_real bigint,
  status varchar(16) NOT NULL,
  health_keepalive_ms integer NOT NULL,
  frame_count bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vehicle_history_gaps (
  id bigserial PRIMARY KEY,
  segment_id bigint,
  from_real bigint NOT NULL,
  to_real bigint NOT NULL,
  from_operating bigint,
  to_operating bigint,
  reason varchar(24) NOT NULL,
  count integer NOT NULL DEFAULT 0,
  detail text
);
CREATE INDEX IF NOT EXISTS "IDX_VEHICLE_HISTORY_GAP_TIME" ON vehicle_history_gaps (from_real, to_real);

CREATE TABLE IF NOT EXISTS vehicle_history_stream_keys (
  stream_key varchar(260) PRIMARY KEY,
  stream varchar(16) NOT NULL,
  vehicle_code varchar(64),
  first_real bigint NOT NULL,
  last_real bigint NOT NULL
);

-- 降級紀錄的串流資料從哪裡讀：degraded＝降級自己的 degraded_replay_frames（舊紀錄）；
-- history＝一般運行歷史（本次之後，避免同一份 MQTT 寫兩次）
ALTER TABLE degraded_replay_sessions
  ADD COLUMN IF NOT EXISTS frames_source varchar(16) NOT NULL DEFAULT 'degraded';

-- ── 訂單變更歷史 ────────────────────────────────────────────────────
-- 只在回放用得到的欄位變了才記一筆（每秒變動的 current_leg 不在內，那在 operation 原始訊息裡）。
CREATE OR REPLACE FUNCTION vehicle_history_order_snapshot(o operation_orders) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'order_id', o.order_id,
    'trip_code', o.trip_code,
    'vehicle_code', o.vehicle_code,
    'status', o.status::text,
    'line_kind', o.line_kind,
    'route_id', o.route_id,
    'priority_level', o.priority_level,
    'planned_start', o.planned_start,
    'planned_end', o.planned_end,
    'completed_at', o.completed_at,
    'created_at', o.created_at,
    'delay_minutes', o.delay_minutes,
    'stations', o.payload -> 'stations',
    'origin', o.payload -> 'origin',
    'destination', o.payload -> 'destination',
    'route_name', o.payload -> 'route_name',
    'vehicle_phase', o.payload -> 'vehicle_phase',
    'actual_started_at', o.payload -> 'actual_started_at',
    'op_started_at', o.payload -> 'op_started_at',
    'op_completed_at', o.payload -> 'op_completed_at',
    'vehicle_progress_at', o.payload -> 'vehicle_progress_at',
    'cancel_requested_at', o.payload -> 'cancel_requested_at',
    'closed_reason', o.payload -> 'closed_reason',
    'vehicle_fault', o.payload -> 'vehicle_fault',
    'operating_day', o.payload -> 'operating_day',
    'plan_shift_id', o.payload -> 'plan_shift_id',
    'plan_digest', o.payload -> 'plan_digest',
    'plan_trip_code', o.payload -> 'plan_trip_code',
    'plan_block_id', o.payload -> 'plan_block_id',
    'plan_run_id', o.payload -> 'plan_run_id',
    'transition_purpose', o.payload -> 'transition_purpose',
    'transition_facility', o.payload -> 'transition_facility'
  ))
$$;

CREATE OR REPLACE FUNCTION vehicle_history_record_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  snapshot jsonb := vehicle_history_order_snapshot(NEW);
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  key text := 'order|' || NEW.order_id;
BEGIN
  IF TG_OP = 'UPDATE' AND vehicle_history_order_snapshot(OLD) = snapshot THEN
    RETURN NEW;
  END IF;
  INSERT INTO vehicle_history_frames (stream, stream_key, vehicle_code, order_id, received_at, source, payload)
    VALUES ('order', key, NEW.vehicle_code, NEW.order_id, now_ms, 'db',
            snapshot || jsonb_build_object('change', lower(TG_OP)));
  INSERT INTO vehicle_history_stream_keys (stream_key, stream, vehicle_code, first_real, last_real)
    VALUES (key, 'order', NEW.vehicle_code, now_ms, now_ms)
    ON CONFLICT (stream_key) DO UPDATE SET last_real = EXCLUDED.last_real, vehicle_code = EXCLUDED.vehicle_code;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vehicle_history_order_change ON operation_orders;
CREATE TRIGGER vehicle_history_order_change
  AFTER INSERT OR UPDATE ON operation_orders
  FOR EACH ROW EXECUTE FUNCTION vehicle_history_record_order();

-- ── 站點動作變更歷史 ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION vehicle_history_record_order_action() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  snapshot jsonb := jsonb_strip_nulls(jsonb_build_object(
    'action_id', NEW.action_id,
    'order_id', NEW.order_id,
    'station_id', NEW.station_id,
    'action_type', NEW.action_type,
    'action_status', NEW.action_status::text,
    'node_id', NEW.node_id,
    'trigger_offset_m', NEW.trigger_offset_m,
    'actual_start_time', NEW.actual_start_time,
    'actual_end_time', NEW.actual_end_time,
    'note', NEW.note));
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  key text := 'order_action|' || NEW.action_id;
  vehicle text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.action_status IS NOT DISTINCT FROM NEW.action_status
     AND OLD.actual_start_time IS NOT DISTINCT FROM NEW.actual_start_time
     AND OLD.actual_end_time IS NOT DISTINCT FROM NEW.actual_end_time
     AND OLD.note IS NOT DISTINCT FROM NEW.note THEN
    RETURN NEW;
  END IF;
  SELECT vehicle_code INTO vehicle FROM operation_orders WHERE order_id = NEW.order_id;
  INSERT INTO vehicle_history_frames (stream, stream_key, vehicle_code, order_id, received_at, source, payload)
    VALUES ('order_action', key, vehicle, NEW.order_id, now_ms, 'db',
            snapshot || jsonb_build_object('change', lower(TG_OP)));
  INSERT INTO vehicle_history_stream_keys (stream_key, stream, vehicle_code, first_real, last_real)
    VALUES (key, 'order_action', vehicle, now_ms, now_ms)
    ON CONFLICT (stream_key) DO UPDATE SET last_real = EXCLUDED.last_real;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vehicle_history_order_action_change ON order_action_states;
CREATE TRIGGER vehicle_history_order_action_change
  AFTER INSERT OR UPDATE ON order_action_states
  FOR EACH ROW EXECUTE FUNCTION vehicle_history_record_order_action();
