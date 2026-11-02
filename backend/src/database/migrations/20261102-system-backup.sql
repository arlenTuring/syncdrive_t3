-- 系統基礎設定的資料備份。可重複執行；預設不開自動備份。
CREATE TABLE IF NOT EXISTS system_backup_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  manual_dir varchar(512) NOT NULL,
  auto_dir varchar(512) NOT NULL,
  auto_enabled boolean NOT NULL DEFAULT false,
  auto_time varchar(5) NOT NULL DEFAULT '03:00',
  keep_count integer NOT NULL DEFAULT 7 CHECK (keep_count BETWEEN 1 AND 365),
  include_files boolean NOT NULL DEFAULT true,
  next_run_at bigint,
  updated_at bigint,
  updated_by varchar(64)
);

CREATE TABLE IF NOT EXISTS system_backup_runs (
  id uuid PRIMARY KEY,
  trigger varchar(8) NOT NULL CHECK (trigger IN ('manual','auto')),
  status varchar(12) NOT NULL CHECK (status IN ('running','success','failed','stopped','deleted')),
  dir varchar(512) NOT NULL,
  name varchar(64) NOT NULL,
  include_files boolean NOT NULL DEFAULT true,
  started_at bigint NOT NULL,
  finished_at bigint,
  database_bytes bigint,
  files_bytes bigint,
  database_sha256 varchar(64),
  verified boolean NOT NULL DEFAULT false,
  error text,
  operator_id varchar(64)
);

-- 同一時間只能有一份備份在跑
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_SYSTEM_BACKUP_RUNNING" ON system_backup_runs(status) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS "IDX_SYSTEM_BACKUP_STARTED" ON system_backup_runs(started_at);

-- 自動備份失敗要進事件管理
ALTER TYPE security_event_logs_event_code_enum ADD VALUE IF NOT EXISTS 'SYSTEM_BACKUP_FAILED';
