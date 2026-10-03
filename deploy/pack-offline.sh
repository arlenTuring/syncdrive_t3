#!/usr/bin/env bash
#
# 產出<strong>安裝成品</strong>：一個 tar.gz，帶著所有映像與腳本。
#
#   ./deploy/pack-offline.sh            # 用目前 commit 當版號
#   ./deploy/pack-offline.sh v0.4.1     # 指定版號
#
# <strong>這是唯一的安裝來源</strong>——雲端 VM 與進場實體伺服器裝的是同一個檔案。
# 目標機器就算有網路也不在上面建置：一旦在目標機器 npm ci、docker pull，安裝出來
# 的東西就取決於「那一天 registry 給了什麼」，測試過的與現場跑的不再是同一份。
# 建置只發生一次，成品拿去哪裡裝都一樣。
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

# 版本來源：參數 > git > deploy/.source-commit（打包機通常只有程式碼、沒有 .git，
# 那份檔案由傳送端寫入，讓 MANIFEST 記得住這一包對應哪一個 commit）
SOURCE_COMMIT="$(cat deploy/.source-commit 2>/dev/null || true)"
SOURCE_COMMIT="${SOURCE_COMMIT:-$(git rev-parse HEAD 2>/dev/null || true)}"
TAG="${1:-}"
if [ -z "$TAG" ]; then
  TAG="$(git rev-parse --short HEAD 2>/dev/null || true)"
  [ -z "$TAG" ] && [ -n "$SOURCE_COMMIT" ] && TAG="${SOURCE_COMMIT:0:7}"
  TAG="${TAG:-manual}"
fi
HOST_ARCH="$(docker version --format '{{.Server.Arch}}' 2>/dev/null || uname -m)"
log "打包版本 ${TAG}（本機架構 ${HOST_ARCH}）"
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
# 版本一律讀 deploy/images.lock 的 digest，不用 tag——tag 是可變的
# 用 while read 而不是 readarray：macOS 內建的是 bash 3.2，沒有 readarray，
# 而打包機不見得永遠是 Linux
THIRD_PARTY=()
while IFS= read -r line; do
  [ -n "$line" ] && THIRD_PARTY+=("$line")
done < <(awk '$1=="postgres"||$1=="redis"||$1=="mosquitto" {print $2"@"$3}' deploy/images.lock)
[ "${#THIRD_PARTY[@]}" -eq 3 ] || die "images.lock 讀不到三個第三方映像"
log "第三方映像（釘在 digest）："
printf '     %s\n' "${THIRD_PARTY[@]}"
for image in "${THIRD_PARTY[@]}"; do
  docker image inspect "$image" >/dev/null 2>&1 || {
    log "拉取 $image"
    docker pull "$image" || die "拉不到 ${image}（這一步需要外網）"
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
cp deploy/.env.example deploy/images.lock "$PKG/deploy/"
cp deploy/install.sh deploy/bootstrap.sh deploy/deploy.sh deploy/healthcheck.sh "$PKG/deploy/"
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

# 成品裡要能回答「這一包到底是什麼」——出問題時第一個要查的就是這個
{
  echo "package    syncdrive-t3"
  echo "version    ${TAG}"
  echo "git        ${SOURCE_COMMIT:-（來源 commit 未知）}"
  echo "arch       ${HOST_ARCH}"
  echo "built_on   $(uname -sr)"
  echo ""
  echo "images"
  docker image inspect --format '  {{index .RepoTags 0}}  {{.Id}}' \
    "syncdrive-backend:$TAG" "syncdrive-web:$TAG" 2>/dev/null || true
  printf '  %s\n' "${THIRD_PARTY[@]}"
} > "$PKG/MANIFEST.txt"

cat > "$PKG/安裝說明.txt" <<EOF
SyncDrive T3 離線安裝包
版本：${TAG}
架構：${HOST_ARCH}

在目標主機上，一行完成：

  tar xzf syncdrive-t3-${TAG}.tar.gz && cd syncdrive-t3 && sudo ./deploy/install.sh

install.sh 會依序做：檢查前置條件（Docker、磁碟、記憶體）→ 安裝並啟動 →
匯入起始資料（班表與地圖）→ 驗收 → 印出這台機器的入口網址與帳密。
每一步失敗都會停下來說明原因，不會留下半套狀態。

需求：已安裝 Docker Engine 與 docker compose plugin（本包不含 Docker 本身）。
安裝過程完全不需要外網。

要逐步執行時，install.sh 串的就是這三支，個別跑效果相同：
  ./deploy/bootstrap.sh     安裝
  ./deploy/seed-restore.sh  匯入起始資料
  ./deploy/healthcheck.sh   驗收
EOF

# ── 4. 打包 ────────────────────────────────────────────────
ARCHIVE="$OUT_DIR/syncdrive-t3-${TAG}.tar.gz"
log "打包 → $ARCHIVE"
tar -czf "$ARCHIVE" -C "$STAGE" syncdrive-t3
log "完成：$(du -h "$ARCHIVE" | cut -f1)  $ARCHIVE"
