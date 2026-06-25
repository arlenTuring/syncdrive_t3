-- 運能趨勢示範：折線點以「現在」為基準的 offset_minutes，查詢時動態換算 HH:mm
-- actual_util＝當前運能線；forecast_util＝預期走勢線（設計稿雙線）
-- 可重複執行（DELETE + INSERT）

DELETE FROM capacity_trend_demo_points WHERE demo_set_id = 'DEMO';

INSERT INTO capacity_trend_demo_points (
  point_id,
  demo_set_id,
  offset_minutes,
  utilization,
  actual_util,
  forecast_util,
  line_segment,
  segment_code,
  is_anomaly,
  anomaly_label
) VALUES
  ('DEMO-CAP-01', 'DEMO', -150, 1200, 1200, NULL,     'normal',   'IN_SERVICE', false, ''),
  ('DEMO-CAP-02', 'DEMO',  -90, 1200, 1200, NULL,     'normal',   'IN_SERVICE', false, ''),
  ('DEMO-CAP-03', 'DEMO',  -45, 1050, 1050, NULL,     'normal',   'IN_SERVICE', true,  '車輛溫度過高'),
  ('DEMO-CAP-04', 'DEMO',    0, 1200, 1200, 1200,     'normal',   'IN_SERVICE', false, ''),
  ('DEMO-CAP-05', 'DEMO',   30,  600, NULL, 600,      'degraded', 'SCHEDULED',  false, ''),
  ('DEMO-CAP-06', 'DEMO',   60,  600, NULL, 600,      'degraded', 'SCHEDULED',  false, ''),
  ('DEMO-CAP-07', 'DEMO',  120, 1000, NULL, 1000,     'degraded', 'SCHEDULED',  false, ''),
  ('DEMO-CAP-08', 'DEMO',  180, 1200, NULL, 1200,     'normal',   'SCHEDULED',  false, '');
