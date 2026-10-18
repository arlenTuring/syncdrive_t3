#!/usr/bin/env bash
# Remote half of deploy/sync.sh. Run as root on the deployment host.
set -euo pipefail

LIVE_ROOT="${REMOTE_DIR:-/opt/syncdrive_t3}"
STATE_ROOT="$LIVE_ROOT/deploy/.state/sync"
LOCK_FILE="$STATE_ROOT/deploy.lock"
ACTION="${1:-}"
mkdir -p "$STATE_ROOT"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m失敗：\033[0m %s\n' "$*" >&2; exit 1; }
hash_file() { sha256sum "$1" | awk '{print $1}'; }
mark_stage() { printf 'stage=%s\nat=%s\n' "$1" "$(date -u +%FT%TZ)" >> "$RUN_DIR/status.env"; }

wait_ready() {
  local timeout="${READY_TIMEOUT_SECONDS:-240}" started now backend web
  started="$(date +%s)"
  while :; do
    backend="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' syncdrive_backend 2>/dev/null || true)"
    web="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' syncdrive_web 2>/dev/null || true)"
    if [ "$backend" = healthy ] && [ "$web" = healthy ] \
      && curl -fsS --connect-timeout 3 --max-time 5 http://127.0.0.1/healthz >/dev/null; then
      return 0
    fi
    now="$(date +%s)"
    [ $((now - started)) -lt "$timeout" ] || {
      echo "就緒逾時：backend=${backend:-missing}, web=${web:-missing}" >&2
      return 1
    }
    sleep 3
  done
}

set_env() {
  local file="$1" key="$2" value="$3" tmp
  tmp="${file}.tmp.$$"
  awk -v key="$key" -v value="$value" '
    BEGIN{done=0}
    $0 ~ "^" key "=" {print key "=" value; done=1; next}
    {print}
    END{if(!done) print key "=" value}
  ' "$file" > "$tmp"
  chmod --reference="$file" "$tmp" 2>/dev/null || chmod 600 "$tmp"
  mv "$tmp" "$file"
}

compose() {
  (cd "$LIVE_ROOT" && IMAGE_TAG="$IMAGE_TAG" DB_SYNCHRONIZE=false \
    docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env "$@")
}

capture_failure() {
  local dir="$1"
  mkdir -p "$dir/failure"
  docker ps -a --filter name=syncdrive_ --format '{{.Names}}\t{{.Image}}\t{{.Status}}' > "$dir/failure/containers.txt" || true
  docker logs --tail 500 syncdrive_backend > "$dir/failure/backend.log" 2>&1 || true
  docker logs --tail 500 syncdrive_web > "$dir/failure/web.log" 2>&1 || true
}

restore_backup() {
  local backup="$1"
  [ -f "$backup/database.dump" ] || die "回復備份缺少 database.dump：$backup"
  [ -f "$backup/deploy.env" ] || die "回復備份缺少 deploy.env：$backup"
  local old_tag old_sha
  old_tag="$(cat "$backup/image-tag")"
  old_sha="$(cat "$backup/git-sha")"
  log "回復資料庫、檔案與映像 $old_tag"
  IMAGE_TAG="$old_tag"
  docker stop syncdrive_web syncdrive_backend >/dev/null 2>&1 || true
  docker exec syncdrive_postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
  docker exec -i syncdrive_postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' < "$backup/database.dump"
  cp "$backup/deploy.env" "$LIVE_ROOT/deploy/.env"
  if [ -d "$backup/backend-data" ]; then
    # Restore an exact /app/data snapshot.  Copying over the directory would
    # leave newly synchronized maps/media behind and make rollback incomplete.
    docker run --rm --user 0 --entrypoint sh --volumes-from syncdrive_backend \
      -v "$backup/backend-data:/restore:ro" "syncdrive-backend:$old_tag" -c '
set -eu
find /app/data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -a /restore/. /app/data/
chown -R 1000:1000 /app/data
'
  fi
  git -C "$LIVE_ROOT" checkout -q -f --detach "$old_sha"
  set_env "$LIVE_ROOT/deploy/.env" IMAGE_TAG "$old_tag"
  set_env "$LIVE_ROOT/deploy/.env" DB_SYNCHRONIZE false
  compose up -d --no-build backend web
  wait_ready
  "$LIVE_ROOT/deploy/healthcheck.sh"
  printf '%s\n' "$old_tag" > "$LIVE_ROOT/deploy/.state/last-good-tag"
}

status() {
  echo "程式版本：$(git -C "$LIVE_ROOT" log --oneline -1 2>/dev/null || echo 無)"
  echo "最後成功：$(cat "$STATE_ROOT/last-success.env" 2>/dev/null || echo 無)"
  docker ps -a --filter name=syncdrive_ --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
}

case "$ACTION" in
  status) status; exit 0 ;;
  health) exec "$LIVE_ROOT/deploy/healthcheck.sh" ;;
  logs)
    service="${2:-backend}"
    case "$service" in backend) container=syncdrive_backend ;; web|frontend) container=syncdrive_web ;; *) die "logs 僅支援 backend 或 web" ;; esac
    exec docker logs --tail 300 "$container"
    ;;
  rollback)
    exec 9>"$LOCK_FILE"; flock -n 9 || die "已有同步或回復正在執行"
    state="$STATE_ROOT/last-success.env"
    [ -f "$state" ] || die "沒有成功批次可回復"
    # shellcheck disable=SC1090
    source "$state"
    restore_backup "$ROLLBACK_BACKUP"
    log "回復完成並通過驗收"
    exit 0
    ;;
  apply) ;;
  *) die "用法：remote-sync.sh apply <batch> <sha> <bundle.tar.gz> <sha256> | status | health | logs | rollback" ;;
esac

BATCH="${2:?缺少 batch id}"
SOURCE_SHA="${3:?缺少 git sha}"
BUNDLE_ARCHIVE="${4:?缺少 bundle path}"
BUNDLE_SHA="${5:?缺少 bundle checksum}"
exec 9>"$LOCK_FILE"
flock -n 9 || die "已有同步正在執行；鎖：$LOCK_FILE"

RUN_DIR="$STATE_ROOT/runs/$BATCH"
RELEASE="$STATE_ROOT/releases/$SOURCE_SHA"
BUNDLE="$RUN_DIR/bundle"
BACKUP="$STATE_ROOT/backups/$BATCH"
mkdir -p "$RUN_DIR" "$RELEASE" "$BACKUP"
printf 'batch=%s\nsha=%s\nstarted_at=%s\nstage=preflight\n' "$BATCH" "$SOURCE_SHA" "$(date -u +%FT%TZ)" > "$RUN_DIR/status.env"

[ "$(hash_file "$BUNDLE_ARCHIVE")" = "$BUNDLE_SHA" ] || die "上傳資料包校驗失敗"
mkdir -p "$BUNDLE"
tar -xzf "$BUNDLE_ARCHIVE" -C "$BUNDLE"
(cd "$BUNDLE" && sha256sum -c SHA256SUMS)
grep -qx "source_git_sha=$SOURCE_SHA" "$BUNDLE/bundle.env" || die "資料包與程式 Git SHA 不一致"

[ -f "$LIVE_ROOT/deploy/.env" ] || die "找不到 $LIVE_ROOT/deploy/.env"
docker inspect syncdrive_postgres >/dev/null 2>&1 || die "找不到 PostgreSQL 容器"
docker inspect syncdrive_backend >/dev/null 2>&1 || die "找不到既有後端容器，無法建立可回復備份"

db_bytes="$(docker exec syncdrive_postgres sh -c 'psql -X -q -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_database_size(current_database())"')"
data_bytes="$(docker exec syncdrive_backend sh -c 'du -sb /app/data 2>/dev/null | cut -f1' || echo 0)"
free_bytes="$(df -Pk "$LIVE_ROOT" | awk 'NR==2{print $4*1024}')"
need_bytes=$((db_bytes + data_bytes + 5 * 1024 * 1024 * 1024))
[ "$free_bytes" -gt "$need_bytes" ] || die "備份／建置空間不足：需要約 $need_bytes bytes，可用 $free_bytes bytes"

log "[2/7] 取得固定版本並建置乾淨映像"
mark_stage build
git -C "$LIVE_ROOT" fetch -q origin "$SOURCE_SHA"
git -C "$LIVE_ROOT" cat-file -e "$SOURCE_SHA^{commit}" || die "Git 找不到 $SOURCE_SHA"
if [ ! -f "$RELEASE/deploy/docker-compose.prod.yml" ]; then
  git -C "$LIVE_ROOT" archive "$SOURCE_SHA" | tar -x -C "$RELEASE"
fi
cmp -s "$BUNDLE/migrations.order" "$RELEASE/deploy/migrations/order.txt" \
  || die "資料包要求的 Migration 與固定 Git 版本不一致"
IMAGE_TAG="sync-${SOURCE_SHA:0:12}"
docker build -q -f "$RELEASE/deploy/Dockerfile.backend" -t "syncdrive-backend:$IMAGE_TAG" "$RELEASE" >/dev/null
docker build -q -f "$RELEASE/deploy/Dockerfile.web" -t "syncdrive-web:$IMAGE_TAG" "$RELEASE" >/dev/null

log "[3/7] 備份 GCP"
mark_stage backup
previous_tag="$(grep '^IMAGE_TAG=' "$LIVE_ROOT/deploy/.env" | cut -d= -f2-)"
previous_tag="${previous_tag:-$(docker inspect -f '{{.Config.Image}}' syncdrive_backend | sed 's/.*://')}"
previous_sha="$(git -C "$LIVE_ROOT" rev-parse HEAD)"
printf '%s\n' "$previous_tag" > "$BACKUP/image-tag"
printf '%s\n' "$previous_sha" > "$BACKUP/git-sha"
cp "$LIVE_ROOT/deploy/.env" "$BACKUP/deploy.env"
cp "$LIVE_ROOT/deploy/docker-compose.prod.yml" "$BACKUP/docker-compose.prod.yml"
docker inspect syncdrive_backend syncdrive_web > "$BACKUP/images.json"
docker exec syncdrive_postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP/database.dump"
mkdir -p "$BACKUP/backend-data"
docker cp syncdrive_backend:/app/data/. "$BACKUP/backend-data/"

MUTATED=false
rollback_on_error() {
  code=$?
  trap - ERR INT TERM
  capture_failure "$RUN_DIR"
  printf 'stage=failed\nexit_code=%s\nfailed_at=%s\n' "$code" "$(date -u +%FT%TZ)" >> "$RUN_DIR/status.env"
  if [ "$MUTATED" = true ]; then
    echo "同步失敗，開始受控回復…" >&2
    if restore_backup "$BACKUP"; then
      echo "已回復舊資料與版本，並通過健康檢查" >&2
    else
      echo "自動回復失敗。服務保持維護狀態；精確備份位置：$BACKUP" >&2
      echo "修正後執行：sudo $LIVE_ROOT/deploy/remote-sync.sh rollback" >&2
    fi
  fi
  exit "$code"
}
trap rollback_on_error ERR INT TERM

log "[4/7] 維護模式與資料庫升級"
mark_stage migration
docker stop syncdrive_web syncdrive_backend >/dev/null
MUTATED=true
DOCKER=docker DB_CONTAINER=syncdrive_postgres "$RELEASE/deploy/migrate.sh" 2>&1 \
  | tee "$RUN_DIR/migration.log"

log "[5/7] 同步設定、地圖與媒體檔案"
mark_stage data-sync
docker run --rm --user 0 --entrypoint sh --volumes-from syncdrive_backend \
  -v "$BUNDLE:/bundle:ro" "syncdrive-backend:$IMAGE_TAG" -c '
set -eu
mkdir -p /app/data/media/objects /app/data/published-maps
while IFS="$(printf "\t")" read -r key expected; do
  [ -n "$key" ] || continue
  src="/bundle/media/$key"; dst="/app/data/media/objects/$key"
  [ -f "$src" ] || { echo "missing media: $key" >&2; exit 1; }
  actual=$(sha256sum "$src" | cut -d" " -f1)
  [ -z "$expected" ] || [ "$actual" = "$expected" ] || { echo "media checksum mismatch: $key" >&2; exit 1; }
  if [ -f "$dst" ]; then
    current=$(sha256sum "$dst" | cut -d" " -f1)
    [ "$current" = "$actual" ] || { echo "remote media collision: $key" >&2; exit 1; }
  else
    cp "$src" "$dst"
  fi
done < /bundle/media.tsv
node <<"NODE"
const fs=require("fs"), path=require("path");
const store=require("/app/scripts/map-published-store.js");
const dir="/bundle/maps";
if (fs.existsSync(dir)) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (name==="active-map.json" || name.endsWith(".meta.json") || !name.endsWith(".json")) continue;
    const doc=JSON.parse(fs.readFileSync(path.join(dir,name),"utf8"));
    if (!doc.mapId || name !== `${doc.mapId}.json`) throw new Error(`invalid map file ${name}`);
    const metaPath=path.join(dir,`${doc.mapId}.meta.json`);
    const meta=fs.existsSync(metaPath)?JSON.parse(fs.readFileSync(metaPath,"utf8")):{};
    store.writePublishedEntry(doc.mapId,{...meta,mapDocument:doc});
  }
  const activePath=path.join(dir,"active-map.json");
  if (fs.existsSync(activePath)) {
    const active=JSON.parse(fs.readFileSync(activePath,"utf8"));
    if (!store.readPublishedEntry(active.activeMapId)) throw new Error(`active map missing: ${active.activeMapId}`);
    store.writeActiveMapConfig(active);
  }
}
NODE
chown -R 1000:1000 /app/data/media /app/data/published-maps
'
docker exec -i syncdrive_postgres sh -c 'psql -X -q -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$BUNDLE/data.sql"
DOCKER=docker DB_CONTAINER=syncdrive_postgres "$RELEASE/deploy/migrate.sh" --verify

docker run --rm --entrypoint sh --volumes-from syncdrive_backend \
  -v "$BUNDLE:/bundle:ro" "syncdrive-backend:$IMAGE_TAG" -c '
set -eu
while IFS="$(printf "\t")" read -r key expected; do
  [ -n "$key" ] || continue
  test -r "/app/data/media/objects/$key"
  [ -z "$expected" ] || [ "$(sha256sum "/app/data/media/objects/$key" | cut -d" " -f1)" = "$expected" ]
done < /bundle/media.tsv
'

log "[6/7] 啟動固定版本並等待服務"
mark_stage startup
git -C "$LIVE_ROOT" checkout -q -f --detach "$SOURCE_SHA"
set_env "$LIVE_ROOT/deploy/.env" DB_SYNCHRONIZE false
set_env "$LIVE_ROOT/deploy/.env" IMAGE_TAG "$IMAGE_TAG"
compose up -d --no-build backend web
wait_ready

log "[7/7] 完整驗收"
mark_stage verification
"$LIVE_ROOT/deploy/healthcheck.sh" 2>&1 | tee "$RUN_DIR/healthcheck.log"
printf 'BATCH=%q\nSOURCE_SHA=%q\nDEPLOYED_TAG=%q\nROLLBACK_BACKUP=%q\nCOMPLETED_AT=%q\n' \
  "$BATCH" "$SOURCE_SHA" "$IMAGE_TAG" "$BACKUP" "$(date -u +%FT%TZ)" > "$STATE_ROOT/last-success.env"
printf '%s\n' "$IMAGE_TAG" > "$LIVE_ROOT/deploy/.state/last-good-tag"
printf 'stage=success\ncompleted_at=%s\n' "$(date -u +%FT%TZ)" >> "$RUN_DIR/status.env"
trap - ERR INT TERM
mapfile -t stale_backups < <(
  find "$STATE_ROOT/backups" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -nr | awk 'NR > 5 {$1=""; sub(/^ /, ""); print}'
)
for stale in "${stale_backups[@]}"; do
  case "$stale" in "$STATE_ROOT/backups/"*) rm -rf -- "$stale" ;; esac
done
log "同步完成：$BATCH / $SOURCE_SHA / $IMAGE_TAG"
