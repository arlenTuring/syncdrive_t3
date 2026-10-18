#!/usr/bin/env bash
# Run ordered, checksummed SQL migrations without starting the application.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORDER_FILE="${MIGRATION_ORDER_FILE:-$ROOT/deploy/migrations/order.txt}"
DOCKER="${DOCKER:-docker}"
DB_CONTAINER="${DB_CONTAINER:-syncdrive_postgres}"
MODE=run

case "${1:-}" in
  --plan) MODE=plan ;;
  --verify) MODE=verify ;;
  "") ;;
  *) echo "用法：$0 [--plan|--verify]" >&2; exit 2 ;;
esac

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'
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

[ -f "$ORDER_FILE" ] || { echo "找不到 migration 順序表：$ORDER_FILE" >&2; exit 1; }

ledger_exists=false
if [ "$MODE" != plan ]; then
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
  if ! psql_in < "$file"; then
    echo "Migration 失敗：$relative" >&2
    exit 1
  fi
  psql_in <<<"INSERT INTO syncdrive_schema_migrations(migration_id, checksum) VALUES ('$escaped', '$checksum');"
done < "$ORDER_FILE"

if [ "$MODE" = run ]; then
  psql_in <<'SQL'
DO $$
DECLARE vehicle_code_length integer;
BEGIN
  SELECT character_maximum_length INTO vehicle_code_length
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='vehicles' AND column_name='vehicle_code';
  IF vehicle_code_length IS NULL OR vehicle_code_length < 64 THEN
    RAISE EXCEPTION 'vehicles.vehicle_code length is %, expected at least 64', vehicle_code_length;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicles' AND column_name='initial_mileage_km'
  ) THEN RAISE EXCEPTION 'vehicles.initial_mileage_km is missing'; END IF;
  IF to_regclass('public.data_retention_policies') IS NULL
     OR to_regclass('public.vehicle_history_frames') IS NULL
     OR to_regclass('public.media_play_schedules') IS NULL THEN
    RAISE EXCEPTION 'required migrated tables are missing';
  END IF;
END $$;
SQL
fi

printf 'Migration：%s（待執行 %d）\n' "$MODE" "$pending"
