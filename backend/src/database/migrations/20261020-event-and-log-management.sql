-- 事件管理與日誌管理：在既有表上補欄位與索引（不建立第二套事件或稽核真相來源）。
--
-- security_event_logs：來源（VEHICLE／FACILITY／SYSTEM）、中心端衍生與否、發生時間有效性、人工確認欄位。
--   vehicle_code 改為可空，給沒有車號的設施／系統事件；既有列保持原值。
-- operator_action_logs：action_type 由 enum 改為 varchar（保留原值），補分類、目標、當時名稱快照與追蹤 ID。
-- permission_change_logs：補操作者／目標當時名稱與可查詢的相關帳號、角色。
-- login_logs：補時間＋ID 索引。
--
-- 舊資料只在可可靠判定時回填（例如分類由既有 action_type 決定）；當時名稱不追溯捏造，留空。
-- 可重跑：欄位與索引一律 IF NOT EXISTS，回填只處理仍為空的列。

-- ── 事件 ────────────────────────────────────────────────
ALTER TABLE security_event_logs ALTER COLUMN vehicle_code DROP NOT NULL;
ALTER TABLE security_event_logs ADD COLUMN IF NOT EXISTS source_type varchar(16) NOT NULL DEFAULT 'VEHICLE';
ALTER TABLE security_event_logs ADD COLUMN IF NOT EXISTS source_id varchar(64);
ALTER TABLE security_event_logs ADD COLUMN IF NOT EXISTS source_name_snapshot varchar(120);
ALTER TABLE security_event_logs ADD COLUMN IF NOT EXISTS origin varchar(16) NOT NULL DEFAULT 'REPORTED';
ALTER TABLE security_event_logs ADD COLUMN IF NOT EXISTS occurred_at_valid boolean;
ALTER TABLE security_event_logs ADD COLUMN IF NOT EXISTS acknowledged_by varchar(64);
ALTER TABLE security_event_logs ADD COLUMN IF NOT EXISTS acknowledged_by_name varchar(120);
ALTER TABLE security_event_logs ADD COLUMN IF NOT EXISTS acknowledged_at bigint;
ALTER TABLE security_event_logs ADD COLUMN IF NOT EXISTS acknowledgement_note varchar(500);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_EVENT_SOURCE_TYPE') THEN
    ALTER TABLE security_event_logs ADD CONSTRAINT "CHK_EVENT_SOURCE_TYPE" CHECK (source_type IN ('VEHICLE', 'FACILITY', 'SYSTEM'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_EVENT_ORIGIN') THEN
    ALTER TABLE security_event_logs ADD CONSTRAINT "CHK_EVENT_ORIGIN" CHECK (origin IN ('REPORTED', 'CENTER'));
  END IF;
  -- 載具事件一定要有車號；設施／系統事件不得偽造車號
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_EVENT_VEHICLE_SOURCE') THEN
    ALTER TABLE security_event_logs ADD CONSTRAINT "CHK_EVENT_VEHICLE_SOURCE" CHECK (source_type <> 'VEHICLE' OR vehicle_code IS NOT NULL);
  END IF;
END $$;

-- 既有列都是車端回報（或中心端依車端健康衍生）：來源就是那台車
UPDATE security_event_logs SET source_id = vehicle_code WHERE source_id IS NULL AND vehicle_code IS NOT NULL;
UPDATE security_event_logs SET origin = 'CENTER' WHERE event_code::text = 'SYSTEM_HEALTH_DEGRADED' AND origin = 'REPORTED';

CREATE INDEX IF NOT EXISTS "IDX_EVENT_TIME_ID" ON security_event_logs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS "IDX_EVENT_SOURCE_TIME" ON security_event_logs (source_type, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS "IDX_EVENT_CODE_TIME" ON security_event_logs (event_code, created_at DESC);

-- ── 系統／營運操作紀錄 ─────────────────────────────────
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'operator_action_logs' AND column_name = 'action_type') = 'USER-DEFINED' THEN
    ALTER TABLE operator_action_logs ALTER COLUMN action_type TYPE varchar(64) USING action_type::text;
  END IF;
END $$;
ALTER TABLE operator_action_logs ADD COLUMN IF NOT EXISTS category varchar(16);
ALTER TABLE operator_action_logs ADD COLUMN IF NOT EXISTS operator_name_snapshot varchar(120);
ALTER TABLE operator_action_logs ADD COLUMN IF NOT EXISTS target_type varchar(32);
ALTER TABLE operator_action_logs ADD COLUMN IF NOT EXISTS target_id varchar(128);
ALTER TABLE operator_action_logs ADD COLUMN IF NOT EXISTS target_name_snapshot varchar(200);
ALTER TABLE operator_action_logs ADD COLUMN IF NOT EXISTS correlation_id varchar(128);
ALTER TABLE operator_action_logs ADD COLUMN IF NOT EXISTS user_agent varchar(300);

-- 分類只依既有 action_type 判定（對照表見 audit-catalog.ts）
UPDATE operator_action_logs SET category = 'OPERATIONS'
 WHERE category IS NULL AND action_type IN ('COMMAND_DISPATCH', 'ORDER_CREATE', 'ORDER_UPDATE', 'ORDER_CANCEL', 'SPEED_LIMIT_SET', 'DIRECTION_CHANGE');
UPDATE operator_action_logs SET category = 'SYSTEM'
 WHERE category IS NULL AND action_type IN ('VEHICLE_REGISTER', 'VEHICLE_UPDATE', 'VEHICLE_SERVICE_SETTING', 'VEHICLE_REMOVE');
UPDATE operator_action_logs SET target_type = 'VEHICLE', target_id = target_vehicle
 WHERE target_type IS NULL AND target_vehicle IS NOT NULL AND target_vehicle <> '';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_ACTION_CATEGORY') THEN
    ALTER TABLE operator_action_logs ADD CONSTRAINT "CHK_ACTION_CATEGORY" CHECK (category IS NULL OR category IN ('SYSTEM', 'OPERATIONS'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_ACTION_CATEGORY_TIME" ON operator_action_logs (category, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS "IDX_ACTION_TIME_ID" ON operator_action_logs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS "IDX_ACTION_TARGET_TIME" ON operator_action_logs (target_type, target_id, created_at DESC);

-- ── 權限異動 ───────────────────────────────────────────
ALTER TABLE permission_change_logs ADD COLUMN IF NOT EXISTS operator_name_snapshot varchar(120);
ALTER TABLE permission_change_logs ADD COLUMN IF NOT EXISTS target_name_snapshot varchar(200);
ALTER TABLE permission_change_logs ADD COLUMN IF NOT EXISTS related_account_id varchar(64);
ALTER TABLE permission_change_logs ADD COLUMN IF NOT EXISTS related_role_ids varchar(64)[] NOT NULL DEFAULT '{}';

-- 相關帳號／角色可由既有欄位可靠判定（目標本身，或異動內容中的 role_ids）
UPDATE permission_change_logs SET related_account_id = target_id
 WHERE related_account_id IS NULL AND target_type::text IN ('ACCOUNT', 'ACCOUNT_ROLE');
UPDATE permission_change_logs SET related_role_ids = ARRAY[target_id]
 WHERE related_role_ids = '{}' AND target_type::text IN ('ROLE', 'ROLE_PERMISSION');
UPDATE permission_change_logs p SET related_role_ids = sub.ids
  FROM (
    SELECT id, ARRAY(
      SELECT DISTINCT v FROM (
        SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(before_value -> 'role_ids') = 'array' THEN before_value -> 'role_ids' ELSE '[]'::jsonb END)
        UNION
        SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(after_value -> 'role_ids') = 'array' THEN after_value -> 'role_ids' ELSE '[]'::jsonb END)
      ) x(v)
    )::varchar(64)[] AS ids
    FROM permission_change_logs
    WHERE target_type::text IN ('ACCOUNT', 'ACCOUNT_ROLE')
  ) sub
 WHERE p.id = sub.id AND p.related_role_ids = '{}' AND cardinality(sub.ids) > 0;

CREATE INDEX IF NOT EXISTS "IDX_PERM_CHANGE_TIME_ID" ON permission_change_logs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS "IDX_PERM_CHANGE_ACCOUNT_TIME" ON permission_change_logs (related_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS "IDX_PERM_CHANGE_ROLES" ON permission_change_logs USING gin (related_role_ids);
CREATE INDEX IF NOT EXISTS "IDX_PERM_CHANGE_OPERATOR_TIME" ON permission_change_logs (operator_id, created_at DESC);

-- ── 登入登出 ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "IDX_LOGIN_TIME_ID" ON login_logs (created_at DESC, id DESC);
