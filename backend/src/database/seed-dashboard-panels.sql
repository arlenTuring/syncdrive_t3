-- 事件中心（可重複執行）

-- 班次中心的班次來自排班引擎與 seed-dashboard-shifts.sql；
-- 不再灌沒有路線／起訖點的 DEMO-SHIFT 訂單（模擬器接單時會報「缺起訖點」）。

DELETE FROM security_event_logs WHERE event_id LIKE 'DEMO-EVT-%';

INSERT INTO security_event_logs (
  event_id, vehicle_code, event_code, severity, detail, params, created_at,
  category_label, display_message, sub_label, is_acknowledged
) VALUES
  (
    'DEMO-EVT-001',
    'V005',
    'PATH_BLOCKED',
    'CRITICAL',
    '防鎖死煞車系統故障',
    '{"subsystem":"CHASSIS"}'::jsonb,
    (EXTRACT(EPOCH FROM NOW() - INTERVAL '20 minutes') * 1000)::bigint,
    '線控',
    '防鎖死煞車系統故障',
    'PMS02',
    false
  ),
  (
    'DEMO-EVT-002',
    'C003',
    'OBSTACLE_DETECTED',
    'WARNING',
    '攝像頭視野模糊',
    '{}'::jsonb,
    (EXTRACT(EPOCH FROM NOW() - INTERVAL '45 minutes') * 1000)::bigint,
    '感測',
    '攝像頭視野模糊',
    'PMS02',
    false
  ),
  (
    'DEMO-EVT-003',
    'I001',
    'SYSTEM_HEALTH_DEGRADED',
    'INFO',
    '背景日誌存儲已滿',
    '{}'::jsonb,
    (EXTRACT(EPOCH FROM NOW() - INTERVAL '1 hour') * 1000)::bigint,
    '運算',
    '背景日誌存儲已滿',
    'PMS02',
    true
  ),
  (
    'DEMO-EVT-004',
    'V008',
    'OBSTACLE_DETECTED',
    'WARNING',
    '電池電量低於安全閾值',
    '{}'::jsonb,
    (EXTRACT(EPOCH FROM NOW() - INTERVAL '90 minutes') * 1000)::bigint,
    '電力',
    '電池電量低於安全閾值',
    'PMS05',
    false
  ),
  (
    'DEMO-EVT-005',
    'V003',
    'INTERLOCK_REQ',
    'CRITICAL',
    '通訊模組逾時',
    '{}'::jsonb,
    (EXTRACT(EPOCH FROM NOW() - INTERVAL '2 hours') * 1000)::bigint,
    '通訊',
    '通訊模組逾時',
    'PMS03',
    false
  ),
  (
    'DEMO-EVT-006',
    'V011',
    'UNSCHEDULED_DOOR_OPEN',
    'CRITICAL',
    '行駛中車門未關閉',
    '{}'::jsonb,
    (EXTRACT(EPOCH FROM NOW() - INTERVAL '3 hours') * 1000)::bigint,
    '線控',
    '行駛中車門未關閉',
    'PMS07',
    true
  ),
  (
    'DEMO-EVT-007',
    'C002',
    'OBSTACLE_DETECTED',
    'WARNING',
    '雷射雷達訊號品質下降',
    '{}'::jsonb,
    (EXTRACT(EPOCH FROM NOW() - INTERVAL '4 hours') * 1000)::bigint,
    '感測',
    '雷射雷達訊號品質下降',
    'PMS04',
    false
  ),
  (
    'DEMO-EVT-008',
    'I002',
    'SYSTEM_HEALTH_DEGRADED',
    'INFO',
    '運算模組溫度偏高',
    '{}'::jsonb,
    (EXTRACT(EPOCH FROM NOW() - INTERVAL '5 hours') * 1000)::bigint,
    '運算',
    '運算模組溫度偏高',
    'PMS06',
    true
  ),
  (
    'DEMO-EVT-009',
    'V009',
    'DIRECTION_VIOLATION',
    'WARNING',
    '偏離規劃路徑',
    '{}'::jsonb,
    (EXTRACT(EPOCH FROM NOW() - INTERVAL '6 hours') * 1000)::bigint,
    '調度',
    '偏離規劃路徑',
    'PMS08',
    false
  ),
  (
    'DEMO-EVT-010',
    'V012',
    'SYSTEM_HEALTH_DEGRADED',
    'INFO',
    '整備週期即將到期',
    '{}'::jsonb,
    (EXTRACT(EPOCH FROM NOW() - INTERVAL '8 hours') * 1000)::bigint,
    '整備',
    '整備週期即將到期',
    'PMS01',
    true
  );
