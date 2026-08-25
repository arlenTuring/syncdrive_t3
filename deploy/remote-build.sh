#!/usr/bin/env bash
#
# 在遠端主機上建置、安裝，然後<strong>把原始碼清掉</strong>。從開發機執行。
#
#   ./deploy/remote-build.sh syncdrive-t3 asia-east1-a v0.1.2
#
# 為什麼要清：那台機器是建置用的，不是原始碼的家。建置需要原始碼，跑起來之後
# 不需要——留著只是把整份程式碼放在一台對外開放的主機上。所以流程是
# 「上傳 → 建置 → 打包 → 安裝 → 清除」，原始碼只在建置那幾分鐘存在。
#
# 送上去的是 <strong>git archive HEAD</strong>，不是工作目錄：未提交的修改不會被
# 部署，MANIFEST 記的 commit 也才與映像內容一致。
#
# 需要 gcloud CLI 與已設定的 SSH。若目標不是 GCP，把 remote_run／remote_pipe
# 兩個函式換成 ssh 即可，其餘不必改。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INSTANCE="${1:?用法：remote-build.sh <instance> <zone> [版號]}"
ZONE="${2:?需要 zone}"
TAG="${3:-$(git rev-parse --short HEAD)}"
REMOTE_DIR="${REMOTE_DIR:-/opt/syncdrive_t3}"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m失敗：\033[0m %s\n' "$*" >&2; exit 1; }

remote_run() { gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="$1"; }
remote_pipe() { gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="$1"; }

git diff --quiet || log "注意：工作目錄有未提交的修改，這些不會被部署"

log "1/5 上傳已提交的程式碼（$(git rev-parse --short HEAD)）"
remote_run "sudo mkdir -p $REMOTE_DIR && sudo chown \$(whoami):\$(whoami) $REMOTE_DIR"
git archive --format=tar HEAD | gzip \
  | remote_pipe "tar xzf - -C $REMOTE_DIR && chmod +x $REMOTE_DIR/deploy/*.sh"
remote_run "echo '$(git rev-parse HEAD)' > $REMOTE_DIR/deploy/.source-commit"

# 種子資料被 .gitignore 擋著，git archive 帶不走；有才送
if [ -f deploy/seed/seed.dump ]; then
  log "2/5 上傳種子資料"
  tar czf - deploy/seed | remote_pipe "tar xzf - -C $REMOTE_DIR"
else
  log "2/5 沒有 deploy/seed，略過"
fi

log "3/5 建置並打包 $TAG"
remote_run "cd $REMOTE_DIR && sudo ./deploy/pack-offline.sh $TAG" \
  || die "打包失敗"

# 建置產出的是 :$TAG，但既有的 deploy/.env 可能還指著別的標籤（例如初次安裝的
# latest）。不同步的話 bootstrap 會撈到舊映像裝上去——服務起得來、但跑的是上一版，
# 而且看起來一切正常（2026-08-26 實測：Basic Auth 因此靜靜地失效）。
log "4/5 對齊 IMAGE_TAG 並安裝驗收"
remote_run "sudo sed -i 's|^IMAGE_TAG=.*|IMAGE_TAG=$TAG|' $REMOTE_DIR/deploy/.env"
# 後端啟動要幾十秒（health start_period 40s），太早驗收會拿到 502
remote_run "cd $REMOTE_DIR && sudo ./deploy/bootstrap.sh && sleep 45 && ./deploy/healthcheck.sh" \
  || die "驗收未通過——原始碼保留在遠端供除錯，確認後再手動清除"

log "5/5 清除原始碼與建置快取"
# build cache 裡有原始碼副本，只刪目錄是不夠的
remote_run "cd $REMOTE_DIR \
  && sudo rm -rf backend frontend document scripts package.json docker-compose.yml \
  && sudo docker builder prune -af >/dev/null \
  && echo \"殘留原始碼檔案數：\$(find $REMOTE_DIR -name '*.ts' -o -name '*.tsx' | wc -l)\""

log "完成。安裝包在遠端 $REMOTE_DIR/deploy/dist/syncdrive-t3-$TAG.tar.gz"
