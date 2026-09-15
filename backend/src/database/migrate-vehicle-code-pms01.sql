-- 車輛代號去連字號：PMS-01 → PMS01
--
-- 舊版《MQTT 通訊架構與 Topic 命名規範》寫 PMS01，中間一版誤植成 PMS-01，本系統照
-- 誤植的那版實作。車端廠商比對時問出來，確認連字號是誤勘。MQTT 的 topic 與 broker
-- ACL 都是字串比對，差一個字元整條路徑就被拒，所以資料庫也一次改乾淨，不留兩套寫法。
--
-- 掃全部 public schema 的文字與 jsonb 欄位：代號不只存在 vehicle_code，也埋在
-- 儀表板平面設定、載具樣板的 mqttTopic、訂單 payload 裡。逐張表列舉一定會漏。
--
-- 只換兩位數那種（PMS-01 ~ PMS-11），外加儀表板元件存的 SQL 裡那句 LIKE 'PMS-%'。
-- 圖台軌跡檔用的是另一套三位數代號（PMS-001，對應
-- public/trajectories/vehicles/PMS-001.json），改了會找不到檔案，所以不動。
--
-- 冪等：已經是 PMS01 的不符合樣式，重跑不會再動。
--
-- telemetry_logs 跳過：那是 TimescaleDB 超表，舊分塊已壓縮不能 UPDATE；而且
-- shouldPersistTelemetry 本來就不寫 PMS 車隊的遙測（只留場域設施），裡面沒有車輛代號。

-- 先清掉會撞主鍵的舊列。
--
-- 有些表（示範資料）同時存著兩種寫法：改名前後各 seed 過一次。直接 UPDATE 會踩
-- unique violation 讓整個交易回滾。新寫法那一列才是要留的，舊的刪掉。
-- 只處理 vehicle_code 自己就是唯一鍵的表，複合鍵的表不會相撞。
DO $$
DECLARE
  t RECORD;
  removed BIGINT;
BEGIN
  FOR t IN
    SELECT DISTINCT cls.relname AS table_name
    FROM pg_index idx
    JOIN pg_class cls ON cls.oid = idx.indrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN pg_attribute att
      ON att.attrelid = cls.oid AND att.attnum = idx.indkey[0]
    WHERE ns.nspname = 'public'
      AND idx.indisunique
      AND array_length(idx.indkey::int[], 1) = 1
      AND att.attname = 'vehicle_code'
  LOOP
    EXECUTE format(
      'DELETE FROM public.%I old WHERE old.vehicle_code LIKE ''PMS-%%'' '
      || 'AND EXISTS (SELECT 1 FROM public.%I nw WHERE nw.vehicle_code = '
      || 'regexp_replace(old.vehicle_code, ''PMS-(\d{2})(?!\d)'', ''PMS\1''))',
      t.table_name, t.table_name
    );
    GET DIAGNOSTICS removed = ROW_COUNT;
    IF removed > 0 THEN
      RAISE NOTICE '% 刪掉 % 列改名前的重複資料', t.table_name, removed;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  col RECORD;
  updated BIGINT;
  total BIGINT := 0;
BEGIN
  FOR col IN
    SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('text', 'character varying', 'character', 'jsonb', 'json')
      AND c.table_name <> 'telemetry_logs'
    ORDER BY c.table_name, c.column_name
  LOOP
    IF col.data_type IN ('jsonb', 'json') THEN
      EXECUTE format(
        'UPDATE public.%I SET %I = replace('
        || 'regexp_replace(%I::text, ''PMS-(\d{2})(?!\d)'', ''PMS\1'', ''g''), ''PMS-%%'', ''PMS%%'''
        || ')::%s WHERE %I::text LIKE ''%%PMS-%%''',
        col.table_name, col.column_name, col.column_name, col.data_type, col.column_name
      );
    ELSE
      EXECUTE format(
        'UPDATE public.%I SET %I = replace('
        || 'regexp_replace(%I, ''PMS-(\d{2})(?!\d)'', ''PMS\1'', ''g''), ''PMS-%%'', ''PMS%%'''
        || ') WHERE %I LIKE ''%%PMS-%%''',
        col.table_name, col.column_name, col.column_name, col.column_name
      );
    END IF;
    GET DIAGNOSTICS updated = ROW_COUNT;
    IF updated > 0 THEN
      total := total + updated;
      RAISE NOTICE '%.% → % 列', col.table_name, col.column_name, updated;
    END IF;
  END LOOP;
  RAISE NOTICE '合計 % 列', total;
END $$;
