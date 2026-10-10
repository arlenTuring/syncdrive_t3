CREATE TABLE IF NOT EXISTS degraded_operation_plans (
  plan_id varchar(36) PRIMARY KEY,
  name varchar(200) NOT NULL,
  description text NOT NULL DEFAULT '',
  level integer NOT NULL,
  speed_limit_kmh double precision NOT NULL CHECK (speed_limit_kmh >= 0),
  version integer NOT NULL DEFAULT 1,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

ALTER TABLE degraded_operation_plans
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_degraded_operation_plans_updated_at
  ON degraded_operation_plans (updated_at DESC);

CREATE TABLE IF NOT EXISTS degraded_operation_executions (
  execution_id varchar(36) PRIMARY KEY,
  source_plan_id varchar(36),
  plan_name varchar(200) NOT NULL,
  plan_description text NOT NULL DEFAULT '',
  level integer NOT NULL CHECK (level IN (1, 2, 3)),
  speed_limit_kmh double precision NOT NULL CHECK (speed_limit_kmh >= 0),
  operator_id varchar(120) NOT NULL,
  control_status varchar(40) NOT NULL,
  command_tracking jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_degraded_operation_executions_created_at
  ON degraded_operation_executions (created_at DESC);

ALTER TABLE degraded_operation_executions
  ADD COLUMN IF NOT EXISTS execution_status varchar(24) NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS schedule_mode varchar(16) NOT NULL DEFAULT 'immediate',
  ADD COLUMN IF NOT EXISTS scheduled_for_operating bigint,
  ADD COLUMN IF NOT EXISTS scheduled_timezone varchar(80) NOT NULL DEFAULT 'Asia/Taipei',
  ADD COLUMN IF NOT EXISTS started_at_operating bigint,
  ADD COLUMN IF NOT EXISTS started_at_real bigint,
  ADD COLUMN IF NOT EXISTS ended_at_operating bigint,
  ADD COLUMN IF NOT EXISTS ended_at_real bigint,
  ADD COLUMN IF NOT EXISTS restore_speed_limit_kmh double precision,
  ADD COLUMN IF NOT EXISTS restore_checks jsonb,
  ADD COLUMN IF NOT EXISTS error_reason varchar(200),
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(120),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at bigint;

UPDATE degraded_operation_executions
SET idempotency_key = execution_id, updated_at = created_at
WHERE idempotency_key IS NULL OR updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_degraded_execution_idempotency
  ON degraded_operation_executions (idempotency_key);

CREATE TABLE IF NOT EXISTS degraded_operation_drafts (
  draft_key varchar(220) PRIMARY KEY,
  operator_id varchar(120) NOT NULL,
  draft_kind varchar(40) NOT NULL,
  draft_value jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open',
  version integer NOT NULL DEFAULT 1,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_degraded_draft_operator
  ON degraded_operation_drafts (operator_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS degraded_operation_events (
  event_id varchar(36) PRIMARY KEY,
  execution_id varchar(36),
  draft_key varchar(220),
  plan_id varchar(36),
  action varchar(60) NOT NULL,
  operator_id varchar(120) NOT NULL,
  real_at bigint NOT NULL,
  operating_at bigint,
  before_value jsonb,
  after_value jsonb,
  result varchar(20) NOT NULL,
  error_reason text
);

CREATE INDEX IF NOT EXISTS idx_degraded_event_execution_time
  ON degraded_operation_events (execution_id, real_at DESC);
