#!/usr/bin/env bash
#
# 產出<strong>離線安裝包</strong>：一個 tar.gz，帶著所有映像與腳本，
# 拿到沒有外網的進場主機上解開就能裝。
#
#   ./deploy/pack-offline.sh            # 用目前 commit 當版號
#   ./deploy/pack-offline.sh v0.4.1     # 指定版號
#
# <strong>必須在 CPU 架構與目標機器相同的機器上執行。</strong>開發用的 Mac 是
# arm64，進場主機與 GCP VM 是 amd64——在 Mac 上 docker save 出來的映像放到
# amd64 機器會以 "exec format error" 收場，而那個訊息跟真正的原因看起來毫無關聯。
# 最省事的做法是拿 GCP 那台 VM 當打包機：它本來就是 amd64，也本來就要建置。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m失敗：\033[0m %s\n' "$*" >&2; exit 1; }

TAG="${1:-$(git rev-parse --short HEAD 2>/dev/null || echo manual)}"
HOST_ARCH="$(docker version --format '{{.Server.Arch}}' 2>/dev/null || uname -m)"
log "打包版本 $TAG（本機架構 $HOST_ARCH）"
case "$HOST_ARCH" in
  amd64|x86_64) ;;
  *) printf '\033[1;33m警告：\033[0m 目前架構是 %s。若目標機器是 amd64，這個包在那邊起不來。\n' "$HOST_ARCH" ;;
esac

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
OUT_DIR="$ROOT/deploy/dist"
mkdir -p "$OUT_DIR"
PKG="$STAGE/syncdrive-t3"
mkdir -p "$PKG/deploy/images"

COMPOSE="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.example"

# ── 1. 建置自家映像 ────────────────────────────────────────
log "建置 backend 與 web"
IMAGE_TAG="$TAG" $COMPOSE build

# ── 2. 連同第三方映像一起存 ────────────────────────────────
# 第三方映像也要帶。進場主機拉不到 Docker Hub，少一個就起不來。
THIRD_PARTY=(
  "timescale/timescaledb:2.19.3-pg15"
  "redis:7-alpine"
  "eclipse-mosquitto:2"
)
for image in "${THIRD_PARTY[@]}"; do
  docker image inspect "$image" >/dev/null 2>&1 || {
    log "拉取 $image"
    docker pull "$image" || die "拉不到 $image（這一步需要外網）"
  }
done

log "匯出映像"
docker save -o "$PKG/deploy/images/syncdrive.tar" \
  "syncdrive-backend:$TAG" "syncdrive-web:$TAG"
docker save -o "$PKG/deploy/images/thirdparty.tar" "${THIRD_PARTY[@]}"

# ── 3. 帶上執行所需的檔案 ──────────────────────────────────
# 只帶執行需要的東西：映像裡已經有編譯後的程式，原始碼不必進安裝包。
log "收集設定與腳本"
cp deploy/docker-compose.prod.yml "$PKG/deploy/"
cp deploy/nginx.conf "$PKG/deploy/"
cp deploy/.env.example "$PKG/deploy/"
cp deploy/bootstrap.sh deploy/deploy.sh deploy/healthcheck.sh "$PKG/deploy/"
cp deploy/seed-restore.sh "$PKG/deploy/" 2>/dev/null || true
cp deploy/README.md "$PKG/deploy/"
mkdir -p "$PKG/mosquitto"
cp -R mosquitto/config "$PKG/mosquitto/"

# 映像標籤要寫進 .env.example，否則 bootstrap 會去找 :latest 而載入的是 :$TAG
sed -i.bak "s|^IMAGE_TAG=.*|IMAGE_TAG=${TAG}|" "$PKG/deploy/.env.example"
rm -f "$PKG/deploy/.env.example.bak"

# 種子資料（班表與地圖）有就帶
if [ -f "$ROOT/deploy/seed/seed.dump" ]; then
  log "帶上種子資料"
  mkdir -p "$PKG/deploy/seed"
  cp -R "$ROOT/deploy/seed/." "$PKG/deploy/seed/"
fi

cat > "$PKG/安裝說明.txt" <<EOF
SyncDrive T3 離線安裝包
版本：${TAG}
架構：${HOST_ARCH}

在目標主機上：

  tar xzf syncdrive-t3-${TAG}.tar.gz
  cd syncdrive-t3
  sudo ./deploy/bootstrap.sh
  ./deploy/healthcheck.sh

需求：已安裝 Docker Engine 與 docker compose plugin（本包不含 Docker 本身）。
安裝過程完全不需要外網。
EOF

# ── 4. 打包 ────────────────────────────────────────────────
ARCHIVE="$OUT_DIR/syncdrive-t3-${TAG}.tar.gz"
log "打包 → $ARCHIVE"
tar -czf "$ARCHIVE" -C "$STAGE" syncdrive-t3
log "完成：$(du -h "$ARCHIVE" | cut -f1)  $ARCHIVE"
