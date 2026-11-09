-- 事件類型管理：每個事件類型代碼的名稱、嚴重等級與建議處置 SOP。
-- 事件本身的嚴重度照來源回報，不受這裡影響；這裡只負責命名與告訴值班人員怎麼處理。
-- 可重複執行；內建代碼只在表格是空的時候寫入一次，之後可改名或刪除。
CREATE TABLE IF NOT EXISTS event_type_definitions (
  code varchar(64) PRIMARY KEY CHECK (code ~ '^[A-Za-z0-9_]{1,64}$'),
  name varchar(64) NOT NULL,
  severity varchar(16) NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  sop_text varchar(100),
  sop_url varchar(500),
  sort_order integer NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  updated_by varchar(64)
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_EVENT_TYPE_CODE_UPPER" ON event_type_definitions (upper(code));

INSERT INTO event_type_definitions (code, name, severity, sort_order, created_at, updated_at)
SELECT seed.code, seed.name, seed.severity, seed.sort_order,
       (extract(epoch FROM now()) * 1000)::bigint, (extract(epoch FROM now()) * 1000)::bigint
  FROM (VALUES
    ('UNSCHEDULED_DOOR_OPEN', '非預期開門', 'CRITICAL', 1),
    ('OBSTACLE_DETECTED', '偵測到障礙物', 'WARNING', 2),
    ('PATH_BLOCKED', '路徑受阻', 'CRITICAL', 3),
    ('DIRECTION_VIOLATION', '行向偏離', 'WARNING', 4),
    ('INTERLOCK_REQ', '路口聯鎖請求', 'INFO', 5),
    ('SYSTEM_HEALTH_DEGRADED', '車載系統健康度下降', 'WARNING', 6),
    ('TRIP_DELAYED', '班車延誤', 'WARNING', 7),
    ('SYSTEM_BACKUP_FAILED', '自動備份失敗', 'WARNING', 8)
  ) AS seed(code, name, severity, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM event_type_definitions);
