-- 整備分布示範：facility_slots 定義各區格位數，slot_statuses 驅動顏色

DELETE FROM slot_statuses WHERE slot_id LIKE 'MAINT-%';
DELETE FROM facility_slots WHERE slot_id LIKE 'MAINT-%';

INSERT INTO facility_slots (slot_id, facility_type, zone, display_name, capacity, is_active, description, created_at, updated_at) VALUES
('MAINT-CHG-01', 'CHARGING_STATION', '整備-充電', '充電格 1', 1, true, '整備分布-充電', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-CHG-02', 'CHARGING_STATION', '整備-充電', '充電格 2', 1, true, '整備分布-充電', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-CHG-03', 'CHARGING_STATION', '整備-充電', '充電格 3', 1, true, '整備分布-充電', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-CHG-04', 'CHARGING_STATION', '整備-充電', '充電格 4', 1, true, '整備分布-充電', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-WSH-01', 'GENERAL', '整備-洗車', '洗車格 1', 1, true, '整備分布-洗車', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-SVC-01', 'GENERAL', '整備-保養', '保養格 1', 1, true, '整備分布-保養', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-RPR-01', 'GENERAL', '整備-維修', '維修格 1', 1, true, '整備分布-維修', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-DSP-01', 'GENERAL', '整備-調度', '調度格 1', 1, true, '整備分布-調度', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-DSP-02', 'GENERAL', '整備-調度', '調度格 2', 1, true, '整備分布-調度', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-DSP-03', 'GENERAL', '整備-調度', '調度格 3', 1, true, '整備分布-調度', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-PRK-01', 'PARKING', '整備-臨停', 'P1 臨停', 2, true, '整備分布-臨停 P1', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-PRK-02', 'PARKING', '整備-臨停', 'P2 臨停', 2, true, '整備分布-臨停 P2', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000);

INSERT INTO slot_statuses (slot_id, status, vehicle_code, last_updated, raw_payload) VALUES
('MAINT-CHG-01', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-CHG-02', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-CHG-03', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-CHG-04', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-WSH-01', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-SVC-01', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-RPR-01', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-DSP-01', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-DSP-02', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-DSP-03', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-PRK-01', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-PRK-02', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb)
ON CONFLICT (slot_id) DO UPDATE SET
  status = EXCLUDED.status,
  vehicle_code = EXCLUDED.vehicle_code,
  last_updated = EXCLUDED.last_updated,
  raw_payload = EXCLUDED.raw_payload;
