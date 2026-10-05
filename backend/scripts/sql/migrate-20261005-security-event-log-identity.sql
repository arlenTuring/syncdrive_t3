-- security_event_logs：內部識別與車端原始 event_id 分開（2026-10-05）
--
-- 原本 event_id 是主鍵。協議的 event_id 是 EVT-YYYYMMDD-NNNN「每日重置的四位數流水號」，
-- 不同車會用到同一個號碼；加上寫入用 save，撞號時後到的會「更新」掉另一台車的告警。
-- 改成：
--   id          bigint 自動編號，主鍵（中心端內部識別）
--   event_id    車端原始值，原樣保留，不唯一
--   dedup_key   車號|event_id|車端 timestamp，唯一（同一則重送不重複新增）
--   received_at 中心端收到的時間（稽核用，不參與去重）
--
-- 跟 TypeORM synchronize 依新實體產生的結構完全相同（主鍵名稱也一樣），所以：
-- - 先跑這支再啟動新版後端：synchronize 看到結構已一致，不會再動。
-- - 已經被 synchronize 改過（本機開發機的情況）：這支只補做回填與備份，其餘略過。
-- 可以重複執行。既有資料一列都不刪。

BEGIN;

-- 0. 備份（已存在就不覆蓋）
CREATE TABLE IF NOT EXISTS security_event_logs_backup_20261005 AS TABLE security_event_logs;

-- 1. 新欄位
ALTER TABLE security_event_logs ADD COLUMN IF NOT EXISTS id BIGSERIAL;
ALTER TABLE security_event_logs ADD COLUMN IF NOT EXISTS dedup_key varchar;
ALTER TABLE security_event_logs ADD COLUMN IF NOT EXISTS received_at bigint;

-- 2. 主鍵從 event_id 換成 id（主鍵已經是 id 就略過）
DO $$
DECLARE
  pk_name text;
  pk_cols text;
BEGIN
  SELECT c.conname, string_agg(a.attname, ',' ORDER BY a.attnum)
    INTO pk_name, pk_cols
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'security_event_logs'::regclass AND c.contype = 'p'
  GROUP BY c.conname;

  IF pk_cols IS DISTINCT FROM 'id' THEN
    IF pk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE security_event_logs DROP CONSTRAINT %I', pk_name);
    END IF;
    ALTER TABLE security_event_logs ADD CONSTRAINT "PK_2a54cdfac26726768b2d4ea6ca9" PRIMARY KEY (id);
  END IF;
END $$;

-- 3. 回填舊資料的去重鍵。舊資料的 created_at 就是車端 timestamp（沒帶時才是收到時間）；
--    舊主鍵保證 event_id 唯一，所以回填後不會撞到唯一索引。
UPDATE security_event_logs
SET dedup_key = vehicle_code || '|' || event_id || '|' || created_at::text
WHERE dedup_key IS NULL;

-- 4. 索引（名稱與實體 @Index 相同）
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_EVENT_DEDUP_KEY" ON security_event_logs (dedup_key);
CREATE INDEX IF NOT EXISTS "IDX_EVENT_VEHICLE_EVENT_ID" ON security_event_logs (vehicle_code, event_id);

COMMIT;

-- 核對（唯讀）：列數應與備份相同，dedup_key 不應有 NULL
SELECT (SELECT count(*) FROM security_event_logs) AS rows_now,
       (SELECT count(*) FROM security_event_logs_backup_20261005) AS rows_backup,
       (SELECT count(*) FROM security_event_logs WHERE dedup_key IS NULL) AS missing_dedup_key;
