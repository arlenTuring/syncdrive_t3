-- 降級回放：保存範圍、當時地圖、期間收到的資料。
-- 只新增資料表，不改既有表、不搬舊資料；可重複執行。
-- 舊的降級紀錄沒有對應的 session，介面顯示「無歷史資料」，不拿現在的資料補。

CREATE TABLE IF NOT EXISTS degraded_replay_sessions (
  execution_id varchar(36) PRIMARY KEY,
  status varchar(16) NOT NULL,
  map_id varchar(200),
  map_hash varchar(64),
  map_version varchar(80),
  map_display_name varchar(200),
  clock_run varchar(120),
  started_real bigint NOT NULL,
  started_operating bigint NOT NULL,
  ended_real bigint,
  ended_operating bigint,
  initial_captured boolean NOT NULL DEFAULT false,
  frame_count bigint NOT NULL DEFAULT 0,
  dropped_count bigint NOT NULL DEFAULT 0,
  gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error text,
  last_written_real bigint,
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS degraded_replay_maps (
  map_hash varchar(64) PRIMARY KEY,
  map_id varchar(200) NOT NULL,
  map_version varchar(80),
  document jsonb NOT NULL,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS degraded_replay_frames (
  seq bigserial PRIMARY KEY,
  execution_id varchar(36) NOT NULL,
  stream varchar(16) NOT NULL,
  kind varchar(8) NOT NULL,
  vehicle_code varchar(64),
  topic varchar(200),
  received_at bigint NOT NULL,
  operating_at bigint NOT NULL,
  vehicle_ts bigint,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_DEGRADED_REPLAY_FRAME_TIME"
  ON degraded_replay_frames (execution_id, operating_at, seq);

-- 歷史列表依開始時間新到舊
CREATE INDEX IF NOT EXISTS "IDX_DEGRADED_EXECUTION_STARTED"
  ON degraded_operation_executions (started_at_operating, created_at);
