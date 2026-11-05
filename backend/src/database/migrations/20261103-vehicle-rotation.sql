-- 車輛輪替：每台車的輪替狀態、每日報告與輪替項目。可重複執行。
CREATE TABLE IF NOT EXISTS vehicle_rotation_vehicles (
  vehicle_code varchar(32) PRIMARY KEY,
  hold varchar(16) NOT NULL DEFAULT 'available' CHECK (hold IN ('available','reserved','overhaul')),
  last_rotation_km numeric(12,3),
  driven_km numeric(12,3) NOT NULL DEFAULT 0,
  counted_until bigint NOT NULL DEFAULT 0,
  rotated_out_at bigint,
  updated_at bigint,
  updated_by varchar(64)
);

CREATE TABLE IF NOT EXISTS vehicle_rotation_reports (
  operating_day varchar(10) PRIMARY KEY,
  blocked jsonb NOT NULL DEFAULT '[]',
  generated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicle_rotation_items (
  id uuid PRIMARY KEY,
  operating_day varchar(10) NOT NULL,
  effective_day varchar(10) NOT NULL,
  outgoing varchar(32) NOT NULL,
  incoming varchar(32) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('pending','confirmed','skipped','done','aborted')),
  shunt_order jsonb NOT NULL,
  shunts jsonb NOT NULL,
  cancelled_order_ids jsonb NOT NULL,
  fault text,
  created_at bigint NOT NULL,
  confirmed_at bigint,
  confirmed_by varchar(64),
  finished_at bigint
);
CREATE INDEX IF NOT EXISTS idx_vehicle_rotation_items_day ON vehicle_rotation_items (operating_day);
CREATE INDEX IF NOT EXISTS idx_vehicle_rotation_items_effective ON vehicle_rotation_items (effective_day, status);
