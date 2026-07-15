-- 整備分布示範：facility_slots 定義各區格位數，slot_statuses 驅動顏色
-- 格位代號與地圖設施 customName 對齊：E1–E4、W1、H1–H3、M1–M4、P1–P4

DELETE FROM slot_statuses WHERE slot_id LIKE 'MAINT-%';
DELETE FROM facility_slots WHERE slot_id LIKE 'MAINT-%';

INSERT INTO facility_slots (slot_id, facility_type, zone, display_name, capacity, is_active, description, created_at, updated_at) VALUES
('MAINT-CHG-01', 'CHARGING_STATION', '整備-充電', '充電格 E1', 1, true, '整備分布-充電 E1', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-CHG-02', 'CHARGING_STATION', '整備-充電', '充電格 E2', 1, true, '整備分布-充電 E2', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-CHG-03', 'CHARGING_STATION', '整備-充電', '充電格 E3', 1, true, '整備分布-充電 E3', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-CHG-04', 'CHARGING_STATION', '整備-充電', '充電格 E4', 1, true, '整備分布-充電 E4', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-WSH-01', 'GENERAL', '整備-洗車', '洗車格 W1', 1, true, '整備分布-洗車 W1', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-SVC-01', 'GENERAL', '整備-保養', '保養格 M1', 1, true, '整備分布-保養 M1', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-SVC-02', 'GENERAL', '整備-保養', '保養格 M2', 1, true, '整備分布-保養 M2', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-SVC-03', 'GENERAL', '整備-保養', '保養格 M3', 1, true, '整備分布-保養 M3', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-SVC-04', 'GENERAL', '整備-保養', '保養格 M4', 1, true, '整備分布-保養 M4', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-DSP-01', 'GENERAL', '整備-調度', '調度格 H1', 1, true, '整備分布-調度 H1', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-DSP-02', 'GENERAL', '整備-調度', '調度格 H2', 1, true, '整備分布-調度 H2', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-DSP-03', 'GENERAL', '整備-調度', '調度格 H3', 1, true, '整備分布-調度 H3', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-PRK-01', 'PARKING', '整備-臨停', '臨停格 P1', 1, true, '整備分布-臨停 P1', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-PRK-02', 'PARKING', '整備-臨停', '臨停格 P2', 1, true, '整備分布-臨停 P2', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-PRK-03', 'PARKING', '整備-臨停', '臨停格 P3', 1, true, '整備分布-臨停 P3', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('MAINT-PRK-04', 'PARKING', '整備-臨停', '臨停格 P4', 1, true, '整備分布-臨停 P4', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000);

INSERT INTO slot_statuses (slot_id, status, vehicle_code, last_updated, raw_payload) VALUES
('MAINT-CHG-01', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-CHG-02', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-CHG-03', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-CHG-04', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-WSH-01', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-SVC-01', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-SVC-02', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-SVC-03', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-SVC-04', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-DSP-01', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-DSP-02', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-DSP-03', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-PRK-01', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-PRK-02', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-PRK-03', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb),
('MAINT-PRK-04', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{}'::jsonb)
ON CONFLICT (slot_id) DO UPDATE SET
  status = EXCLUDED.status,
  vehicle_code = EXCLUDED.vehicle_code,
  last_updated = EXCLUDED.last_updated,
  raw_payload = EXCLUDED.raw_payload;

-- 既有資料庫：整備格區還原為調度
UPDATE facility_slots
SET
  zone = '整備-調度',
  display_name = REPLACE(display_name, '整備格', '調度格'),
  description = REPLACE(description, '整備分布-整備格', '整備分布-調度')
WHERE zone = '整備-整備格';
