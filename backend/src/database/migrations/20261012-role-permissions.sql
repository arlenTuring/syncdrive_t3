-- 角色名稱需可直接供帳號頁識別；先拒絕既有衝突，絕不自動刪除或合併資料。
-- 權限字典由 backend/src/access-control/access.constants.ts 於啟動時以 permission_code upsert，
-- 讓 API、Guard 與 seed 共用唯一來源；SUPER_ADMIN 會補齊，其他角色不會被重設。

DO $$
DECLARE conflicts text;
BEGIN
  SELECT string_agg(format('%s (%s 筆)', display_name, amount), '、') INTO conflicts
  FROM (
    SELECT min(display_name) AS display_name, count(*) AS amount
    FROM roles GROUP BY lower(btrim(display_name)) HAVING count(*) > 1
  ) duplicated;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION '角色名稱重複，請先人工處理：%', conflicts;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_display_name_ci
  ON roles (lower(btrim(display_name)));

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_roles_pair
  ON account_roles (account_id, role_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_pair
  ON role_permissions (role_id, permission_id);
