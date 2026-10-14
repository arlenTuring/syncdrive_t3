BEGIN;

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS initial_mileage_km numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  ALTER TABLE vehicles ADD CONSTRAINT vehicles_initial_mileage_nonnegative
    CHECK (initial_mileage_km >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_vehicles_registration_list
  ON vehicles (is_active, service_enabled, vehicle_code);

DO $$ BEGIN
  ALTER TYPE operator_action_logs_action_type_enum ADD VALUE IF NOT EXISTS 'VEHICLE_REGISTER';
  ALTER TYPE operator_action_logs_action_type_enum ADD VALUE IF NOT EXISTS 'VEHICLE_UPDATE';
  ALTER TYPE operator_action_logs_action_type_enum ADD VALUE IF NOT EXISTS 'VEHICLE_SERVICE_SETTING';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMIT;
