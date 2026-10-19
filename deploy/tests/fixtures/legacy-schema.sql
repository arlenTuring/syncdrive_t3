-- Reviewed pre-Migration schema used only in disposable deployment tests.
-- It intentionally omits vehicle_history_*, data_retention_*, cleanup tables,
-- registration columns, replay tables, media row versions and play schedules.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

CREATE TYPE operator_action_logs_action_type_enum AS ENUM ('LOGIN');

CREATE TABLE vehicles (
  id uuid PRIMARY KEY,
  vehicle_code varchar(10) NOT NULL UNIQUE,
  display_name varchar,
  is_active boolean NOT NULL DEFAULT true,
  created_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000),
  updated_at bigint
);
INSERT INTO vehicles(id, vehicle_code, display_name, is_active, created_at, updated_at)
SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       'PMS' || lpad(n::text, 2, '0'), '舊版車輛 ' || n, true, 1000, 1000
FROM generate_series(1, 11) n;

CREATE TABLE partner_api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE vehicle_definitions (
  id varchar PRIMARY KEY,
  name varchar NOT NULL
);
INSERT INTO vehicle_definitions VALUES ('legacy-model', '舊版模型');

CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  account_name varchar NOT NULL UNIQUE,
  display_name varchar NOT NULL,
  email varchar,
  password_hash varchar,
  status varchar NOT NULL DEFAULT 'ACTIVE',
  last_login_at bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE TABLE roles (
  id uuid PRIMARY KEY,
  role_code varchar NOT NULL UNIQUE,
  display_name varchar NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE TABLE permissions (
  id uuid PRIMARY KEY,
  permission_code varchar NOT NULL UNIQUE,
  module varchar NOT NULL,
  display_name varchar NOT NULL,
  description text,
  created_at bigint NOT NULL
);
CREATE TABLE account_roles (account_id varchar NOT NULL, role_id varchar NOT NULL, assigned_by varchar);
CREATE TABLE role_permissions (role_id varchar NOT NULL, permission_id varchar NOT NULL);
INSERT INTO accounts(id, account_name, display_name, created_at, updated_at)
VALUES ('10000000-0000-0000-0000-000000000001', 'legacy-admin', '舊版管理員', 1000, 1000);
INSERT INTO roles(id, role_code, display_name, is_system, created_at, updated_at)
VALUES ('20000000-0000-0000-0000-000000000001', 'ADMIN', '管理員', true, 1000, 1000);
INSERT INTO permissions(id, permission_code, module, display_name, created_at)
VALUES ('30000000-0000-0000-0000-000000000001', 'legacy.view', 'legacy', '舊版檢視', 1000);
INSERT INTO account_roles VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', NULL);
INSERT INTO role_permissions VALUES ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');

CREATE TABLE vehicle_monitor_demo (
  vehicle_code varchar PRIMARY KEY,
  speed_kmh double precision,
  battery_percent double precision
);
INSERT INTO vehicle_monitor_demo(vehicle_code, speed_kmh, battery_percent) VALUES ('PMS01', 0, 90);

CREATE TABLE operation_orders (
  order_id varchar PRIMARY KEY,
  trip_code varchar NOT NULL,
  route_id varchar,
  vehicle_code varchar NOT NULL,
  priority_level integer NOT NULL DEFAULT 50,
  status varchar NOT NULL DEFAULT 'PENDING',
  payload jsonb,
  created_at bigint NOT NULL,
  completed_at bigint,
  line_kind varchar,
  delay_minutes integer,
  planned_start bigint,
  planned_end bigint
);
CREATE TABLE order_action_states (
  action_id varchar PRIMARY KEY,
  order_id varchar NOT NULL,
  station_id varchar NOT NULL,
  action_type varchar NOT NULL,
  action_status varchar NOT NULL DEFAULT 'PENDING',
  trigger_offset_m double precision NOT NULL DEFAULT 0,
  node_id varchar,
  actual_start_time bigint,
  actual_end_time bigint,
  note text
);
INSERT INTO operation_orders(order_id, trip_code, vehicle_code, status, payload, created_at, planned_start, planned_end)
VALUES ('LEGACY-ORDER-1', 'LEGACY-TRIP', 'PMS01', 'END', '{}', 1000, 1000, 2000);
INSERT INTO order_action_states(action_id, order_id, station_id, action_type, action_status)
VALUES ('LEGACY-ACTION-1', 'LEGACY-ORDER-1', 'S01', 'ANNOUNCE', 'COMPLETED');

CREATE TABLE telemetry_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  timestamp timestamptz NOT NULL,
  vehicle_code varchar NOT NULL,
  raw_payload jsonb NOT NULL,
  PRIMARY KEY(id, timestamp)
);
SELECT create_hypertable('telemetry_logs', 'timestamp', if_not_exists => true);
INSERT INTO telemetry_logs(timestamp, vehicle_code, raw_payload)
VALUES ('2026-01-01T00:00:00Z', 'PMS01', '{"legacy":true}');

CREATE TABLE media_library_items (
  media_id varchar PRIMARY KEY,
  name varchar NOT NULL,
  kind varchar NOT NULL DEFAULT 'media',
  body jsonb NOT NULL DEFAULT '{}',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
INSERT INTO media_library_items VALUES ('legacy-media', '舊版媒體', 'media', '{}', 1000, 1000);

CREATE TABLE data_sources (
  id uuid PRIMARY KEY,
  source_key varchar NOT NULL UNIQUE,
  name varchar NOT NULL,
  type varchar NOT NULL,
  config jsonb NOT NULL,
  is_active boolean NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
INSERT INTO data_sources VALUES
('40000000-0000-0000-0000-000000000001', 'legacy-source', '舊版設定', 'internal', '{}', true, 1000, 1000);
