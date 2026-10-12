-- 權限管理：在既有 accounts / roles / permissions 上補正式 session 與刪除保護。
-- 可重複執行；不建立第二套使用者或角色主檔。

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until bigint,
  ADD COLUMN IF NOT EXISTS deleted_at bigint;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_name_ci
  ON accounts (lower(account_name));

ALTER TABLE account_roles
  ALTER COLUMN account_id TYPE uuid USING account_id::uuid,
  ALTER COLUMN role_id TYPE uuid USING role_id::uuid;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'account_roles'
      AND column_name = 'assigned_by' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE account_roles ALTER COLUMN assigned_by TYPE uuid USING
      CASE
        WHEN assigned_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN assigned_by::uuid
        ELSE NULL
      END;
  END IF;
END $$;
ALTER TABLE role_permissions
  ALTER COLUMN role_id TYPE uuid USING role_id::uuid,
  ALTER COLUMN permission_id TYPE uuid USING permission_id::uuid;

CREATE TABLE IF NOT EXISTS account_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  csrf_hash varchar(64) NOT NULL,
  source_ip varchar,
  user_agent text,
  expires_at bigint NOT NULL,
  created_at bigint NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
);

CREATE INDEX IF NOT EXISTS "IDX_ACCOUNT_SESSION_ACCOUNT" ON account_sessions(account_id);
CREATE INDEX IF NOT EXISTS "IDX_ACCOUNT_SESSION_EXPIRES" ON account_sessions(expires_at);

DO $$ BEGIN
  ALTER TABLE account_roles ADD CONSTRAINT fk_account_roles_account
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE account_roles ADD CONSTRAINT fk_account_roles_role
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE role_permissions ADD CONSTRAINT fk_role_permissions_role
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE role_permissions ADD CONSTRAINT fk_role_permissions_permission
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
