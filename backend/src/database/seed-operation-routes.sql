-- 正線路線模板：站點 + 站點動作（route_id 指向此結構）
-- 泛用架構可擴充更多站點與動作列

INSERT INTO operation_routes (route_id, route_name, line_kind, direction_letter)
VALUES
  ('ROUTE-MAINLINE-DOWN', '正線下行 N2W→T3→S2W', 'MAINLINE', 'D'),
  ('ROUTE-MAINLINE-UP', '正線上行 S2W→T3→N2W', 'MAINLINE', 'U')
ON CONFLICT (route_id) DO UPDATE SET
  route_name = EXCLUDED.route_name,
  line_kind = EXCLUDED.line_kind,
  direction_letter = EXCLUDED.direction_letter;

DELETE FROM operation_route_station_actions
WHERE route_id IN ('ROUTE-MAINLINE-DOWN', 'ROUTE-MAINLINE-UP');
DELETE FROM operation_route_stations
WHERE route_id IN ('ROUTE-MAINLINE-DOWN', 'ROUTE-MAINLINE-UP');

-- 下行站點
INSERT INTO operation_route_stations (station_row_id, route_id, sequence_order, station_id, remain_pct)
VALUES
  ('RS-DOWN-N2W', 'ROUTE-MAINLINE-DOWN', 0, 'N2W', 0),
  ('RS-DOWN-T3',  'ROUTE-MAINLINE-DOWN', 1, 'T3',  45),
  ('RS-DOWN-S2W', 'ROUTE-MAINLINE-DOWN', 2, 'S2W', 100);

INSERT INTO operation_route_station_actions
  (action_template_id, station_row_id, route_id, sequence_order, action_type, trigger_offset_m, node_id)
VALUES
  ('RT-DOWN-N2W-PRE',  'RS-DOWN-N2W', 'ROUTE-MAINLINE-DOWN', 0, 'PRE_DEPARTURE_BROADCAST', -15, 'ND-N2W-VOICE-01'),
  ('RT-DOWN-N2W-DEP',  'RS-DOWN-N2W', 'ROUTE-MAINLINE-DOWN', 1, 'STATION_DEPARTURE',        0, 'ND-N2W-DEP-01'),
  ('RT-DOWN-T3-DOCK',  'RS-DOWN-T3',  'ROUTE-MAINLINE-DOWN', 0, 'PLATFORM_DOCKING',         0, 'ND-T3-STOP-01'),
  ('RT-DOWN-T3-OPEN',  'RS-DOWN-T3',  'ROUTE-MAINLINE-DOWN', 1, 'OPEN_DOORS',               0, 'ND-T3-DOOR-01'),
  ('RT-DOWN-T3-CLOSE', 'RS-DOWN-T3',  'ROUTE-MAINLINE-DOWN', 2, 'CLOSE_DOORS',              0, 'ND-T3-DOOR-01'),
  ('RT-DOWN-T3-DEP',   'RS-DOWN-T3',  'ROUTE-MAINLINE-DOWN', 3, 'STATION_DEPARTURE',        0, 'ND-T3-DEP-01'),
  ('RT-DOWN-S2W-DOCK', 'RS-DOWN-S2W', 'ROUTE-MAINLINE-DOWN', 0, 'PLATFORM_DOCKING',         0, 'ND-S2W-STOP-01');

-- 上行站點
INSERT INTO operation_route_stations (station_row_id, route_id, sequence_order, station_id, remain_pct)
VALUES
  ('RS-UP-S2W', 'ROUTE-MAINLINE-UP', 0, 'S2W', 0),
  ('RS-UP-T3',  'ROUTE-MAINLINE-UP', 1, 'T3',  45),
  ('RS-UP-N2W', 'ROUTE-MAINLINE-UP', 2, 'N2W', 100);

INSERT INTO operation_route_station_actions
  (action_template_id, station_row_id, route_id, sequence_order, action_type, trigger_offset_m, node_id)
VALUES
  ('RT-UP-S2W-PRE',  'RS-UP-S2W', 'ROUTE-MAINLINE-UP', 0, 'PRE_DEPARTURE_BROADCAST', -15, 'ND-S2W-VOICE-01'),
  ('RT-UP-S2W-DEP',  'RS-UP-S2W', 'ROUTE-MAINLINE-UP', 1, 'STATION_DEPARTURE',        0, 'ND-S2W-DEP-01'),
  ('RT-UP-T3-DOCK',  'RS-UP-T3',  'ROUTE-MAINLINE-UP', 0, 'PLATFORM_DOCKING',         0, 'ND-T3-STOP-01'),
  ('RT-UP-T3-OPEN',  'RS-UP-T3',  'ROUTE-MAINLINE-UP', 1, 'OPEN_DOORS',               0, 'ND-T3-DOOR-01'),
  ('RT-UP-T3-CLOSE', 'RS-UP-T3',  'ROUTE-MAINLINE-UP', 2, 'CLOSE_DOORS',              0, 'ND-T3-DOOR-01'),
  ('RT-UP-T3-DEP',   'RS-UP-T3',  'ROUTE-MAINLINE-UP', 3, 'STATION_DEPARTURE',        0, 'ND-T3-DEP-01'),
  ('RT-UP-N2W-DOCK', 'RS-UP-N2W', 'ROUTE-MAINLINE-UP', 0, 'PLATFORM_DOCKING',         0, 'ND-N2W-STOP-01');

-- 臨時路權動作模板（行車途中插入 order_events，不綁固定站點）
-- 由車端 ACQUIRE_INTERLOCK 觸發時寫入 order_events

ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS route_id varchar(64);
