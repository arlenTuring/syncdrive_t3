-- 資料保存：事件紀錄獨立成一類（原本與指令同屬「其他大量紀錄」），可分開設定保存期限。
-- 已發布的 20261020 不再修改（避免已套用環境的 ledger 校驗不符），所以另開這支。可重跑。
-- 預設不啟用自動清理；原「其他大量紀錄」政策之後不再刪事件（保留期只會變長，不會誤刪）。
DO $$
BEGIN
  IF to_regclass('public.data_retention_policies') IS NOT NULL THEN
    INSERT INTO data_retention_policies(category, enabled, retention_value, retention_unit, interval_minutes, updated_at)
    VALUES ('security_events', false, 365, 'day', 1440, (extract(epoch from now()) * 1000)::bigint)
    ON CONFLICT (category) DO NOTHING;
  END IF;
END $$;
