#!/usr/bin/env bash
# Destructive checks run only against an explicitly named disposable database.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKER="${DOCKER:-docker}"
CONTAINER="${DB_CONTAINER:-syncdrive_postgres}"
SOURCE_DB="${SOURCE_DB:-syncdrive_t3}"
TEST_DB="syncdrive_deploy_test_${$}"
WORK="$(mktemp -d)"

cleanup() {
  $DOCKER exec "$CONTAINER" sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$1"' sh "$TEST_DB" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

psql_test() {
  $DOCKER exec -i "$CONTAINER" sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"' sh "$TEST_DB"
}

echo "[1/5] 建立隔離資料庫 $TEST_DB"
$DOCKER exec "$CONTAINER" sh -c 'createdb -U "$POSTGRES_USER" "$1"' sh "$TEST_DB"
$DOCKER exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$1" --schema-only --no-owner --no-privileges' sh "$SOURCE_DB" \
  | psql_test >/dev/null

echo "[2/5] 重現 varchar(10) 與缺少註冊欄位後執行 Migration"
psql_test <<'SQL'
DROP TABLE IF EXISTS syncdrive_schema_migrations;
ALTER TABLE vehicles DROP COLUMN IF EXISTS initial_mileage_km;
ALTER TABLE vehicles DROP COLUMN IF EXISTS service_enabled;
ALTER TABLE vehicles DROP COLUMN IF EXISTS row_version;
ALTER TABLE vehicles ALTER COLUMN vehicle_code TYPE varchar(10);
INSERT INTO vehicles(id, vehicle_code, display_name, is_active, created_at, updated_at)
SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       'PMS' || lpad(n::text, 2, '0'), '測試車 ' || n, true, 1, 1
FROM generate_series(1, 11) n;
SQL
DOCKER="$DOCKER" DB_CONTAINER="$CONTAINER" DB_NAME_OVERRIDE="$TEST_DB" "$ROOT/deploy/migrate.sh" >/dev/null
DOCKER="$DOCKER" DB_CONTAINER="$CONTAINER" DB_NAME_OVERRIDE="$TEST_DB" "$ROOT/deploy/migrate.sh" \
  | grep -q '待執行 0'
DOCKER="$DOCKER" DB_CONTAINER="$CONTAINER" DB_NAME_OVERRIDE="$TEST_DB" "$ROOT/deploy/migrate.sh" --verify >/dev/null
vehicle_check="$(psql_test <<'SQL'
SELECT character_maximum_length,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='vehicles' AND column_name='initial_mileage_km'),
       (SELECT count(*) FROM vehicles WHERE display_name LIKE '測試車 %'),
       (SELECT count(DISTINCT vehicle_code) FROM vehicles WHERE display_name LIKE '測試車 %')
FROM information_schema.columns
WHERE table_schema='public' AND table_name='vehicles' AND column_name='vehicle_code';
SQL
)"
[ "$vehicle_check" = '64|t|11|11' ] || {
  echo "車輛 Migration 驗證失敗：$vehicle_check" >&2; exit 1
}

echo "[3/5] 驗證資料合併不刪遠端獨有資料"
psql_test <<'SQL'
DELETE FROM vehicles WHERE display_name LIKE '測試車 %';
SQL
DOCKER="$DOCKER" DB_CONTAINER="$CONTAINER" "$ROOT/deploy/data-snapshot.sh" --skip-empty > "$WORK/data.sql"
psql_test <<'SQL'
INSERT INTO data_sources(id, source_key, name, type, config, is_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001','remote-only-sync-test','remote only','internal','{}',true,1,1);
SQL
$DOCKER exec -i "$CONTAINER" sh -c 'psql -X -q -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"' sh "$TEST_DB" < "$WORK/data.sql"
[ "$(psql_test <<<'SELECT count(*) FROM data_sources WHERE source_key=$$remote-only-sync-test$$;')" = 1 ]
[ "$(grep -c '^DELETE FROM' "$WORK/data.sql" || true)" = 0 ]

echo "[4/5] 驗證缺少正式媒體檔時不產生資料包"
psql_test <<'SQL'
INSERT INTO media_library_items(media_id, name, kind, body, created_at, updated_at)
VALUES ('missing-media-test', '缺檔測試', 'media',
        '{"file":{"storageKey":"00000000-0000-0000-0000-000000000099.mp3","sha256":"00"}}',
        1, 1);
SQL
mkdir -p "$WORK/empty-media"
if DOCKER="$DOCKER" DB_CONTAINER="$CONTAINER" DB_NAME_OVERRIDE="$TEST_DB" \
  MEDIA_STORAGE_DIR="$WORK/empty-media" \
  "$ROOT/deploy/build-sync-bundle.sh" "$WORK/bad-bundle" test-sha >/dev/null 2>&1; then
  echo "媒體缺檔時不應成功建立資料包" >&2; exit 1
fi
psql_test <<'SQL'
DELETE FROM media_library_items WHERE media_id='missing-media-test';
SQL

echo "[5/5] 驗證 Migration 失敗即停止且不記錄成功"
printf 'SELECT definitely_missing_function();\n' > "$WORK/fail.sql"
printf '%s\n' "$WORK/fail.sql" > "$WORK/order.txt"
if DOCKER="$DOCKER" DB_CONTAINER="$CONTAINER" DB_NAME_OVERRIDE="$TEST_DB" \
  MIGRATION_ORDER_FILE="$WORK/order.txt" "$ROOT/deploy/migrate.sh" >/dev/null 2>&1; then
  echo "預期失敗的 Migration 卻成功" >&2; exit 1
fi
[ "$(psql_test <<'SQL'
SELECT count(*) FROM syncdrive_schema_migrations WHERE migration_id LIKE '%/fail.sql';
SQL
)" = 0 ]

echo "sync flow tests: PASS"
