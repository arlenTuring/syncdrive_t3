-- Seed test data for SyncDrive T3

-- 1. Vehicles：營運車隊為 PMS-*（儀表板 seed 會補齊 PMS-01～11）；勿再插入 AGV/AMR
DELETE FROM vehicles WHERE vehicle_code ~ '^(AGV|AMR)-';

-- 2. Facility Slots (Static Layout)
INSERT INTO facility_slots (slot_id, facility_type, zone, display_name, capacity, is_active, description, created_at, updated_at) VALUES 
('SLOT-A1', 'PARKING', 'Zone A', 'Parking A1', 1, true, 'General parking area', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('SLOT-A2', 'PARKING', 'Zone A', 'Parking A2', 1, true, 'General parking area', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('SLOT-C1', 'CHARGING_STATION', 'Zone C', 'Charger 1', 1, true, 'Fast charging station', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('SLOT-C2', 'CHARGING_STATION', 'Zone C', 'Charger 2', 1, true, 'Normal charging station', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('SLOT-C3', 'CHARGING_STATION', 'Zone C', 'Charger 3', 1, true, 'Normal charging station', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000),
('SLOT-B1', 'GENERAL', 'Zone B', 'Buffer B1', 1, true, 'Buffer zone', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000)
ON CONFLICT (slot_id) DO NOTHING;

-- 3. Slot Statuses (Real-time state)
INSERT INTO slot_statuses (slot_id, status, vehicle_code, last_updated, raw_payload) VALUES 
('SLOT-A1', 'OCCUPIED', 'AGV-001', EXTRACT(EPOCH FROM NOW()) * 1000, '{"state": "occupied"}'::jsonb),
('SLOT-A2', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{"state": "available"}'::jsonb),
('SLOT-C1', 'CHARGING', 'AMR-101', EXTRACT(EPOCH FROM NOW()) * 1000, '{"state": "charging", "soc": 45}'::jsonb),
('SLOT-C2', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{"state": "available"}'::jsonb),
('SLOT-C3', 'ERROR', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{"state": "error", "code": "E-401"}'::jsonb),
('SLOT-B1', 'AVAILABLE', NULL, EXTRACT(EPOCH FROM NOW()) * 1000, '{"state": "available"}'::jsonb)
ON CONFLICT (slot_id) DO UPDATE SET status = EXCLUDED.status, vehicle_code = EXCLUDED.vehicle_code, last_updated = EXCLUDED.last_updated;

-- 4. Field Equipment Status
INSERT INTO field_equipment_status (equipment_id, equipment_type, display_name, location, junction_id, is_active, last_seen_at, current_status, fault_codes, updated_at) VALUES 
('SIG-J1', 'TRAFFIC_SIGNAL', 'Junction 1 Signal', '{"lat": 25.033, "lng": 121.564}'::jsonb, 'J1', true, EXTRACT(EPOCH FROM NOW()) * 1000, 'OK', '[]'::jsonb, EXTRACT(EPOCH FROM NOW()) * 1000),
('SIG-J2', 'TRAFFIC_SIGNAL', 'Junction 2 Signal', '{"lat": 25.034, "lng": 121.565}'::jsonb, 'J2', true, EXTRACT(EPOCH FROM NOW()) * 1000, 'WARNING', '["W-001"]'::jsonb, EXTRACT(EPOCH FROM NOW()) * 1000),
('RSU-01', 'RSU', 'Main Gate RSU', '{"lat": 25.035, "lng": 121.566}'::jsonb, NULL, true, EXTRACT(EPOCH FROM NOW()) * 1000, 'OK', '[]'::jsonb, EXTRACT(EPOCH FROM NOW()) * 1000),
('RSU-02', 'RSU', 'South Gate RSU', '{"lat": 25.031, "lng": 121.562}'::jsonb, NULL, true, EXTRACT(EPOCH FROM NOW()) * 1000 - 3600000, 'OFFLINE', '[]'::jsonb, EXTRACT(EPOCH FROM NOW()) * 1000 - 3600000)
ON CONFLICT (equipment_id) DO UPDATE SET current_status = EXCLUDED.current_status, updated_at = EXCLUDED.updated_at;

-- 5. Operator Action Logs
INSERT INTO operator_action_logs (id, operator_id, source_ip, action_type, target_vehicle, action_detail, result, failure_reason, created_at) VALUES 
(gen_random_uuid(), 'admin', '192.168.1.100', 'COMMAND_DISPATCH', 'AGV-001', '{"command": "MOVE_TO", "dest": "SLOT-A1"}'::jsonb, 'SUCCESS', NULL, EXTRACT(EPOCH FROM NOW()) * 1000 - 7200000),
(gen_random_uuid(), 'admin', '192.168.1.100', 'SPEED_LIMIT_SET', 'all', '{"max_speed": 1.5}'::jsonb, 'SUCCESS', NULL, EXTRACT(EPOCH FROM NOW()) * 1000 - 3600000),
(gen_random_uuid(), 'user1', '192.168.1.105', 'ORDER_CREATE', 'AMR-101', '{"order_id": "ORD-2026-001"}'::jsonb, 'FAILED', 'Vehicle battery too low', EXTRACT(EPOCH FROM NOW()) * 1000 - 1800000),
(gen_random_uuid(), 'system', '127.0.0.1', 'DIRECTION_CHANGE', 'AGV-002', '{"lane": "L-12", "dir": "REVERSE"}'::jsonb, 'SUCCESS', NULL, EXTRACT(EPOCH FROM NOW()) * 1000);

-- 6. Telemetry Logs (Recent)
INSERT INTO telemetry_logs (id, timestamp, vehicle_code, raw_payload) VALUES 
(gen_random_uuid(), NOW() - INTERVAL '5 minutes', 'AGV-001', '{"speed": 1.2, "soc": 85, "x": 10.5, "y": 20.1}'::jsonb),
(gen_random_uuid(), NOW() - INTERVAL '4 minutes', 'AGV-001', '{"speed": 1.3, "soc": 85, "x": 11.5, "y": 20.1}'::jsonb),
(gen_random_uuid(), NOW() - INTERVAL '3 minutes', 'AGV-001', '{"speed": 1.4, "soc": 84, "x": 12.5, "y": 20.1}'::jsonb),
(gen_random_uuid(), NOW() - INTERVAL '2 minutes', 'AGV-001', '{"speed": 1.2, "soc": 84, "x": 13.5, "y": 20.1}'::jsonb),
(gen_random_uuid(), NOW() - INTERVAL '1 minutes', 'AGV-001', '{"speed": 0.0, "soc": 84, "x": 14.0, "y": 20.1}'::jsonb),
(gen_random_uuid(), NOW() - INTERVAL '5 minutes', 'AMR-101', '{"speed": 0.0, "soc": 44, "x": 5.0, "y": 5.0}'::jsonb),
(gen_random_uuid(), NOW() - INTERVAL '4 minutes', 'AMR-101', '{"speed": 0.0, "soc": 44, "x": 5.0, "y": 5.0}'::jsonb),
(gen_random_uuid(), NOW() - INTERVAL '3 minutes', 'AMR-101', '{"speed": 0.0, "soc": 45, "x": 5.0, "y": 5.0}'::jsonb),
(gen_random_uuid(), NOW() - INTERVAL '2 minutes', 'AMR-101', '{"speed": 0.0, "soc": 45, "x": 5.0, "y": 5.0}'::jsonb),
(gen_random_uuid(), NOW() - INTERVAL '1 minutes', 'AMR-101', '{"speed": 0.0, "soc": 45, "x": 5.0, "y": 5.0}'::jsonb);
