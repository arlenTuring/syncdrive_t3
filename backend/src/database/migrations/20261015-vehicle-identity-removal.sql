BEGIN;

ALTER TABLE vehicles ALTER COLUMN vehicle_code TYPE varchar(64);

DO $$
DECLARE duplicated_codes text;
BEGIN
  SELECT string_agg(vehicle_code, ', ' ORDER BY vehicle_code)
  INTO duplicated_codes
  FROM (
    SELECT min(vehicle_code) AS vehicle_code
    FROM vehicles
    GROUP BY lower(vehicle_code)
    HAVING count(*) > 1
  ) conflicts;

  IF duplicated_codes IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate vehicle identities must be resolved first: %', duplicated_codes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_vehicle_code_ci
  ON vehicles (lower(vehicle_code));

DO $$ BEGIN
  ALTER TYPE operator_action_logs_action_type_enum ADD VALUE IF NOT EXISTS 'VEHICLE_REMOVE';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMIT;
