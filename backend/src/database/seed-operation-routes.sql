-- 正線路線模板：站點 + 站點動作（route_id 指向此結構）
-- station_id 對應地圖 DockingPoint.parameters.stationId

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

ALTER TABLE operation_route_stations
  ADD COLUMN IF NOT EXISTS station_display_name varchar(128) NOT NULL DEFAULT '';

ALTER TABLE operation_route_stations
  DROP COLUMN IF EXISTS remain_pct;

-- 下行：N2W下行 → T3下行 → S2W下行
INSERT INTO operation_route_stations (station_row_id, route_id, sequence_order, station_id, station_display_name)
VALUES
  ('RS-DOWN-N2W', 'ROUTE-MAINLINE-DOWN', 0, 'station_2', 'N2W下行'),
  ('RS-DOWN-T3',  'ROUTE-MAINLINE-DOWN', 1, 'station_3', 'T3下行'),
  ('RS-DOWN-S2W', 'ROUTE-MAINLINE-DOWN', 2, 'station_5', 'S2W下行');

INSERT INTO operation_route_station_actions
  (action_template_id, station_row_id, route_id, sequence_order, action_type, trigger_offset_m, node_id)
VALUES
  ('RT-DOWN-N2W-PRE',  'RS-DOWN-N2W', 'ROUTE-MAINLINE-DOWN', 0, 'PRE_DEPARTURE_BROADCAST', -80, NULL),
  ('RT-DOWN-N2W-DEP',  'RS-DOWN-N2W', 'ROUTE-MAINLINE-DOWN', 1, 'STATION_DEPARTURE',        0, NULL),
  ('RT-DOWN-T3-DOCK',  'RS-DOWN-T3',  'ROUTE-MAINLINE-DOWN', 0, 'PLATFORM_DOCKING',         0, NULL),
  ('RT-DOWN-T3-OPEN',  'RS-DOWN-T3',  'ROUTE-MAINLINE-DOWN', 1, 'OPEN_DOORS',               0, NULL),
  ('RT-DOWN-T3-CLOSE', 'RS-DOWN-T3',  'ROUTE-MAINLINE-DOWN', 2, 'CLOSE_DOORS',              0, NULL),
  ('RT-DOWN-T3-DEP',   'RS-DOWN-T3',  'ROUTE-MAINLINE-DOWN', 3, 'STATION_DEPARTURE',        0, NULL),
  ('RT-DOWN-S2W-DOCK', 'RS-DOWN-S2W', 'ROUTE-MAINLINE-DOWN', 0, 'PLATFORM_DOCKING',         0, NULL);

-- 上行：S2W上行 → T3上行 → N2W上行
INSERT INTO operation_route_stations (station_row_id, route_id, sequence_order, station_id, station_display_name)
VALUES
  ('RS-UP-S2W', 'ROUTE-MAINLINE-UP', 0, 'station_6', 'S2W上行'),
  ('RS-UP-T3',  'ROUTE-MAINLINE-UP', 1, 'station_4', 'T3上行'),
  ('RS-UP-N2W', 'ROUTE-MAINLINE-UP', 2, 'station_1', 'N2W上行');

INSERT INTO operation_route_station_actions
  (action_template_id, station_row_id, route_id, sequence_order, action_type, trigger_offset_m, node_id)
VALUES
  ('RT-UP-S2W-PRE',  'RS-UP-S2W', 'ROUTE-MAINLINE-UP', 0, 'PRE_DEPARTURE_BROADCAST', -80, NULL),
  ('RT-UP-S2W-DEP',  'RS-UP-S2W', 'ROUTE-MAINLINE-UP', 1, 'STATION_DEPARTURE',        0, NULL),
  ('RT-UP-T3-DOCK',  'RS-UP-T3',  'ROUTE-MAINLINE-UP', 0, 'PLATFORM_DOCKING',         0, NULL),
  ('RT-UP-T3-OPEN',  'RS-UP-T3',  'ROUTE-MAINLINE-UP', 1, 'OPEN_DOORS',               0, NULL),
  ('RT-UP-T3-CLOSE', 'RS-UP-T3',  'ROUTE-MAINLINE-UP', 2, 'CLOSE_DOORS',              0, NULL),
  ('RT-UP-T3-DEP',   'RS-UP-T3',  'ROUTE-MAINLINE-UP', 3, 'STATION_DEPARTURE',        0, NULL),
  ('RT-UP-N2W-DOCK', 'RS-UP-N2W', 'ROUTE-MAINLINE-UP', 0, 'PLATFORM_DOCKING',         0, NULL);

ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS route_id varchar(64);
