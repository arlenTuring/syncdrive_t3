#!/usr/bin/env bash
#
#   ██████ SyncDrive T3 一鍵安裝
#
# 在<strong>目標主機</strong>上執行，從安裝包解開之後只要跑這一支：
#
#   sudo ./deploy/install.sh
#
# 它把原本要記住的四個步驟收成一個：檢查前置條件 → 安裝 → 匯入種子資料 → 驗收，
# 每一步失敗都會停下來說清楚下一步該做什麼，不會留下半套狀態。
#
# 選項（通常不需要）：
#   --no-seed     不匯入種子資料（機器上已有正式資料時用）
#   --build       在這台機器建置（只有打包機需要；會有版本漂移風險）
#   --yes         不要互動確認，全部照預設值跑
#
# 這支只是把既有腳本串起來，沒有自己的邏輯：
#   bootstrap.sh → seed-restore.sh → healthcheck.sh
# 個別執行那三支的效果完全相同，出問題時可以逐步跑。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NO_SEED=false
ALLOW_BUILD=false
ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --no-seed) NO_SEED=true ;;
    --build)   ALLOW_BUILD=true ;;
    --yes|-y)  ASSUME_YES=true ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知參數：$arg（--help 看用法）" >&2; exit 2 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

cat <<'BANNER'

  SyncDrive T3 車輛行車管理系統
  ─────────────────────────────
BANNER

# ── 0. 前置條件 ─────────────────────────────────────────────
step "檢查前置條件"

[ "$(id -u)" -eq 0 ] || die "請用 sudo 執行：sudo ./deploy/install.sh"

command -v docker >/dev/null 2>&1 \
  || die "找不到 Docker。請先安裝 Docker Engine 與 compose plugin。
   Debian/Ubuntu：curl -fsSL https://get.docker.com | sh
   離線環境請向系統管理員索取離線套件。"
docker compose version >/dev/null 2>&1 \
  || die "找不到 docker compose plugin（docker-compose-plugin）。"
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"

HAS_IMAGES=false
if compgen -G "$ROOT/deploy/images/*.tar" >/dev/null; then
  HAS_IMAGES=true
  ok "偵測到離線映像包，安裝過程不需要網路"
elif [ "$ALLOW_BUILD" = true ]; then
  warn "將在這台機器建置——需要網路，且安裝內容取決於當下的套件庫"
else
  die "找不到映像（deploy/images/*.tar）。
   這個目錄看起來不是完整的安裝包。請使用 pack-offline.sh 產出的 tar.gz，
   或在打包機上加 --build 重新建置。"
fi

AVAIL_GB=$(df -BG --output=avail "$ROOT" 2>/dev/null | tail -1 | tr -dc '0-9' || echo 0)
if [ "${AVAIL_GB:-0}" -lt 20 ]; then
  warn "可用磁碟只有 ${AVAIL_GB}G。映像與資料庫至少需要 20G，建議 50G 以上"
else
  ok "可用磁碟 ${AVAIL_GB}G"
fi

TOTAL_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo 0)
if [ "${TOTAL_MB:-0}" -gt 0 ] && [ "$TOTAL_MB" -lt 3500 ]; then
  warn "記憶體只有 ${TOTAL_MB}MB，資料庫與後端可能不穩，建議 8G 以上"
else
  ok "記憶體 ${TOTAL_MB}MB"
fi

if [ "$ASSUME_YES" = false ]; then
  printf '\n  接著會安裝並啟動全部服務。繼續？[Y/n] '
  read -r reply </dev/tty || reply=Y
  case "${reply:-Y}" in [Nn]*) echo "已取消。"; exit 0 ;; esac
fi

# ── 1. 安裝 ─────────────────────────────────────────────────
step "安裝服務"
BOOT_ARGS=()
[ "$ALLOW_BUILD" = true ] && BOOT_ARGS+=(--build)
./deploy/bootstrap.sh "${BOOT_ARGS[@]+"${BOOT_ARGS[@]}"}" \
  || die "安裝失敗。上面的訊息是原因；修正後可重跑本指令，做過的步驟會自動跳過。"

# ── 2. 種子資料 ─────────────────────────────────────────────
if [ "$NO_SEED" = false ] && [ -f "$ROOT/deploy/seed/seed.dump" ]; then
  step "匯入起始資料（班表、時間模板、地圖）"
  # 後端要先起來才連得到資料庫
  sleep 20
  ./deploy/seed-restore.sh || warn "種子匯入未完成，可稍後單獨執行 ./deploy/seed-restore.sh"
  docker restart syncdrive_backend >/dev/null 2>&1 || true
else
  step "略過起始資料"
fi

# ── 3. 驗收 ─────────────────────────────────────────────────
step "驗收"
# 後端 health start_period 是 40 秒，太早驗收會拿到 502
sleep 45
if ./deploy/healthcheck.sh; then
  ok "全部通過"
else
  die "驗收未通過。服務已啟動但有項目異常，請看上面哪一條失敗。
   常見原因：後端尚未完全就緒（稍等 30 秒後重跑 ./deploy/healthcheck.sh）。"
fi

# ── 4. 交付資訊 ─────────────────────────────────────────────
ENV_FILE="$ROOT/deploy/.env"
read_env() { grep "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2; }
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

cat <<INFO

$(bold "安裝完成")

  內部入口   http://${IP}/portal
             帳號 $(read_env WEB_AUTH_USER) / 密碼 $(read_env WEB_AUTH_PASSWORD)
             （圖台 http://${IP}/ 不需帳密）

  對外入口   http://${IP}:3100/
             帳號 $(read_env EXTERNAL_AUTH_USER) / 密碼 $(read_env EXTERNAL_AUTH_PASSWORD)
             API 金鑰 $(read_env VTMS_API_KEY)

  MQTT       ${IP}:1883　帳密見 deploy/mqtt-credentials.txt

$(bold "接下來")

  1. 防火牆：對外只需開 80（限我方網段）、3100（廠商）、1883（車端）。
     資料庫 5432 與 Redis 6379 只綁 127.0.0.1，不要對外開。
  2. 上面這些密碼是<strong>這台機器專屬</strong>的，每次全新安裝都會重新產生。
  3. 完整說明見 deploy/README.md 與內部文件站的《系統帳號與金鑰》。

INFO
