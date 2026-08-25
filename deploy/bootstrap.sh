#!/usr/bin/env bash
#
# 一鍵安裝。<strong>雲端 VM 與進場實體伺服器共用同一支</strong>，跑一次即可，
# 之後更新用 deploy.sh。
#
#   sudo ./deploy/bootstrap.sh
#
# <strong>安裝一律使用現成映像，不在目標機器建置。</strong>目標機器就算有網路也一樣
# ——在上面 npm ci、docker pull，裝出來的東西就取決於「那一天 registry 給了什麼」，
# 測試過的與現場跑的不再是同一份，而這種問題最難查，因為程式碼完全沒動。
#
# 映像來源依序：
#
#   1. deploy/images/*.tar  → docker load（安裝包帶來的，完全不碰網路）
#   2. 本機 docker 已有該標籤 → 直接用（打包機自己安裝時就是這條）
#   3. 都沒有 → 停下來並說明，除非明確加 --build
#
#   --build   在這台機器建置。只有打包機該用，或臨時除錯。會拉 base image
#             與 npm 套件，因此有版本漂移風險。
#
# 做的事：確認 Docker、產生 deploy/.env、設定主機防火牆、起服務、收緊時序資料
# 壓縮政策。每一步都可重複執行，做過的會跳過。

set -euo pipefail

ALLOW_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --build) ALLOW_BUILD=true ;;
    *) echo "未知參數：$arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m警告：\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m失敗：\033[0m %s\n' "$*" >&2; exit 1; }

COMPOSE_FILE="deploy/docker-compose.prod.yml"
ENV_FILE="$ROOT/deploy/.env"
IMAGE_DIR="$ROOT/deploy/images"

# ── 1. Docker ───────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  log "Docker 已安裝：$(docker --version)"
elif [ -d "$IMAGE_DIR" ]; then
  # 有離線包卻沒有 Docker：這台機器多半也沒有外網，裝不了
  die "沒有 Docker，而且這是離線安裝。請先由系統管理員安裝 Docker Engine 與 compose plugin。"
else
  log "安裝 Docker"
  curl -fsSL https://get.docker.com | sh \
    || die "Docker 安裝失敗（無外網？）。請改用離線安裝包，或先手動安裝 Docker。"
  if [ -n "${SUDO_USER:-}" ]; then
    usermod -aG docker "$SUDO_USER" || true
    warn "已把 $SUDO_USER 加入 docker 群組——需重新登入才會生效"
  fi
fi

docker compose version >/dev/null 2>&1 \
  || die "找不到 docker compose plugin，請安裝 docker-compose-plugin"

# ── 2. 環境變數 ─────────────────────────────────────────────
if [ -f "$ENV_FILE" ]; then
  log "deploy/.env 已存在，保留不動"
else
  log "由 .env.example 產生 deploy/.env，並隨機產生密鑰"
  cp "$ROOT/deploy/.env.example" "$ENV_FILE"
  DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
  API_KEY="$(openssl rand -hex 24)"
  sed -i.bak "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" "$ENV_FILE"
  sed -i.bak "s|^VTMS_API_KEY=.*|VTMS_API_KEY=${API_KEY}|" "$ENV_FILE"
  rm -f "$ENV_FILE.bak"
  chmod 600 "$ENV_FILE"
  log "對外 API 金鑰（交給協力廠商）：${API_KEY}"
fi

COMPOSE="docker compose -f $COMPOSE_FILE --env-file $ENV_FILE"

# ── 3. 主機防火牆 ───────────────────────────────────────────
# 只放行 SSH、80（我方）、3100（協力廠商）。雲端上這是第二道（第一道是 VPC
# 規則）；進場主機上這往往是唯一一道，所以三種常見工具都要能處理。
open_ports=(22 80 3100)
if command -v ufw >/dev/null 2>&1; then
  log "設定 ufw"
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  for p in "${open_ports[@]}"; do ufw allow "$p"/tcp >/dev/null; done
  ufw --force enable >/dev/null
  ufw status
elif command -v firewall-cmd >/dev/null 2>&1; then
  log "設定 firewalld"
  for p in "${open_ports[@]}"; do
    firewall-cmd --permanent --add-port="$p"/tcp >/dev/null
  done
  firewall-cmd --reload >/dev/null
  firewall-cmd --list-ports
else
  warn "找不到 ufw 或 firewalld，略過主機防火牆設定。"
  warn "請自行確認只有 ${open_ports[*]} 對外開放——尤其 3100 是給協力廠商的唯一入口。"
fi

# ── 4. 取得映像 ─────────────────────────────────────────────
IMAGE_TAG_VALUE="$(grep '^IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2)"
IMAGE_TAG_VALUE="${IMAGE_TAG_VALUE:-latest}"
have_local_images() {
  docker image inspect "syncdrive-backend:$IMAGE_TAG_VALUE" >/dev/null 2>&1 \
    && docker image inspect "syncdrive-web:$IMAGE_TAG_VALUE" >/dev/null 2>&1
}

if [ -d "$IMAGE_DIR" ] && compgen -G "$IMAGE_DIR/*.tar" >/dev/null; then
  log "由安裝包匯入映像（不碰網路）"
  for tarball in "$IMAGE_DIR"/*.tar; do
    log "  docker load < $(basename "$tarball")"
    docker load -i "$tarball"
  done
  $COMPOSE up -d --no-build
elif have_local_images; then
  log "使用本機既有映像 :$IMAGE_TAG_VALUE"
  $COMPOSE up -d --no-build
elif [ "$ALLOW_BUILD" = true ]; then
  warn "在這台機器建置——會拉取 base image 與 npm 套件，裝出來的內容取決於當下的 registry"
  $COMPOSE up -d --build
else
  die "找不到映像（deploy/images/*.tar 不存在，本機也沒有 :$IMAGE_TAG_VALUE）。
   正常安裝請使用 pack-offline.sh 產出的安裝包。
   若這台就是打包機、確實要在此建置，請改跑：sudo ./deploy/bootstrap.sh --build"
fi

# ── 5. 等待資料庫 ───────────────────────────────────────────
if $COMPOSE ps --services 2>/dev/null | grep -qx postgres; then
  log "等待內建資料庫就緒"
  for _ in $(seq 1 60); do
    $COMPOSE exec -T postgres pg_isready -q && break
    sleep 2
  done

  # ── 6. 時序資料壓縮政策 ─────────────────────────────────
  # 預設是「7 天後壓縮、7 天後刪」——壓縮永遠等不到生效就被刪了。
  # 改成 1 天後壓縮，磁碟大致省 5–10 倍，查詢舊資料仍然可用。
  log "收緊時序資料壓縮政策（1 天後壓縮、7 天後刪除）"
  DB_U="$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2)"
  DB_N="$(grep '^DB_NAME=' "$ENV_FILE" | cut -d= -f2)"
  $COMPOSE exec -T postgres psql -U "$DB_U" -d "$DB_N" <<'SQL' \
    || warn "政策調整略過（資料表可能尚未建立，之後再跑一次即可）"
SELECT remove_compression_policy('telemetry_logs', if_exists => true);
SELECT add_compression_policy('telemetry_logs', INTERVAL '1 day');
SQL
else
  log "使用外部資料庫（COMPOSE_PROFILES 未含 bundled-db），略過內建資料庫設定"
fi

log "完成。接著跑 ./deploy/healthcheck.sh 驗收"
if [ -f "$ROOT/deploy/seed/seed.dump" ]; then
  log "偵測到種子資料，可用 ./deploy/seed-restore.sh 匯入班表與地圖"
fi
