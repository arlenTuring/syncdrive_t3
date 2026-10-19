#!/usr/bin/env bash
# Internal helper used by sync.sh. Produces one immutable settings/assets bundle.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:?用法：build-sync-bundle.sh <output-dir> <git-sha>}"
SOURCE_SHA="${2:?缺少 git sha}"
DOCKER="${DOCKER:-}"
DB_CONTAINER="${DB_CONTAINER:-syncdrive_postgres}"
MEDIA_ROOT="${MEDIA_STORAGE_DIR:-$ROOT/backend/data/media}"
MAPS_ROOT="$ROOT/backend/data/published-maps"

if [ -z "$DOCKER" ]; then
  if command -v docker >/dev/null 2>&1; then DOCKER=docker
  elif [ -x /Applications/Docker.app/Contents/Resources/bin/docker ]; then DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker
  else echo "找不到 Docker；本機設定資料來自 PostgreSQL 容器" >&2; exit 1
  fi
fi
export DOCKER DB_CONTAINER

psql_in() {
  if [ -n "${DB_NAME_OVERRIDE:-}" ]; then
    $DOCKER exec -i -e "POSTGRES_DB=$DB_NAME_OVERRIDE" "$DB_CONTAINER" sh -c \
      'psql -X -q -At -F "\t" -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  else
    $DOCKER exec -i "$DB_CONTAINER" sh -c \
      'psql -X -q -At -F "\t" -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  fi
}
hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else LC_ALL=C shasum -a 256 "$1" | awk '{print $1}'
  fi
}

[ ! -e "$OUTPUT" ] || { echo "輸出目錄已存在：$OUTPUT" >&2; exit 1; }
mkdir -p "$OUTPUT/maps" "$OUTPUT/media"
# 順序表取自固定版本，不讀本機工作目錄（打包期間本機檔案被改也不會混進去）
git -C "$ROOT" show "$SOURCE_SHA:deploy/migrations/order.txt" > "$OUTPUT/migrations.order"

"$ROOT/deploy/data-snapshot.sh" --skip-empty > "$OUTPUT/data.sql"

if [ -f "$MAPS_ROOT/active-map.json" ]; then
  cp "$MAPS_ROOT/active-map.json" "$OUTPUT/maps/"
  for file in "$MAPS_ROOT"/*.json; do
    [ -f "$file" ] || continue
    case "$file" in *.meta.json|*/active-map.json) continue ;; esac
    python3 - "$file" <<'PY'
import json, re, sys
doc=json.load(open(sys.argv[1], encoding='utf-8'))
map_id=str(doc.get('mapId',''))
if not re.fullmatch(r'[A-Za-z0-9_-]+', map_id):
    raise SystemExit(f'invalid mapId in {sys.argv[1]}')
PY
    cp "$file" "$OUTPUT/maps/"
    meta="${file%.json}.meta.json"
    [ ! -f "$meta" ] || cp "$meta" "$OUTPUT/maps/"
  done
fi

psql_in > "$OUTPUT/media.tsv" <<'SQL'
SELECT body #>> '{file,storageKey}', body #>> '{file,sha256}'
FROM media_library_items
WHERE kind='media' AND COALESCE(body #>> '{file,storageKey}', '') <> ''
ORDER BY media_id;
SQL

while IFS=$'\t' read -r key expected || [ -n "$key" ]; do
  [ -n "$key" ] || continue
  [[ "$key" =~ ^[0-9a-fA-F-]{36}\.(mp3|wav|m4a|mp4|png|jpg|jpeg|webp)$ ]] \
    || { echo "媒體 storageKey 不合法：$key" >&2; exit 1; }
  source="$MEDIA_ROOT/objects/$key"
  [ -r "$source" ] || { echo "媒體缺檔：$source" >&2; exit 1; }
  actual="$(hash_file "$source")"
  [ -n "$expected" ] && [ "$actual" != "$expected" ] \
    && { echo "媒體校驗不符：${key}（DB=${expected} file=${actual}）" >&2; exit 1; }
  cp "$source" "$OUTPUT/media/$key"
done < "$OUTPUT/media.tsv"

"$ROOT/deploy/data-snapshot.sh" --skip-empty > "$OUTPUT/data.verify.sql"
if ! cmp -s <(tail -n +2 "$OUTPUT/data.sql") <(tail -n +2 "$OUTPUT/data.verify.sql"); then
  echo "打包期間設定資料發生變更；請在資料穩定後重試" >&2
  exit 1
fi
rm "$OUTPUT/data.verify.sql"

{
  echo "format=syncdrive-bundle-v1"
  echo "source_git_sha=$SOURCE_SHA"
  echo "created_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "database_snapshot_sha256=$(hash_file "$OUTPUT/data.sql")"
  echo "migration_order_sha256=$(hash_file "$OUTPUT/migrations.order")"
} > "$OUTPUT/bundle.env"

(
  cd "$OUTPUT"
  : > SHA256SUMS
  while IFS= read -r file; do
    [ "$file" = ./SHA256SUMS ] && continue
    sum="$(hash_file "$file")"
    printf '%s  %s\n' "$sum" "${file#./}" >> SHA256SUMS
  done < <(find . -type f ! -name SHA256SUMS -print | LC_ALL=C sort)
)

printf '資料包：SQL %s，地圖 %s，媒體 %s\n' \
  "$(grep -c '^-- .*：[0-9].*筆' "$OUTPUT/data.sql" || true) 類" \
  "$(find "$OUTPUT/maps" -type f ! -name '*.meta.json' ! -name active-map.json | wc -l | tr -d ' ') 份" \
  "$(find "$OUTPUT/media" -type f | wc -l | tr -d ' ') 份"
