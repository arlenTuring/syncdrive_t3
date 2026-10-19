#!/usr/bin/env bash
# Run ordered, checksummed SQL migrations without starting the application.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORDER_FILE="${MIGRATION_ORDER_FILE:-$ROOT/deploy/migrations/order.txt}"
DOCKER="${DOCKER:-docker}"
DB_CONTAINER="${DB_CONTAINER:-syncdrive_postgres}"
MODE=run

case "${1:-}" in
  --validate) MODE=validate ;;
  --plan) MODE=plan ;;
  --verify) MODE=verify ;;
  "") ;;
  *) echo "用法：$0 [--validate|--plan|--verify]" >&2; exit 2 ;;
esac

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else LC_ALL=C shasum -a 256 "$1" | awk '{print $1}'
  fi
}

psql_in() {
  if [ -n "${DB_NAME_OVERRIDE:-}" ]; then
    $DOCKER exec -i -e "POSTGRES_DB=$DB_NAME_OVERRIDE" "$DB_CONTAINER" sh -c \
      'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  else
    $DOCKER exec -i "$DB_CONTAINER" sh -c \
      'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  fi
}

psql_in_transaction() {
  if [ -n "${DB_NAME_OVERRIDE:-}" ]; then
    $DOCKER exec -i -e "POSTGRES_DB=$DB_NAME_OVERRIDE" "$DB_CONTAINER" sh -c \
      'psql -X -q -At -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  else
    $DOCKER exec -i "$DB_CONTAINER" sh -c \
      'psql -X -q -At -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  fi
}

validate_order() {
  local listed="$1" duplicates missing extra before after
  listed="$(sed -e 's/[[:space:]]*$//' -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' "$ORDER_FILE")"
  duplicates="$(printf '%s\n' "$listed" | sort | uniq -d)"
  [ -z "$duplicates" ] || { printf 'Migration 順序表有重複：\n%s\n' "$duplicates" >&2; return 1; }

  while IFS= read -r relative; do
    case "$relative" in /*) file="$relative" ;; *) file="$ROOT/$relative" ;; esac
    [ -f "$file" ] || { echo "Migration 不存在：$relative" >&2; return 1; }
  done <<< "$listed"

  if [ "$ORDER_FILE" = "$ROOT/deploy/migrations/order.txt" ]; then
    missing="$(
      { find "$ROOT/backend/src/database/migrations" -maxdepth 1 -type f -name '*.sql' -print
        find "$ROOT/deploy/migrations" -maxdepth 1 -type f -name '*.sql' -print; } \
        | sed "s#^$ROOT/##" | sort | comm -23 - <(printf '%s\n' "$listed" | sort)
    )"
    extra="$(printf '%s\n' "$listed" | sort | comm -13 <(
      { find "$ROOT/backend/src/database/migrations" -maxdepth 1 -type f -name '*.sql' -print
        find "$ROOT/deploy/migrations" -maxdepth 1 -type f -name '*.sql' -print; } | sed "s#^$ROOT/##" | sort
    ) -)"
    [ -z "$missing" ] || { printf '有部署 Migration 未登錄：\n%s\n' "$missing" >&2; return 1; }
    [ -z "$extra" ] || { printf '順序表含非部署 Migration：\n%s\n' "$extra" >&2; return 1; }
  fi

  assert_before() {
    before="$(printf '%s\n' "$listed" | nl -ba | awk -v f="$1" '$2==f{print $1}')"
    after="$(printf '%s\n' "$listed" | nl -ba | awk -v f="$2" '$2==f{print $1}')"
    [ -n "$before" ] && [ -n "$after" ] || return 0
    [ -n "$before" ] && [ -n "$after" ] && [ "$before" -lt "$after" ] || {
      echo "Migration 依賴順序錯誤：$1 必須先於 $2" >&2; return 1;
    }
  }
  assert_before deploy/migrations/20261008-required-extensions.sql backend/src/database/migrations/20261018-media-play-schedules.sql
  assert_before backend/src/database/migrations/20261009-create-degraded-operation-plans.sql backend/src/database/migrations/20261010-create-degraded-replay.sql
  assert_before backend/src/database/migrations/20261010-create-degraded-replay.sql backend/src/database/migrations/20261010-vehicle-model-management.sql
  assert_before backend/src/database/migrations/20261011-access-control.sql backend/src/database/migrations/20261012-role-permissions.sql
  assert_before backend/src/database/migrations/20261012-role-permissions.sql backend/src/database/migrations/20261019-virtual-fence-site-permissions.sql
  assert_before backend/src/database/migrations/20261011-access-control.sql backend/src/database/migrations/20261020-event-and-log-management.sql
  assert_before backend/src/database/migrations/20261015-data-retention-management.sql backend/src/database/migrations/20261021-security-event-retention.sql
  assert_before backend/src/database/migrations/20261010-create-degraded-replay.sql backend/src/database/migrations/20261015-vehicle-run-history.sql
  assert_before backend/src/database/migrations/20261015-vehicle-run-history.sql backend/src/database/migrations/20261015-data-retention-management.sql
}

schema_preflight() {
  local missing inconsistent
  missing="$(psql_in <<'SQL'
WITH required(kind, name, present) AS (
  VALUES
    ('table','vehicles',to_regclass('public.vehicles') IS NOT NULL),
    ('table','partner_api_keys',to_regclass('public.partner_api_keys') IS NOT NULL),
    ('table','vehicle_definitions',to_regclass('public.vehicle_definitions') IS NOT NULL),
    ('table','accounts',to_regclass('public.accounts') IS NOT NULL),
    ('table','roles',to_regclass('public.roles') IS NOT NULL),
    ('table','permissions',to_regclass('public.permissions') IS NOT NULL),
    ('table','account_roles',to_regclass('public.account_roles') IS NOT NULL),
    ('table','role_permissions',to_regclass('public.role_permissions') IS NOT NULL),
    ('table','vehicle_monitor_demo',to_regclass('public.vehicle_monitor_demo') IS NOT NULL),
    ('table','telemetry_logs',to_regclass('public.telemetry_logs') IS NOT NULL),
    ('table','operation_orders',to_regclass('public.operation_orders') IS NOT NULL),
    ('table','order_action_states',to_regclass('public.order_action_states') IS NOT NULL),
    ('table','media_library_items',to_regclass('public.media_library_items') IS NOT NULL),
    ('table','security_event_logs',to_regclass('public.security_event_logs') IS NOT NULL),
    ('table','operator_action_logs',to_regclass('public.operator_action_logs') IS NOT NULL),
    ('table','permission_change_logs',to_regclass('public.permission_change_logs') IS NOT NULL),
    ('table','login_logs',to_regclass('public.login_logs') IS NOT NULL)
)
SELECT string_agg(kind || ':' || name, ', ' ORDER BY kind, name) FROM required WHERE NOT present;
SQL
)"
  [ -z "$missing" ] || { echo "目標舊版 schema 缺少必要前置物件：$missing" >&2; return 1; }
  [ "$ledger_exists" = true ] || return 0
  inconsistent="$(psql_in <<'SQL'
WITH checks(migration_id, valid) AS (
  VALUES
    ('backend/src/database/migrations/20261010-create-degraded-replay.sql', to_regclass('public.degraded_replay_sessions') IS NOT NULL),
    ('backend/src/database/migrations/20261014-vehicle-registration.sql', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicles' AND column_name='initial_mileage_km')),
    ('backend/src/database/migrations/20261015-vehicle-run-history.sql', to_regclass('public.vehicle_history_frames') IS NOT NULL AND to_regclass('public.vehicle_history_gaps') IS NOT NULL),
    ('backend/src/database/migrations/20261015-data-retention-management.sql', to_regclass('public.data_retention_policies') IS NOT NULL AND to_regclass('public.data_cleanup_jobs') IS NOT NULL),
    ('backend/src/database/migrations/20261017-media-group-version.sql', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='media_library_items' AND column_name='row_version')),
    ('backend/src/database/migrations/20261018-media-play-schedules.sql', to_regclass('public.media_play_schedules') IS NOT NULL),
    ('backend/src/database/migrations/20261019-virtual-fence-site-permissions.sql', NOT EXISTS(SELECT 1 FROM permissions WHERE permission_code LIKE 'operations.virtual-fence.%')),
    ('backend/src/database/migrations/20261020-event-and-log-management.sql', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='security_event_logs' AND column_name='acknowledged_at') AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='operator_action_logs' AND column_name='category')),
    ('backend/src/database/migrations/20261021-security-event-retention.sql', to_regclass('public.data_retention_policies') IS NULL OR EXISTS(SELECT 1 FROM data_retention_policies WHERE category='security_events'))
)
SELECT string_agg(c.migration_id, ', ' ORDER BY c.migration_id)
FROM checks c JOIN syncdrive_schema_migrations m USING(migration_id)
WHERE NOT c.valid;
SQL
)"
  [ -z "$inconsistent" ] || { echo "Migration ledger 與實際結構矛盾：$inconsistent" >&2; return 1; }
}

verify_required_schema() {
  local missing
  missing="$(psql_in <<'SQL'
WITH required(name, present) AS (
  VALUES
    ('vehicles.vehicle_code varchar(64)', COALESCE((SELECT character_maximum_length >= 64 FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicles' AND column_name='vehicle_code'), false)),
    ('vehicles.initial_mileage_km', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicles' AND column_name='initial_mileage_km')),
    ('vehicle_history_frames', to_regclass('public.vehicle_history_frames') IS NOT NULL),
    ('vehicle_history_gaps', to_regclass('public.vehicle_history_gaps') IS NOT NULL),
    ('data_retention_policies', to_regclass('public.data_retention_policies') IS NOT NULL),
    ('data_cleanup_jobs', to_regclass('public.data_cleanup_jobs') IS NOT NULL),
    ('media_play_schedules', to_regclass('public.media_play_schedules') IS NOT NULL),
    ('uuid-ossp extension', EXISTS(SELECT 1 FROM pg_extension WHERE extname='uuid-ossp')),
    ('vehicle_history_order_change trigger', EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='vehicle_history_order_change' AND NOT tgisinternal)),
    ('vehicle_history_order_action_change trigger', EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='vehicle_history_order_action_change' AND NOT tgisinternal)),
    ('IDX_TELEMETRY_RECEIVED index', to_regclass('public."IDX_TELEMETRY_RECEIVED"') IS NOT NULL)
)
SELECT string_agg(name, ', ' ORDER BY name) FROM required WHERE NOT present;
SQL
)"
  [ -z "$missing" ] || { echo "Migration 完成但必要結構缺少：$missing" >&2; return 1; }
}

[ -f "$ORDER_FILE" ] || { echo "找不到 migration 順序表：$ORDER_FILE" >&2; exit 1; }
validate_order "$ORDER_FILE"
[ "$MODE" = validate ] && { echo "Migration 順序與清單驗證通過"; exit 0; }

ledger_exists=false
if [ "$MODE" = run ]; then
  psql_in <<'SQL'
CREATE TABLE IF NOT EXISTS syncdrive_schema_migrations (
  migration_id varchar(200) PRIMARY KEY,
  checksum char(64) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL
  ledger_exists=true
elif [ "$(psql_in <<'SQL'
SELECT CASE WHEN to_regclass('public.syncdrive_schema_migrations') IS NULL THEN 'false' ELSE 'true' END;
SQL
)" = true ]; then
  ledger_exists=true
fi
[ "$MODE" = plan ] && schema_preflight

pending=0
while IFS= read -r relative || [ -n "$relative" ]; do
  case "$relative" in ""|'#'*) continue ;; esac
  case "$relative" in /*) file="$relative" ;; *) file="$ROOT/$relative" ;; esac
  [ -f "$file" ] || { echo "Migration 不存在：$relative" >&2; exit 1; }
  checksum="$(hash_file "$file")"
  recorded=""
  if [ "$ledger_exists" = true ]; then
    escaped="${relative//\'/\'\'}"
    recorded="$(psql_in <<<"SELECT checksum FROM syncdrive_schema_migrations WHERE migration_id='$escaped';")"
  fi
  if [ -n "$recorded" ]; then
    [ "$recorded" = "$checksum" ] || {
      echo "Migration 已執行後遭修改：$relative" >&2
      echo "資料庫：$recorded" >&2
      echo "檔案：  $checksum" >&2
      exit 1
    }
    printf '  = %s\n' "$relative"
    continue
  fi
  pending=$((pending + 1))
  printf '  + %s\n' "$relative"
  [ "$MODE" = plan ] && continue
  [ "$MODE" = verify ] && { echo "尚有未執行 Migration：$relative" >&2; exit 1; }
  if grep -Eq '^[[:space:]]*(BEGIN|START[[:space:]]+TRANSACTION)[[:space:]]*;' "$file"; then
    echo "    自管交易；SQL 成功後另記 ledger：$relative"
    if ! psql_in < "$file"; then
      echo "Migration 失敗：$relative" >&2
      exit 1
    fi
    psql_in <<<"INSERT INTO syncdrive_schema_migrations(migration_id, checksum) VALUES ('$escaped', '$checksum');"
  elif ! { cat "$file"; printf "\nINSERT INTO syncdrive_schema_migrations(migration_id, checksum) VALUES ('%s', '%s');\n" "$escaped" "$checksum"; } | psql_in_transaction; then
    echo "Migration 失敗：$relative" >&2
    exit 1
  fi
done < "$ORDER_FILE"

if { [ "$MODE" = run ] || [ "$MODE" = verify ]; } \
  && [ "$ORDER_FILE" = "$ROOT/deploy/migrations/order.txt" ]; then
  verify_required_schema
fi

printf 'Migration：%s（待執行 %d）\n' "$MODE" "$pending"
