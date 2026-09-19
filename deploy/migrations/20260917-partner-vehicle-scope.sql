ALTER TABLE partner_api_keys ADD COLUMN IF NOT EXISTS vehicle_codes jsonb;

-- Dedicated partner test vehicle; is_active=false excludes it from dispatch row mapping.
INSERT INTO vehicles (id, vehicle_code, display_name, is_active)
VALUES (gen_random_uuid(), 'PMS99', 'PMS99 協力廠商聯測', false)
ON CONFLICT (vehicle_code) DO NOTHING;
