#!/usr/bin/env bash
#
# 從<strong>本機</strong>（已登入 gcloud 或能 ssh 的那台）把 VM 上的部署目錄接上 GitHub，
# 之後 VM 就直接 git pull，不再靠 push.sh 用 rsync 整包送。
#
#   ./deploy/git-sync.sh                                         # 預設：同步到 34（見下方預設值）
#   ./deploy/git-sync.sh --gcloud <instance> <zone> [project]   # 指定別台 GCP VM
#   ./deploy/git-sync.sh user@host                              # 用一般 ssh
#
# 預設值（目前的部署機 34.80.84.224）：gcloud instance syncdrive-t3、zone asia-east1-a，
# 部署完會升級該機儀表板裡存的舊系統查詢。換機器時改下面 DEFAULT_* 三行，或用
# 環境變數 SYNC_INSTANCE／SYNC_ZONE／SYNC_API 臨時覆蓋。
#
# 可加的選項：
#   --branch <name>   跟哪一支（預設 main）
#   --api <url>       升級儀表板的後端位址（預設 DEFAULT_API；指定別台時要自己給）
#   --no-api          不升級儀表板資料
#   --no-deploy       只接上 git、切到最新版，不重建服務（搭配預設的儀表板升級，可單獨重跑那一步）
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
DEFAULT_INSTANCE="${SYNC_INSTANCE:-syncdrive-t3}"
DEFAULT_ZONE="${SYNC_ZONE:-asia-east1-a}"
DEFAULT_API="${SYNC_API:-http://34.80.84.224}"
BRANCH=main
API_BASE=""
NO_API=false
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
else
  # 沒指定目標：預設的部署機
  MODE=gcloud
  INSTANCE="$DEFAULT_INSTANCE"
  ZONE="$DEFAULT_ZONE"
  GCLOUD_ARGS=(--zone "$ZONE")
  API_BASE="$DEFAULT_API"
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:?--branch 需要名稱}"; shift 2 ;;
    --api) API_BASE="${2:?--api 需要網址}"; shift 2 ;;
    --no-api) NO_API=true; shift ;;
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
  echo "==> 第一次：把 \$DIR 轉成 git 工作目錄（\${REPO}）"
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

if [ "$MODE" = gcloud ]; then
  log "目標：gcloud ${INSTANCE}（${GCLOUD_ARGS[*]}）"
else
  log "目標：$(cat "$TARGET_FILE" 2>/dev/null)"
fi
log "接上 GitHub 並切到 $BRANCH"
remote "$REMOTE_SCRIPT"

if [ "$DEPLOY" = true ]; then
  log "在遠端部署"
  remote "cd $REMOTE_DIR && sudo ./deploy/deploy.sh"
fi

[ "$NO_API" = true ] && API_BASE=""
if [ -n "$API_BASE" ]; then
  # 內部 API 在 nginx 帳密後面（跟 healthcheck.sh 用同一組 WEB_AUTH_*）。從 VM 的
  # deploy/.env 讀出來，只放在這個行程的環境變數裡交給升級腳本，不寫檔、不印出。
  if [ -z "${DASHBOARD_API_AUTH:-}" ]; then
    log "從 VM 讀取內部 API 帳密（不會顯示）"
    creds="$(remote "sudo grep -E '^WEB_AUTH_(USER|PASSWORD)=' $REMOTE_DIR/deploy/.env" 2>/dev/null | tr -d '\r' || true)"
    web_user="$(printf '%s\n' "$creds" | sed -n 's/^WEB_AUTH_USER=//p' | head -1)"
    web_pass="$(printf '%s\n' "$creds" | sed -n 's/^WEB_AUTH_PASSWORD=//p' | head -1)"
    if [ -n "$web_pass" ]; then
      DASHBOARD_API_AUTH="${web_user:-syncdrive}:${web_pass}"
      export DASHBOARD_API_AUTH
    else
      log "VM 的 deploy/.env 沒有 WEB_AUTH_PASSWORD，不帶帳密"
    fi
    unset creds web_user web_pass
  fi
  # 升級腳本用的是<strong>本機</strong>的查詢定義（frontend/src）。本機版本跟 VM 部署的不同、或本機
  # 有未提交的修改時，會把部署機程式還不認得的查詢寫進它的儀表板——那就跳過，不要硬寫。
  deployed_sha="$(remote "cd $REMOTE_DIR && git rev-parse HEAD" 2>/dev/null | tr -d '\r' | tail -1)"
  local_sha="$(git -C "$ROOT" rev-parse HEAD)"
  local_dirty="$(git -C "$ROOT" status --porcelain -- frontend/src frontend/scripts | head -1)"
  if [ "$deployed_sha" != "$local_sha" ] || [ -n "$local_dirty" ]; then
    log "跳過儀表板升級：本機 $(git -C "$ROOT" rev-parse --short HEAD)$( [ -n "$local_dirty" ] && echo '（frontend 有未提交修改）') 與部署機 ${deployed_sha:0:7} 不是同一版"
    log "  要升級：本機切到部署機那一版（git checkout ${deployed_sha:0:7}，且 frontend 沒有未提交修改）後，用 --no-deploy 重跑這支"
    API_BASE=""
  fi
fi
if [ -n "$API_BASE" ]; then
  log "升級儀表板裡存的舊系統查詢（本機與部署機同為 $(git -C "$ROOT" rev-parse --short HEAD)）：先試跑"
  (cd "$ROOT/frontend" && npx tsx scripts/upgrade-dashboard-real-data.ts "$API_BASE" --dry-run)
  log "正式寫入"
  (cd "$ROOT/frontend" && npx tsx scripts/upgrade-dashboard-real-data.ts "$API_BASE")
fi

log "同步結果（部署機實際狀態）"
remote "cd $REMOTE_DIR && echo \"  程式：\$(git log --oneline -1)\" && echo \"  最後健康版本：\$(sudo cat deploy/.state/last-good-tag 2>/dev/null || echo 無)\" && sudo docker ps --filter name=syncdrive_backend --filter name=syncdrive_web --format '  {{.Names}} {{.Image}} {{.Status}}'" || true
log "完成。之後更新：本機再跑一次 ./deploy/git-sync.sh，或在 VM 上 cd $REMOTE_DIR && sudo ./deploy/deploy.sh --pull"
