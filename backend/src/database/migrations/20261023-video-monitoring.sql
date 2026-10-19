-- 影像監控標籤頁與歷史錄影：來源／版本、標籤／格子、全域預設、儲存政策、錄影片段索引與背景工作。
--
-- - 影片本身存在錄影 volume（或 GCS），資料庫只存設定、索引與狀態。
-- - 來源密碼只存 AES-256-GCM 密文（secret_ciphertext），API 不回原值。
-- - 來源版本不可變：換主機／路徑會產生新版本與新的媒體路徑，舊錄影仍以穩定 source_id 查得到。
-- - 刪除標籤或來源只是停用／移除設定，不連帶刪錄影。
-- 可重跑。

CREATE TABLE IF NOT EXISTS video_settings (
  id smallint CONSTRAINT "PK_VIDEO_SETTINGS" PRIMARY KEY DEFAULT 1 CONSTRAINT "CHK_VIDEO_SETTINGS_SINGLETON" CHECK (id = 1),
  -- 允許連線的攝影機網段／主機（CIDR 或主機名稱）；loopback、link-local、雲端 metadata 一律拒絕
  allowed_networks text[] NOT NULL DEFAULT ARRAY['10.0.0.0/8', '192.168.0.0/16']::text[],
  max_tabs integer NOT NULL DEFAULT 50 CONSTRAINT "CHK_VIDEO_SETTINGS_MAX_TABS" CHECK (max_tabs BETWEEN 1 AND 500),
  max_sources integer NOT NULL DEFAULT 200 CONSTRAINT "CHK_VIDEO_SETTINGS_MAX_SOURCES" CHECK (max_sources BETWEEN 1 AND 2000),
  row_version integer NOT NULL DEFAULT 1,
  updated_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);
INSERT INTO video_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS video_source_defaults (
  id smallint CONSTRAINT "PK_VIDEO_SOURCE_DEFAULTS" PRIMARY KEY DEFAULT 1 CONSTRAINT "CHK_VIDEO_DEFAULTS_SINGLETON" CHECK (id = 1),
  protocol varchar(8) NOT NULL DEFAULT 'rtsp',
  host varchar(255),
  port integer CONSTRAINT "CHK_VIDEO_DEFAULTS_PORT" CHECK (port IS NULL OR port BETWEEN 1 AND 65535),
  path_prefix varchar(255),
  path_template varchar(255),
  username varchar(120),
  secret_ciphertext text,
  recording_default boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1,
  updated_by varchar(64),
  updated_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);
INSERT INTO video_source_defaults (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS video_sources (
  id uuid CONSTRAINT "PK_VIDEO_SOURCES" PRIMARY KEY DEFAULT uuid_generate_v4(),
  name varchar(120) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  current_revision_id uuid,
  -- original（保留原碼流）／balanced／saving；需要轉碼時才生效
  recording_profile varchar(16) NOT NULL DEFAULT 'original' CONSTRAINT "CHK_VIDEO_SOURCE_PROFILE" CHECK (recording_profile IN ('original', 'balanced', 'saving')),
  -- worker 回報的實際狀態（連線、錄影、原因、codec 等），與 desired 分開
  actual_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_version integer NOT NULL DEFAULT 1,
  created_by varchar(64),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint
);

CREATE TABLE IF NOT EXISTS video_source_revisions (
  id uuid CONSTRAINT "PK_VIDEO_SOURCE_REVISIONS" PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id uuid NOT NULL CONSTRAINT "FK_VIDEO_REVISION_SOURCE" REFERENCES video_sources(id) ON DELETE RESTRICT,
  revision_no integer NOT NULL,
  protocol varchar(8) NOT NULL CONSTRAINT "CHK_VIDEO_REVISION_PROTOCOL" CHECK (protocol IN ('rtsp', 'rtsps', 'rtmp', 'rtmps', 'http', 'https', 'srt')),
  host varchar(255) NOT NULL,
  port integer CONSTRAINT "CHK_VIDEO_REVISION_PORT" CHECK (port IS NULL OR port BETWEEN 1 AND 65535),
  path varchar(500) NOT NULL DEFAULT '',
  query varchar(500),
  username varchar(120),
  secret_ciphertext text,
  substream_path varchar(500),
  vehicle_code varchar(64),
  camera_id varchar(120),
  location varchar(200),
  -- 媒體服務內部路徑名稱（由後端產生，與版本一對一）
  media_path varchar(80) NOT NULL CONSTRAINT "UQ_VIDEO_REVISION_MEDIA_PATH" UNIQUE,
  -- center＝以中心接收時間為時間基準；source＝信任來源絕對時間
  timestamp_basis varchar(8) NOT NULL DEFAULT 'center' CONSTRAINT "CHK_VIDEO_REVISION_TIME_BASIS" CHECK (timestamp_basis IN ('center', 'source')),
  valid_from bigint NOT NULL,
  valid_to bigint,
  created_by varchar(64),
  created_at bigint NOT NULL,
  CONSTRAINT "UQ_VIDEO_REVISION_NO" UNIQUE (source_id, revision_no)
);
CREATE INDEX IF NOT EXISTS "IDX_VIDEO_REVISION_SOURCE" ON video_source_revisions (source_id, valid_from DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_VIDEO_SOURCE_CURRENT_REVISION') THEN
    ALTER TABLE video_sources ADD CONSTRAINT "FK_VIDEO_SOURCE_CURRENT_REVISION"
      FOREIGN KEY (current_revision_id) REFERENCES video_source_revisions(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS video_monitor_tabs (
  id uuid CONSTRAINT "PK_VIDEO_MONITOR_TABS" PRIMARY KEY DEFAULT uuid_generate_v4(),
  name varchar(60) NOT NULL,
  position integer NOT NULL,
  tile_count integer NOT NULL DEFAULT 4 CONSTRAINT "CHK_VIDEO_TAB_TILE_COUNT" CHECK (tile_count BETWEEN 1 AND 12),
  row_version integer NOT NULL DEFAULT 1,
  created_by varchar(64),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint
);
CREATE INDEX IF NOT EXISTS "IDX_VIDEO_TAB_POSITION" ON video_monitor_tabs (position) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS video_monitor_tiles (
  id uuid CONSTRAINT "PK_VIDEO_MONITOR_TILES" PRIMARY KEY DEFAULT uuid_generate_v4(),
  tab_id uuid NOT NULL CONSTRAINT "FK_VIDEO_TILE_TAB" REFERENCES video_monitor_tabs(id) ON DELETE CASCADE,
  position integer NOT NULL CONSTRAINT "CHK_VIDEO_TILE_POSITION" CHECK (position BETWEEN 0 AND 11),
  source_id uuid CONSTRAINT "FK_VIDEO_TILE_SOURCE" REFERENCES video_sources(id) ON DELETE SET NULL,
  display_name varchar(120),
  recording_requested boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  -- 樣板變數（白名單：vehicleCode、cameraId、index）
  template_vars jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_version integer NOT NULL DEFAULT 1,
  updated_at bigint NOT NULL,
  CONSTRAINT "UQ_VIDEO_TILE_POSITION" UNIQUE (tab_id, position)
);
CREATE INDEX IF NOT EXISTS "IDX_VIDEO_TILE_SOURCE" ON video_monitor_tiles (source_id);

CREATE TABLE IF NOT EXISTS video_storage_policies (
  id varchar(16) CONSTRAINT "PK_VIDEO_STORAGE_POLICIES" PRIMARY KEY DEFAULT 'default' CONSTRAINT "CHK_VIDEO_STORAGE_SINGLETON" CHECK (id = 'default'),
  storage_type varchar(8) NOT NULL DEFAULT 'local' CONSTRAINT "CHK_VIDEO_STORAGE_TYPE" CHECK (storage_type IN ('local', 'gcs')),
  retention_days integer NOT NULL DEFAULT 7 CONSTRAINT "CHK_VIDEO_STORAGE_RETENTION" CHECK (retention_days BETWEEN 1 AND 3650),
  -- null＝自動：min(50 GiB, 首次可用容量 25%)
  max_bytes bigint CONSTRAINT "CHK_VIDEO_STORAGE_MAX_BYTES" CHECK (max_bytes IS NULL OR max_bytes > 0),
  -- null＝自動：max(5 GiB, 磁碟總量 10%)
  min_free_bytes bigint CONSTRAINT "CHK_VIDEO_STORAGE_MIN_FREE" CHECK (min_free_bytes IS NULL OR min_free_bytes >= 0),
  local_cache_max_bytes bigint,
  high_watermark_pct integer NOT NULL DEFAULT 85,
  low_watermark_pct integer NOT NULL DEFAULT 75,
  gcs_bucket varchar(222),
  gcs_prefix varchar(200),
  -- 可選高效率壓縮（預設關閉）：{ enabled, codec, replaceOriginal, minSavingPct, minVmaf, maxConcurrency }
  compression jsonb NOT NULL DEFAULT '{"enabled": false, "codec": "av1", "replaceOriginal": false, "minSavingPct": 15, "minVmaf": 90, "maxConcurrency": 1}'::jsonb,
  -- 首次自動預算的快照（避免每次依剩餘空間變動）
  auto_budget_bytes bigint,
  row_version integer NOT NULL DEFAULT 1,
  updated_by varchar(64),
  updated_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  CONSTRAINT "CHK_VIDEO_STORAGE_WATERMARKS" CHECK (low_watermark_pct >= 10 AND high_watermark_pct <= 99 AND low_watermark_pct < high_watermark_pct)
);
INSERT INTO video_storage_policies (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS video_recording_segments (
  id uuid CONSTRAINT "PK_VIDEO_RECORDING_SEGMENTS" PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id uuid NOT NULL CONSTRAINT "FK_VIDEO_SEGMENT_SOURCE" REFERENCES video_sources(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL CONSTRAINT "FK_VIDEO_SEGMENT_REVISION" REFERENCES video_source_revisions(id) ON DELETE RESTRICT,
  -- 媒體服務提供的片段鍵（相對錄影根目錄的檔案路徑）；冪等 upsert 用
  segment_key varchar(400) NOT NULL CONSTRAINT "UQ_VIDEO_SEGMENT_KEY" UNIQUE,
  start_at bigint NOT NULL,
  end_at bigint NOT NULL,
  status varchar(16) NOT NULL CONSTRAINT "CHK_VIDEO_SEGMENT_STATUS" CHECK (status IN ('WRITING', 'READY', 'UPLOADING', 'REMOTE_READY', 'FAILED', 'DELETE_PENDING', 'DELETED')),
  bytes bigint,
  codec varchar(80),
  width integer,
  height integer,
  fps numeric(6, 2),
  timestamp_basis varchar(8) NOT NULL DEFAULT 'center',
  checksum varchar(80),
  protected_until bigint,
  failure_reason varchar(300),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  CONSTRAINT "CHK_VIDEO_SEGMENT_RANGE" CHECK (end_at >= start_at)
);
CREATE INDEX IF NOT EXISTS "IDX_VIDEO_SEGMENT_SOURCE_TIME" ON video_recording_segments (source_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS "IDX_VIDEO_SEGMENT_STATUS_TIME" ON video_recording_segments (status, start_at);

CREATE TABLE IF NOT EXISTS video_segment_objects (
  id uuid CONSTRAINT "PK_VIDEO_SEGMENT_OBJECTS" PRIMARY KEY DEFAULT uuid_generate_v4(),
  segment_id uuid NOT NULL CONSTRAINT "FK_VIDEO_OBJECT_SEGMENT" REFERENCES video_recording_segments(id) ON DELETE CASCADE,
  rendition varchar(24) NOT NULL DEFAULT 'original',
  storage_type varchar(8) NOT NULL CONSTRAINT "CHK_VIDEO_OBJECT_STORAGE" CHECK (storage_type IN ('local', 'gcs')),
  object_key varchar(500) NOT NULL,
  generation varchar(40),
  checksum varchar(80),
  bytes bigint,
  status varchar(16) NOT NULL CONSTRAINT "CHK_VIDEO_OBJECT_STATUS" CHECK (status IN ('READY', 'DELETING', 'DELETED')),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  CONSTRAINT "UQ_VIDEO_SEGMENT_OBJECT" UNIQUE (segment_id, rendition, storage_type)
);

CREATE TABLE IF NOT EXISTS video_jobs (
  id uuid CONSTRAINT "PK_VIDEO_JOBS" PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind varchar(16) NOT NULL CONSTRAINT "CHK_VIDEO_JOB_KIND" CHECK (kind IN ('probe', 'preview', 'upload', 'compress', 'delete', 'export', 'apply')),
  dedupe_key varchar(200),
  status varchar(16) NOT NULL CONSTRAINT "CHK_VIDEO_JOB_STATUS" CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  progress numeric(5, 2) NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  lease_owner varchar(80),
  lease_until bigint,
  error varchar(500),
  created_by varchar(64),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  expires_at bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_VIDEO_JOB_DEDUPE" ON video_jobs (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS "IDX_VIDEO_JOB_PENDING" ON video_jobs (status, kind, created_at);
