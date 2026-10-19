-- 虛擬圍籬管理由「營運管理模組」移到「場域管理模組」：
-- 權限代碼 operations.virtual-fence.* 改為 site.virtual-fence.*，已授予的角色權限保留。
--
-- 權限字典由 access.constants.ts 在後端啟動時以 permission_code upsert：
-- - 新代碼尚不存在（正常部署：migration 先於新版啟動）：舊列就地改名，role_permissions 不動。
-- - 新代碼已存在（新版先啟動過，例如開發環境）：把角色授權搬到新代碼後刪除舊代碼。
-- 可重跑；沒有舊代碼時不做任何事。

DO $$
DECLARE
  action text;
  old_id uuid;
  new_id uuid;
BEGIN
  FOREACH action IN ARRAY ARRAY['view', 'create', 'edit', 'delete'] LOOP
    SELECT id INTO old_id FROM permissions WHERE permission_code = 'operations.virtual-fence.' || action;
    CONTINUE WHEN old_id IS NULL;
    SELECT id INTO new_id FROM permissions WHERE permission_code = 'site.virtual-fence.' || action;
    IF new_id IS NULL THEN
      UPDATE permissions
         SET permission_code = 'site.virtual-fence.' || action, module = '場域管理模組'
       WHERE id = old_id;
    ELSE
      INSERT INTO role_permissions (role_id, permission_id, created_at)
      SELECT role_id, new_id, created_at FROM role_permissions WHERE permission_id = old_id
      ON CONFLICT (role_id, permission_id) DO NOTHING;
      DELETE FROM role_permissions WHERE permission_id = old_id;
      DELETE FROM permissions WHERE id = old_id;
    END IF;
  END LOOP;
END $$;
