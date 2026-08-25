#!/usr/bin/env bash
#
# 從<strong>本機</strong>把程式碼送上 VM 並觸發部署。VM 上不需要 git remote。
#
#   ./deploy/push.sh                       # 用 deploy/.target 記住的目標
#   ./deploy/push.sh user@1.2.3.4          # 指定目標並記住
#   ./deploy/push.sh --gcloud instance zone project
#
# 為什麼用 rsync 而不是在 VM 上 git pull：目前這個倉庫沒有遠端。等有了私有
# Git 遠端之後，改用 deploy.sh --pull 會更乾淨，這支就可以退役。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TARGET_FILE="$ROOT/deploy/.target"
REMOTE_DIR="${REMOTE_DIR:-/opt/syncdrive_t3}"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

if [ "${1:-}" = "--gcloud" ]; then
  INSTANCE="${2:?需要 instance 名稱}"
  ZONE="${3:?需要 zone}"
  PROJECT="${4:-}"
  GCLOUD_ARGS=(--zone "$ZONE")
  [ -n "$PROJECT" ] && GCLOUD_ARGS+=(--project "$PROJECT")
  log "透過 gcloud compute 同步到 $INSTANCE"
  gcloud compute ssh "$INSTANCE" "${GCLOUD_ARGS[@]}" --command "sudo mkdir -p $REMOTE_DIR && sudo chown \$(whoami) $REMOTE_DIR"
  # gcloud compute scp 不支援 rsync 語意，改用 tar 串流：只送需要的東西
  tar --exclude-vcs \
      --exclude='node_modules' --exclude='dist' --exclude='.dev' \
      --exclude='deploy/.env' --exclude='deploy/.state' \
      -czf - . \
    | gcloud compute ssh "$INSTANCE" "${GCLOUD_ARGS[@]}" --command "tar -xzf - -C $REMOTE_DIR"
  gcloud compute ssh "$INSTANCE" "${GCLOUD_ARGS[@]}" --command "cd $REMOTE_DIR && ./deploy/deploy.sh"
  exit 0
fi

if [ -n "${1:-}" ]; then
  echo "$1" > "$TARGET_FILE"
fi
if [ ! -f "$TARGET_FILE" ]; then
  echo "還沒設定目標。用法：./deploy/push.sh user@host" >&2
  exit 2
fi
TARGET="$(cat "$TARGET_FILE")"

log "同步程式碼到 $TARGET:$REMOTE_DIR"
ssh "$TARGET" "sudo mkdir -p $REMOTE_DIR && sudo chown \$(whoami) $REMOTE_DIR"
rsync -az --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.dev' \
  --exclude='deploy/.env' \
  --exclude='deploy/.state' \
  ./ "$TARGET:$REMOTE_DIR/"

log "在遠端執行部署"
ssh "$TARGET" "cd $REMOTE_DIR && ./deploy/deploy.sh"
