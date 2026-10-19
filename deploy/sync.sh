#!/usr/bin/env bash
# The only user-facing GCP synchronization entrypoint.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTANCE="${SYNC_INSTANCE:-syncdrive-t3}"
ZONE="${SYNC_ZONE:-asia-east1-a}"
PROJECT="${SYNC_PROJECT:-}"
REMOTE_DIR="${REMOTE_DIR:-/opt/syncdrive_t3}"
BRANCH="${SYNC_BRANCH:-main}"
DRY_RUN=false
COMMAND=sync

usage() {
  cat <<'EOF'
SyncDrive GCP 完整同步

  ./deploy/sync.sh             固定 GitHub main，打包本機設定，備份、Migration、同步、啟動及驗收
  ./deploy/sync.sh --dry-run   讀取本機與遠端狀態並產生計畫，不上傳、不改資料、不重啟
  ./deploy/sync.sh status
  ./deploy/sync.sh logs backend
  ./deploy/sync.sh health
  ./deploy/sync.sh rollback
  ./deploy/sync.sh --help

目標可由 SYNC_INSTANCE、SYNC_ZONE、SYNC_PROJECT、REMOTE_DIR 覆寫。
EOF
}
log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m失敗：\033[0m %s\n' "$*" >&2; exit 1; }
hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else LC_ALL=C shasum -a 256 "$1" | awk '{print $1}'
  fi
}

case "${1:-}" in
  --dry-run) DRY_RUN=true; shift ;;
  status|health|rollback) COMMAND="$1"; shift ;;
  logs) COMMAND=logs; shift ;;
  -h|--help|help) usage; exit 0 ;;
  "") ;;
  *) die "未知參數：$1（用 --help 查看）" ;;
esac
[ $# -eq 0 ] || { [ "$COMMAND" = logs ] && [ $# -eq 1 ] || die "多餘參數：$*"; }

GCLOUD_ARGS=(--zone "$ZONE")
[ -z "$PROJECT" ] || GCLOUD_ARGS+=(--project "$PROJECT")
remote() { gcloud compute ssh "$INSTANCE" "${GCLOUD_ARGS[@]}" --command "$1"; }

if [ "$COMMAND" != sync ]; then
  command -v gcloud >/dev/null 2>&1 || die "找不到 gcloud CLI，請先安裝並登入"
  gcloud compute scp "$ROOT/deploy/remote-sync.sh" "$INSTANCE:/tmp/syncdrive-remote-sync.sh" "${GCLOUD_ARGS[@]}" >/dev/null
  case "$COMMAND" in
    logs) remote "sudo REMOTE_DIR='$REMOTE_DIR' bash /tmp/syncdrive-remote-sync.sh logs '${1:-backend}'" ;;
    *) remote "sudo REMOTE_DIR='$REMOTE_DIR' bash /tmp/syncdrive-remote-sync.sh '$COMMAND'" ;;
  esac
  exit $?
fi

command -v git >/dev/null 2>&1 || die "找不到 git"
command -v gcloud >/dev/null 2>&1 || die "找不到 gcloud CLI，請先安裝並登入"

log "[1/7] 檢查版本與環境"
git -C "$ROOT" fetch -q origin "$BRANCH"
SOURCE_SHA="$(git -C "$ROOT" rev-parse "origin/$BRANCH")"
LOCAL_SHA="$(git -C "$ROOT" rev-parse HEAD)"
[ "$LOCAL_SHA" = "$SOURCE_SHA" ] || die "本機 HEAD ${LOCAL_SHA:0:12} 不是 GitHub $BRANCH ${SOURCE_SHA:0:12}。請先提交、推送並更新本機。"

dirty="$(git -C "$ROOT" status --porcelain -- backend/src frontend/src deploy scripts/sync-local-with-gcp.sh)"
[ -z "$dirty" ] || {
  printf '%s\n' "$dirty" >&2
  die "存在會影響部署／資料格式的未提交檔案；不會自動提交或忽略。請先整理後重試。"
}

# The controller itself must be exactly the version being deployed.
for file in deploy/sync.sh deploy/remote-sync.sh deploy/migrate.sh deploy/build-sync-bundle.sh deploy/data-snapshot.sh deploy/migrations/order.txt; do
  committed="$(git -C "$ROOT" show "$SOURCE_SHA:$file" 2>/dev/null | { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else LC_ALL=C shasum -a 256; fi; } | awk '{print $1}')" \
    || die "$file 尚未推送到 GitHub $BRANCH"
  [ "$committed" = "$(hash_file "$ROOT/$file")" ] || die "$file 與 GitHub 固定版本不同"
done
"$ROOT/deploy/migrate.sh" --validate

remote "set -e; test -d '$REMOTE_DIR/.git'; test -f '$REMOTE_DIR/deploy/.env'; docker info >/dev/null; docker compose version >/dev/null; df -h '$REMOTE_DIR'; echo; grep '^DB_SYNCHRONIZE=' '$REMOTE_DIR/deploy/.env' 2>/dev/null || true; echo; sudo docker ps --filter name=syncdrive_ --format '{{.Names}} {{.Image}} {{.Status}}'"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BATCH="$(date -u +%Y%m%dT%H%M%SZ)-${SOURCE_SHA:0:12}"
"$ROOT/deploy/build-sync-bundle.sh" "$WORK/bundle" "$SOURCE_SHA"
LC_ALL=C COPYFILE_DISABLE=1 tar --no-xattrs -czf "$WORK/$BATCH.tar.gz" -C "$WORK/bundle" .
BUNDLE_SHA="$(hash_file "$WORK/$BATCH.tar.gz")"

# Read-only target-schema preflight using the exact fixed-version migrations.
git -C "$ROOT" archive --format=tar.gz -o "$WORK/$BATCH-migrations.tar.gz" "$SOURCE_SHA" \
  deploy/migrate.sh deploy/migrations backend/src/database/migrations
gcloud compute scp "$WORK/$BATCH-migrations.tar.gz" "$INSTANCE:/tmp/$BATCH-migrations.tar.gz" "${GCLOUD_ARGS[@]}" >/dev/null
remote "set -e; rm -rf '/tmp/$BATCH-migrations'; mkdir -p '/tmp/$BATCH-migrations'; tar -xzf '/tmp/$BATCH-migrations.tar.gz' -C '/tmp/$BATCH-migrations'; sudo DOCKER=docker DB_CONTAINER=syncdrive_postgres bash '/tmp/$BATCH-migrations/deploy/migrate.sh' --plan"

echo "    來源：本機設定資料 + GitHub $BRANCH"
echo "    目標：gcloud $INSTANCE / $ZONE${PROJECT:+ / $PROJECT}"
echo "    固定版本：$SOURCE_SHA"
echo "    批次：$BATCH"
echo "    Migration："
sed '/^\s*#/d;/^\s*$/d;s/^/      /' "$ROOT/deploy/migrations/order.txt"
echo "    遠端備份：$REMOTE_DIR/deploy/.state/sync/backups/$BATCH"

if [ "$DRY_RUN" = true ]; then
  log "試跑完成：僅上傳暫存的 Migration 預檢包；未備份、未執行 DDL、未切版本、未重啟"
  exit 0
fi

log "[2/7] 上傳固定資料包"
gcloud compute scp "$WORK/$BATCH.tar.gz" "$INSTANCE:/tmp/$BATCH.tar.gz" "${GCLOUD_ARGS[@]}"
gcloud compute scp "$ROOT/deploy/remote-sync.sh" "$INSTANCE:/tmp/syncdrive-remote-sync.sh" "${GCLOUD_ARGS[@]}"

remote "sudo REMOTE_DIR='$REMOTE_DIR' bash /tmp/syncdrive-remote-sync.sh apply '$BATCH' '$SOURCE_SHA' '/tmp/$BATCH.tar.gz' '$BUNDLE_SHA'"
log "完成。版本 $SOURCE_SHA，批次 $BATCH"
