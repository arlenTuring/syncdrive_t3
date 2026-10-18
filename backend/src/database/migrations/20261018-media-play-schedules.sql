-- 媒體排程設定（預約播放／定時播放）。只新增資料表，不改舊的事件觸發排程 media_schedules；可重複執行。
--
-- 回復：停用後端新功能後，確認不需要排程與執行結果再手動 DROP 這四張表（會刪除排程與歷史結果）。
CREATE TABLE IF NOT EXISTS media_play_schedules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name varchar(120) NOT NULL,
  mode varchar(16) NOT NULL CHECK (mode IN ('reserved','timed')),
  time_zone varchar(64) NOT NULL,
  run_local varchar(16),
  run_at bigint,
  start_date varchar(10),
  end_date varchar(10),
  weekly jsonb,
  target_scope varchar(16) NOT NULL CHECK (target_scope IN ('all','vehicles')),
  vehicle_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_group jsonb,
  next_run_at bigint,
  status varchar(16) NOT NULL DEFAULT 'active',
  row_version integer NOT NULL DEFAULT 1,
  created_by varchar,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint
);
CREATE INDEX IF NOT EXISTS "IDX_MEDIA_PLAY_DUE" ON media_play_schedules (status, next_run_at);

CREATE TABLE IF NOT EXISTS media_play_schedule_items (
  schedule_id uuid NOT NULL,
  position integer NOT NULL,
  media_id varchar NOT NULL,
  PRIMARY KEY (schedule_id, position)
);
CREATE INDEX IF NOT EXISTS "IDX_MEDIA_PLAY_ITEM_MEDIA" ON media_play_schedule_items (media_id);

CREATE TABLE IF NOT EXISTS media_play_batches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id uuid NOT NULL,
  scheduled_at bigint NOT NULL,
  schedule_version integer NOT NULL,
  status varchar(32) NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at bigint NOT NULL
);
-- 同一排程、同一排定時刻只會有一個批次（多個後端實例、重啟、重試都不會重複）
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_MEDIA_PLAY_BATCH" ON media_play_batches (schedule_id, scheduled_at);

CREATE TABLE IF NOT EXISTS media_play_deliveries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id uuid NOT NULL,
  vehicle_id varchar NOT NULL,
  vehicle_code varchar NOT NULL,
  vehicle_name varchar NOT NULL,
  status varchar(32) NOT NULL,
  reason varchar(300) NOT NULL,
  created_at bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_MEDIA_PLAY_DELIVERY" ON media_play_deliveries (batch_id, vehicle_id);
