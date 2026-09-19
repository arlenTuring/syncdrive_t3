-- 載具監控示範（PMS01～11 · 班次模擬車隊；預設皆正常，異常僅來自即時 MQTT 健康心跳）
CREATE TABLE IF NOT EXISTS vehicle_monitor_demo (
  vehicle_code VARCHAR(32) PRIMARY KEY,
  overall_health VARCHAR(16) NOT NULL DEFAULT 'OK',
  alert_message VARCHAR(128) NOT NULL DEFAULT '',
  card_border_color VARCHAR(16) NOT NULL DEFAULT '#00c897',
  status_computing VARCHAR(16) NOT NULL DEFAULT 'OK',
  status_sensing VARCHAR(16) NOT NULL DEFAULT 'OK',
  status_communication VARCHAR(16) NOT NULL DEFAULT 'OK',
  status_chassis VARCHAR(16) NOT NULL DEFAULT 'OK',
  badge_label VARCHAR(32),
  trip_badge_bg VARCHAR(16),
  trip_badge_color VARCHAR(16),
  badge_outline CHAR(1) NOT NULL DEFAULT '0',
  demo_speed NUMERIC,
  demo_load NUMERIC,
  segment_label VARCHAR(32)
);

ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS location_kind VARCHAR(16);
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS location_object_id VARCHAR(128);
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS position_x DOUBLE PRECISION;
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS position_y DOUBLE PRECISION;
ALTER TABLE vehicle_monitor_demo ADD COLUMN IF NOT EXISTS position_updated_at BIGINT;

INSERT INTO vehicle_monitor_demo (
  vehicle_code, overall_health, alert_message, card_border_color,
  status_computing, status_sensing, status_communication, status_chassis,
  badge_label, trip_badge_bg, trip_badge_color, badge_outline,
  demo_speed, demo_load, segment_label
) VALUES
  ('PMS01', 'OK', '', '#00c897', 'OK', 'OK', 'OK', 'OK',
   NULL, '#7e57c2', '#f3e8ff', '0', 0, 88.0, 'P1'),
  ('PMS02', 'OK', '', '#00c897', 'OK', 'OK', 'OK', 'OK',
   NULL, '#7e57c2', '#f3e8ff', '0', 17.2, 87.0, 'D12'),
  ('PMS03', 'OK', '', '#00c897', 'OK', 'OK', 'OK', 'OK',
   NULL, '#7e57c2', '#f3e8ff', '0', 16.2, 85.5, 'D08'),
  ('PMS04', 'OK', '', '#00c897', 'OK', 'OK', 'OK', 'OK',
   NULL, '#7e57c2', '#f3e8ff', '0', 16.8, 86.5, 'D20'),
  ('PMS05', 'OK', '', '#00c897', 'OK', 'OK', 'OK', 'OK',
   NULL, '#7e57c2', '#f3e8ff', '0', 15.8, 84.5, 'D28'),
  ('PMS06', 'OK', '', '#00c897', 'OK', 'OK', 'OK', 'OK',
   NULL, '#7e57c2', '#f3e8ff', '0', 17.5, 87.5, 'U08'),
  ('PMS07', 'OK', '', '#00c897', 'OK', 'OK', 'OK', 'OK',
   NULL, '#7e57c2', '#f3e8ff', '0', 0, 86.0, 'H1'),
  ('PMS08', 'OK', '', '#00c897', 'OK', 'OK', 'OK', 'OK',
   NULL, '#7e57c2', '#f3e8ff', '0', 15.5, 84.0, 'U28'),
  ('PMS09', 'OK', '', '#00c897', 'OK', 'OK', 'OK', 'OK',
   NULL, '#7e57c2', '#f3e8ff', '0', 16.0, 85.0, 'D18'),
  ('PMS10', 'OK', '', '#00c897', 'OK', 'OK', 'OK', 'OK',
   NULL, '#7e57c2', '#f3e8ff', '0', 0, 83.5, 'E1'),
  ('PMS11', 'OK', '', '#00c897', 'OK', 'OK', 'OK', 'OK',
   NULL, '#7e57c2', '#f3e8ff', '0', 0, 82.0, 'P4')
ON CONFLICT (vehicle_code) DO UPDATE SET
  overall_health = EXCLUDED.overall_health,
  alert_message = EXCLUDED.alert_message,
  card_border_color = EXCLUDED.card_border_color,
  status_computing = EXCLUDED.status_computing,
  status_sensing = EXCLUDED.status_sensing,
  status_communication = EXCLUDED.status_communication,
  status_chassis = EXCLUDED.status_chassis,
  badge_label = EXCLUDED.badge_label,
  trip_badge_bg = EXCLUDED.trip_badge_bg,
  trip_badge_color = EXCLUDED.trip_badge_color,
  badge_outline = EXCLUDED.badge_outline,
  demo_speed = EXCLUDED.demo_speed,
  demo_load = EXCLUDED.demo_load,
  segment_label = EXCLUDED.segment_label;
