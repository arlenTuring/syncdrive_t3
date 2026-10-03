#!/usr/bin/env bash
#
# 從<strong>本機</strong>（已登入 gcloud 或能 ssh 的那台）把 VM 上的部署目錄接上 GitHub，
# 之後 VM 就直接 git pull，不再靠 push.sh 用 rsync 整包送。
#
#   ./deploy/git-sync.sh --gcloud <instance> <zone> [project]   # 用 gcloud compute ssh
#   ./deploy/git-sync.sh user@host                              # 用一般 ssh
#   ./deploy/git-sync.sh                                         # 用 deploy/.target 記住的目標
#
# 可加的選項（放在目標之後）：
#   --branch <name>   跟哪一支（預設 main）
#   --api <url>       部署完後順便升級儀表板裡存的舊系統查詢，例如 http://34.80.84.224
#                     （先試跑列出會改什麼，再正式寫入；寫入前自動備份到 frontend/artifacts）
#   --no-deploy       只接上 git、切到最新版，不重建服務
#
# 第一次與之後都跑同一支：第一次會把目錄轉成 git 工作目錄，之後就是 pull ＋ 部署。
#
# 不會碰的東西：deploy/.env（密碼）、deploy/.state（回滾紀錄）、mosquitto/certs（正式機
# 自己簽的憑證）、backend/logs。它們都在 .gitignore 裡，切換版本時 git 不會動到。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REMOTE_DIR="${REMOTE_DIR:-/opt/syncdrive_t3}"
REPO_URL="${REPO_URL:-https://github.com/arlenTuring/syncdrive_t3.git}"
TARGET_FILE="$ROOT/deploy/.target"
BRANCH=main
API_BASE=""
DEPLOY=true

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

MODE=ssh
if [ "${1:-}" = "--gcloud" ]; then
  MODE=gcloud
  INSTANCE="${2:?需要 instance 名稱}"
  ZONE="${3:?需要 zone}"
  shift 3
  GCLOUD_ARGS=(--zone "$ZONE")
  if [ -n "${1:-}" ] && [ "${1#--}" = "$1" ]; then
    GCLOUD_ARGS+=(--project "$1")
    shift
  fi
elif [ -n "${1:-}" ] && [ "${1#--}" = "$1" ]; then
  echo "$1" > "$TARGET_FILE"
  shift
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:?--branch 需要名稱}"; shift 2 ;;
    --api) API_BASE="${2:?--api 需要網址}"; shift 2 ;;
    --no-deploy) DEPLOY=false; shift ;;
    *) echo "未知參數：$1" >&2; exit 2 ;;
  esac
done

remote() {
  if [ "$MODE" = gcloud ]; then
    gcloud compute ssh "$INSTANCE" "${GCLOUD_ARGS[@]}" --command "$1"
  else
    if [ ! -f "$TARGET_FILE" ]; then
      echo "還沒設定目標。用法：./deploy/git-sync.sh user@host 或 --gcloud <instance> <zone>" >&2
      exit 2
    fi
    ssh "$(cat "$TARGET_FILE")" "$1"
  fi
}

# 在 VM 上跑的部分。用 heredoc 組成一支腳本送過去，變數在本機先代換好。
read -r -d '' REMOTE_SCRIPT <<EOF || true
set -euo pipefail
DIR='$REMOTE_DIR'
REPO='$REPO_URL'
BRANCH='$BRANCH'

if ! command -v git >/dev/null 2>&1; then
  echo '==> 安裝 git'
  sudo apt-get update -qq && sudo apt-get install -y -qq git
fi

sudo mkdir -p "\$DIR"
sudo chown "\$(whoami)" "\$DIR"
cd "\$DIR"

# deploy.sh 用 sudo 跑；目錄屬於登入的使用者，root 讀這個 repo 時 git 會因為
# 「擁有者不同」拒絕。只對這一個目錄放行。
sudo git config --system --get-all safe.directory 2>/dev/null | grep -qx "\$DIR" \
  || sudo git config --system --add safe.directory "\$DIR"

if [ ! -d .git ]; then
  echo "==> 第一次：把 \$DIR 轉成 git 工作目錄（\$REPO）"
  git init -q
  git remote add origin "\$REPO"
else
  git remote set-url origin "\$REPO"
fi

echo "==> 取得 \$BRANCH 最新版"
git fetch -q origin "\$BRANCH"

# 之前用 rsync 送上來的檔案沒有 git 紀錄。-f 讓受版控的檔案以 GitHub 上的為準；
# .gitignore 裡的（.env、.state、certs、logs）完全不碰。
git checkout -q -f -B "\$BRANCH" "origin/\$BRANCH"
git branch -q --set-upstream-to="origin/\$BRANCH" "\$BRANCH"

echo "==> 目前版本：\$(git log --oneline -1)"
leftover=\$(git status --porcelain --untracked-files=normal | wc -l)
if [ "\$leftover" -gt 0 ]; then
  echo "    （另有 \$leftover 個不在版控、也沒被忽略的檔案，多半是舊 rsync 留下的；沒有刪除，可用 git status 查看）"
fi
EOF

log "接上 GitHub 並切到 $BRANCH"
remote "$REMOTE_SCRIPT"

if [ "$DEPLOY" = true ]; then
  log "在遠端部署"
  remote "cd $REMOTE_DIR && sudo ./deploy/deploy.sh"
fi

if [ -n "$API_BASE" ]; then
  log "升級儀表板裡存的舊系統查詢：先試跑"
  (cd "$ROOT/frontend" && npx tsx scripts/upgrade-dashboard-real-data.ts "$API_BASE" --dry-run)
  log "正式寫入"
  (cd "$ROOT/frontend" && npx tsx scripts/upgrade-dashboard-real-data.ts "$API_BASE")
fi

log "完成。之後更新只要再跑一次這支，或在 VM 上：cd $REMOTE_DIR && sudo ./deploy/deploy.sh --pull"
