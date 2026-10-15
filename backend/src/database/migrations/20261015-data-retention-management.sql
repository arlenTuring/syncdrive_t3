-- 資料保留／清理管理。可重複執行；不啟用政策、不刪除任何既有資料。
CREATE TABLE IF NOT EXISTS data_retention_policies (
  category varchar(40) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  retention_value integer NOT NULL DEFAULT 30 CHECK (retention_value > 0),
  retention_unit varchar(8) NOT NULL DEFAULT 'day' CHECK (retention_unit IN ('hour','day')),
  interval_minutes integer NOT NULL DEFAULT 1440 CHECK (interval_minutes >= 15),
  next_run_at bigint,
  last_success_at bigint,
  last_failure_at bigint,
  last_error text,
  updated_by varchar(64),
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS data_cleanup_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id varchar(64) NOT NULL,
  category varchar(40) NOT NULL,
  criteria jsonb NOT NULL,
  preview jsonb NOT NULL,
  protection_fingerprint varchar(64) NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  consumed_at bigint
);
CREATE INDEX IF NOT EXISTS "IDX_DATA_CLEANUP_PLAN_EXPIRY" ON data_cleanup_plans(expires_at);

CREATE TABLE IF NOT EXISTS data_cleanup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid REFERENCES data_cleanup_plans(id),
  category varchar(40) NOT NULL,
  trigger varchar(12) NOT NULL CHECK (trigger IN ('manual','policy')),
  status varchar(20) NOT NULL,
  criteria jsonb NOT NULL,
  requested_by varchar(64),
  requested_at bigint NOT NULL,
  started_at bigint,
  finished_at bigint,
  stop_requested boolean NOT NULL DEFAULT false,
  deleted_count bigint NOT NULL DEFAULT 0,
  estimated_bytes bigint NOT NULL DEFAULT 0,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_DATA_CLEANUP_JOB_PLAN" ON data_cleanup_jobs(plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS "IDX_DATA_CLEANUP_JOB_REQUESTED" ON data_cleanup_jobs(requested_at DESC);

INSERT INTO data_retention_policies(category, enabled, retention_value, retention_unit, interval_minutes, updated_at)
VALUES
  ('vehicle_history', false, 30, 'day', 1440, (extract(epoch from now()) * 1000)::bigint),
  ('degraded_replay', false, 30, 'day', 1440, (extract(epoch from now()) * 1000)::bigint),
  ('telemetry', false, 7, 'day', 1440, (extract(epoch from now()) * 1000)::bigint),
  ('bulk_logs', false, 30, 'day', 1440, (extract(epoch from now()) * 1000)::bigint)
ON CONFLICT (category) DO NOTHING;

ALTER TABLE vehicle_history_gaps ADD COLUMN IF NOT EXISTS vehicle_code varchar(64);
ALTER TABLE telemetry_logs ADD COLUMN IF NOT EXISTS received_at bigint;
CREATE INDEX IF NOT EXISTS "IDX_TELEMETRY_RECEIVED" ON telemetry_logs(received_at) WHERE received_at IS NOT NULL;
