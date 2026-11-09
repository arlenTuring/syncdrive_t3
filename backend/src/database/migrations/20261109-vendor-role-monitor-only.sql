-- 廠商角色（VENDOR）只保留數據監控模組的檢視權限，其他模組全部收回。
-- 舊版預設給了除權限／系統／日誌以外所有模組的檢視權限；角色建立後程式不再覆蓋，
-- 所以已部署的資料庫要在這裡改。沒有廠商角色時不做事。可重複執行。
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id AND rp.permission_id = p.id
  AND r.role_code = 'VENDOR'
  AND p.permission_code NOT IN ('dashboard.monitor.view', 'dashboard.dashboard.view');

INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
FROM roles r
JOIN permissions p ON p.permission_code IN ('dashboard.monitor.view', 'dashboard.dashboard.view')
WHERE r.role_code = 'VENDOR'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id
  );
