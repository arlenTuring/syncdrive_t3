#!/usr/bin/env bash
# Destructive checks run only against explicitly named disposable databases.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKER="${DOCKER:-docker}"
CONTAINER="${DB_CONTAINER:-syncdrive_postgres}"
SOURCE_DB="${SOURCE_DB:-syncdrive_t3}"
PREFIX="syncdrive_deploy_test_${$}"
LEGACY_DB="${PREFIX}_legacy"
MID_DB="${PREFIX}_mid"
PARTIAL_DB="${PREFIX}_partial"
RESTORE_DB="${PREFIX}_restore"
DATA_DB="${PREFIX}_data"
WORK="$(mktemp -d)"

cleanup() {
  for db in "$LEGACY_DB" "$MID_DB" "$PARTIAL_DB" "$RESTORE_DB" "$DATA_DB"; do
    $DOCKER exec "$CONTAINER" sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$1"' sh "$db" >/dev/null 2>&1 || true
  done
  $DOCKER exec "$CONTAINER" rm -f /tmp/sync-flow.dump >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

db_create() { $DOCKER exec "$CONTAINER" sh -c 'createdb -U "$POSTGRES_USER" "$1"' sh "$1"; }
db_psql() {
  local db="$1"; shift
  $DOCKER exec -i "$CONTAINER" sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"' sh "$db" "$@"
}
load_legacy() { db_create "$1"; db_psql "$1" < "$ROOT/deploy/tests/fixtures/legacy-schema.sql"; }
run_migrations() {
  local db="$1" order="${2:-$ROOT/deploy/migrations/order.txt}" mode="${3:-}"
  if [ -n "$mode" ]; then
    DOCKER="$DOCKER" DB_CONTAINER="$CONTAINER" DB_NAME_OVERRIDE="$db" \
      MIGRATION_ORDER_FILE="$order" "$ROOT/deploy/migrate.sh" "$mode"
  else
    DOCKER="$DOCKER" DB_CONTAINER="$CONTAINER" DB_NAME_OVERRIDE="$db" \
      MIGRATION_ORDER_FILE="$order" "$ROOT/deploy/migrate.sh"
  fi
}

echo "[1/9] 驗證順序表完整、無重複且依賴順序正確"
"$ROOT/deploy/migrate.sh" --validate >/dev/null
cp "$ROOT/deploy/migrations/order.txt" "$WORK/wrong-order.txt"
python3 - "$WORK/wrong-order.txt" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
a = 'backend/src/database/migrations/20261015-vehicle-run-history.sql'
b = 'backend/src/database/migrations/20261015-data-retention-management.sql'
s = s.replace(a, '__A__').replace(b, a).replace('__A__', b)
p.write_text(s)
PY
if MIGRATION_ORDER_FILE="$WORK/wrong-order.txt" "$ROOT/deploy/migrate.sh" --validate >/dev/null 2>&1; then
  echo "排錯依賴順序時驗證不應通過" >&2; exit 1
fi

echo "[2/9] 從真正舊版結構升級並保留11台車、訂單與設定"
load_legacy "$LEGACY_DB"
run_migrations "$LEGACY_DB" >/dev/null
run_migrations "$LEGACY_DB" | grep -q '待執行 0'
run_migrations "$LEGACY_DB" "$ROOT/deploy/migrations/order.txt" --verify >/dev/null
legacy_check="$(db_psql "$LEGACY_DB" <<'SQL'
SELECT
  (SELECT character_maximum_length FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicles' AND column_name='vehicle_code'),
  (SELECT count(*) FROM vehicles WHERE display_name LIKE '舊版車輛 %'),
  (SELECT count(DISTINCT id) FROM vehicles WHERE display_name LIKE '舊版車輛 %'),
  (SELECT count(*) FROM operation_orders WHERE order_id='LEGACY-ORDER-1'),
  (SELECT count(*) FROM data_sources WHERE source_key='legacy-source'),
  to_regclass('public.vehicle_history_frames') IS NOT NULL,
  to_regclass('public.vehicle_history_gaps') IS NOT NULL,
  to_regclass('public.data_retention_policies') IS NOT NULL,
  to_regclass('public.data_cleanup_jobs') IS NOT NULL,
  EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='vehicle_history_order_change'),
  EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='IDX_TELEMETRY_RECEIVED');
SQL
)"
[ "$legacy_check" = '64|11|11|1|1|t|t|t|t|t|t' ] || { echo "舊版升級驗證失敗：$legacy_check" >&2; exit 1; }

echo "[3/9] 歷史已完成、保留政策未完成的中間狀態可續跑"
load_legacy "$MID_DB"
awk '/20261015-data-retention-management.sql/{exit} {print}' "$ROOT/deploy/migrations/order.txt" > "$WORK/mid-order.txt"
run_migrations "$MID_DB" "$WORK/mid-order.txt" >/dev/null
[ "$(db_psql "$MID_DB" <<<'SELECT to_regclass($$public.vehicle_history_gaps$$) IS NOT NULL, to_regclass($$public.data_retention_policies$$) IS NULL;')" = 't|t' ]
run_migrations "$MID_DB" >/dev/null
run_migrations "$MID_DB" "$ROOT/deploy/migrations/order.txt" --verify >/dev/null

echo "[4/9] 已有部分物件但無ledger時可安全補齊"
load_legacy "$PARTIAL_DB"
db_psql "$PARTIAL_DB" <<'SQL'
CREATE TABLE vehicle_history_frames (
  seq bigserial PRIMARY KEY, stream varchar(16) NOT NULL, stream_key varchar(260) NOT NULL,
  vehicle_code varchar(64), topic varchar(200), order_id varchar(120), received_at bigint NOT NULL,
  operating_at bigint, clock_run varchar(120), vehicle_ts bigint, source varchar(8) NOT NULL,
  payload jsonb NOT NULL, derived jsonb
);
CREATE TABLE vehicle_history_gaps (
  id bigserial PRIMARY KEY, segment_id bigint, from_real bigint NOT NULL, to_real bigint NOT NULL,
  from_operating bigint, to_operating bigint, reason varchar(24) NOT NULL, count integer NOT NULL DEFAULT 0, detail text
);
SQL
run_migrations "$PARTIAL_DB" >/dev/null
run_migrations "$PARTIAL_DB" "$ROOT/deploy/migrations/order.txt" --verify >/dev/null

echo "[5/9] SQL中途失敗會回滾且可安全重跑"
printf 'CREATE TABLE migration_atomic_test(id integer);\nSELECT definitely_missing_function();\n' > "$WORK/fail.sql"
printf '%s\n' "$WORK/fail.sql" > "$WORK/fail-order.txt"
if run_migrations "$PARTIAL_DB" "$WORK/fail-order.txt" >/dev/null 2>&1; then
  echo "預期失敗的 Migration 卻成功" >&2; exit 1
fi
[ "$(db_psql "$PARTIAL_DB" <<<'SELECT to_regclass($$public.migration_atomic_test$$) IS NULL;')" = t ]
printf 'CREATE TABLE migration_atomic_test(id integer);\n' > "$WORK/fail.sql"
run_migrations "$PARTIAL_DB" "$WORK/fail-order.txt" >/dev/null

echo "[6/9] checksum不符會在執行SQL前停止"
printf '\n-- changed after apply\n' >> "$WORK/fail.sql"
if run_migrations "$PARTIAL_DB" "$WORK/fail-order.txt" >/dev/null 2>&1; then
  echo "checksum 不符時不應成功" >&2; exit 1
fi

echo "[7/9] --verify純讀取，不會建立ledger"
db_create "$RESTORE_DB"
if run_migrations "$RESTORE_DB" "$ROOT/deploy/migrations/order.txt" --verify >/dev/null 2>&1; then
  echo "空資料庫 verify 不應通過" >&2; exit 1
fi
[ "$(db_psql "$RESTORE_DB" <<<'SELECT to_regclass($$public.syncdrive_schema_migrations$$) IS NULL;')" = t ]
$DOCKER exec "$CONTAINER" sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$1" && createdb -U "$POSTGRES_USER" "$1"' sh "$RESTORE_DB"

echo "[8/9] TimescaleDB custom archive可在隔離DB完整回復"
$DOCKER exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$1" -Fc -f /tmp/sync-flow.dump && pg_restore --list /tmp/sync-flow.dump >/dev/null' sh "$LEGACY_DB"
db_psql "$RESTORE_DB" <<'SQL'
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
SELECT timescaledb_pre_restore();
SQL
$DOCKER exec "$CONTAINER" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --no-privileges --exit-on-error /tmp/sync-flow.dump' sh "$RESTORE_DB"
db_psql "$RESTORE_DB" <<'SQL'
SELECT timescaledb_post_restore();
SQL
restore_check="$(db_psql "$RESTORE_DB" <<'SQL'
SELECT
  EXISTS(SELECT 1 FROM pg_extension WHERE extname='timescaledb'),
  EXISTS(SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name='telemetry_logs'),
  (SELECT count(*) FROM telemetry_logs),
  (SELECT count(*) FROM vehicles),
  EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='vehicle_history_order_change');
SQL
)"
[ "$restore_check" = 't|t|1|12|t' ] || { echo "Timescale 回復驗證失敗：$restore_check" >&2; exit 1; }

echo "[9/9] 資料合併保留遠端資料，媒體缺檔阻擋資料包"
db_create "$DATA_DB"
$DOCKER exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$1" --schema-only --no-owner --no-privileges' sh "$SOURCE_DB" \
  | db_psql "$DATA_DB" >/dev/null
DOCKER="$DOCKER" DB_CONTAINER="$CONTAINER" "$ROOT/deploy/data-snapshot.sh" --skip-empty > "$WORK/data.sql"
db_psql "$DATA_DB" <<'SQL'
INSERT INTO data_sources(id, source_key, name, type, config, is_active, created_at, updated_at)
VALUES ('50000000-0000-0000-0000-000000000001','remote-only-sync-test','remote only','internal','{}',true,1,1);
SQL
$DOCKER exec -i "$CONTAINER" sh -c 'psql -X -q -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"' sh "$DATA_DB" < "$WORK/data.sql"
[ "$(db_psql "$DATA_DB" <<<'SELECT count(*) FROM data_sources WHERE source_key=$$remote-only-sync-test$$;')" = 1 ]
[ "$(grep -c '^DELETE FROM' "$WORK/data.sql" || true)" = 0 ]
db_psql "$DATA_DB" <<'SQL'
INSERT INTO media_library_items(media_id, name, kind, body, created_at, updated_at, row_version)
VALUES ('missing-media-test', '缺檔測試', 'media',
        '{"file":{"storageKey":"00000000-0000-0000-0000-000000000099.mp3","sha256":"00"}}', 1, 1, 1);
SQL
mkdir -p "$WORK/empty-media"
if DOCKER="$DOCKER" DB_CONTAINER="$CONTAINER" DB_NAME_OVERRIDE="$DATA_DB" MEDIA_STORAGE_DIR="$WORK/empty-media" \
  "$ROOT/deploy/build-sync-bundle.sh" "$WORK/bad-bundle" test-sha >/dev/null 2>&1; then
  echo "媒體缺檔時不應成功建立資料包" >&2; exit 1
fi

echo "sync flow tests: PASS"
