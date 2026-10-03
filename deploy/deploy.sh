#!/usr/bin/env bash
#
# 每次更新都跑這一支。在 VM 上執行。
#
#   ./deploy/deploy.sh              # 用目前工作目錄的程式碼重新部署
#   ./deploy/deploy.sh --pull       # 先 git pull 再部署
#   ./deploy/deploy.sh --rollback   # 回到上一個成功的映像標籤
#
# 流程：記錄目前版本 → 建映像 → 換上去 → 健康檢查 → 失敗就自動回滾。
# 「失敗就自動回滾」是這支腳本存在的理由：手動部署最常見的失敗不是建置錯誤，
# 而是<strong>換上去之後才發現不通，而舊的已經停掉了</strong>。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env"
STATE_DIR="$ROOT/deploy/.state"
LAST_GOOD="$STATE_DIR/last-good-tag"
mkdir -p "$STATE_DIR"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m失敗：\033[0m %s\n' "$*" >&2; }

PULL=false
ROLLBACK=false
for arg in "$@"; do
  case "$arg" in
    --pull) PULL=true ;;
    --rollback) ROLLBACK=true ;;
    *) echo "未知參數：$arg" >&2; exit 2 ;;
  esac
done

if [ ! -f deploy/.env ]; then
  fail "找不到 deploy/.env，請先跑 ./deploy/bootstrap.sh"
  exit 1
fi

# 安裝包裡沒有原始碼——那是刻意的，正式機不該保留原始碼，也不該在上面建置。
# 所以這支只在有原始碼的機器（開發機／打包機）上有意義。
if [ ! -d backend ] && [ "$ROLLBACK" = false ]; then
  fail "這台機器沒有原始碼，無法建置。"
  echo "   正式機的更新方式是安裝新的安裝包：" >&2
  echo "     tar xzf syncdrive-t3-<版本>.tar.gz && cd syncdrive-t3 && sudo ./deploy/bootstrap.sh" >&2
  echo "   （回滾到上一版仍可用：./deploy/deploy.sh --rollback）" >&2
  exit 1
fi

# ── 回滾 ────────────────────────────────────────────────────
if [ "$ROLLBACK" = true ]; then
  if [ ! -f "$LAST_GOOD" ]; then
    fail "沒有可回滾的版本紀錄"
    exit 1
  fi
  TAG="$(cat "$LAST_GOOD")"
  log "回滾到 $TAG"
  IMAGE_TAG="$TAG" $COMPOSE up -d --no-build
  exec ./deploy/healthcheck.sh
fi

# ── 取得程式碼 ──────────────────────────────────────────────
if [ "$PULL" = true ]; then
  log "git pull"
  # 這支通常用 sudo 跑；用 root 拉會讓 .git 裡多出 root 的檔案，下次登入的使用者
  # 自己 pull 就失敗。有 SUDO_USER 時以那位使用者的身分拉。
  if [ "$(id -u)" = 0 ] && [ -n "${SUDO_USER:-}" ]; then
    sudo -u "$SUDO_USER" git pull --ff-only
  else
    git pull --ff-only
  fi
fi

TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
PREVIOUS="$(cat "$LAST_GOOD" 2>/dev/null || echo '')"
log "部署版本 ${TAG}（上一個成功版本：${PREVIOUS:-無}）"

# ── 建置 ────────────────────────────────────────────────────
# 先建完再換。建置失敗時舊的服務原封不動還在跑。
log "建置映像"
IMAGE_TAG="$TAG" $COMPOSE build

# ── 換上去 ──────────────────────────────────────────────────
log "啟動新版本"
IMAGE_TAG="$TAG" $COMPOSE up -d

# ── 驗收 ────────────────────────────────────────────────────
log "等待服務就緒"
sleep 10
if ./deploy/healthcheck.sh; then
  echo "$TAG" > "$LAST_GOOD"
  log "部署成功，已記錄 $TAG 為最後一個健康版本"
else
  fail "健康檢查未通過"
  if [ -n "$PREVIOUS" ]; then
    log "自動回滾到 $PREVIOUS"
    IMAGE_TAG="$PREVIOUS" $COMPOSE up -d --no-build
    ./deploy/healthcheck.sh || fail "回滾之後仍不健康，需要人工介入"
  else
    fail "沒有可回滾的版本，服務目前處於新版本但不健康的狀態"
  fi
  exit 1
fi
