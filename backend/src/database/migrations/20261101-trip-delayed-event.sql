-- 班車延誤事件（班表部署管理的班車延誤監督，中心端判定）
ALTER TYPE security_event_logs_event_code_enum ADD VALUE IF NOT EXISTS 'TRIP_DELAYED';
