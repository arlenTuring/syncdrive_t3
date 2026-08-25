#!/usr/bin/env bash
#
# 新機一次性設定。在 GCP VM 上跑一次，之後更新都用 deploy.sh。
#
#   sudo ./deploy/bootstrap.sh
#
# 做四件事：裝 Docker、產生 deploy/.env（含隨機密鑰）、設定主機防火牆、
# 收緊 TimescaleDB 的壓縮政策。每一步都可重複執行，做過的會跳過。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m警告：\033[0m %s\n' "$*"; }

# ── 1. Docker ───────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  log "Docker 已安裝：$(docker --version)"
else
  log "安裝 Docker"
  curl -fsSL https://get.docker.com | sh
  # 讓部署帳號不必每次 sudo
  if [ -n "${SUDO_USER:-}" ]; then
    usermod -aG docker "$SUDO_USER"
    warn "已把 $SUDO_USER 加入 docker 群組——需重新登入才會生效"
  fi
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "找不到 docker compose plugin，請先安裝 docker-compose-plugin" >&2
  exit 1
fi

# ── 2. 環境變數 ─────────────────────────────────────────────
ENV_FILE="$ROOT/deploy/.env"
if [ -f "$ENV_FILE" ]; then
  log "deploy/.env 已存在，保留不動"
else
  log "由 .env.example 產生 deploy/.env，並隨機產生密鑰"
  cp "$ROOT/deploy/.env.example" "$ENV_FILE"
  # 密鑰用 openssl 產生，不要人工想——人工想出來的密碼會被重複使用
  DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
  API_KEY="$(openssl rand -hex 24)"
  sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" "$ENV_FILE"
  sed -i "s|^VTMS_API_KEY=.*|VTMS_API_KEY=${API_KEY}|" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "對外 API 金鑰（交給協力廠商）：${API_KEY}"
fi

# ── 3. 主機防火牆 ───────────────────────────────────────────
# GCP 的 VPC 防火牆是第一道，這裡是第二道。兩道都要。
if command -v ufw >/dev/null 2>&1; then
  log "設定 ufw：只放行 SSH、80、3100"
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 3100/tcp >/dev/null
  ufw --force enable >/dev/null
  ufw status numbered
else
  warn "沒有 ufw，略過主機防火牆。請確認 GCP VPC 規則只開 22／80／3100"
fi

# ── 4. 起服務 ───────────────────────────────────────────────
log "建置並啟動"
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build

log "等待資料庫就緒"
for _ in $(seq 1 60); do
  if docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
      exec -T postgres pg_isready -q; then break; fi
  sleep 2
done

# ── 5. TimescaleDB 政策 ─────────────────────────────────────
# 預設是「7 天後壓縮、7 天後刪」——壓縮永遠等不到生效就被刪了。
# 改成 1 天後壓縮，磁碟大致省 5–10 倍，查詢舊資料仍然可用。
log "收緊時序資料壓縮政策（1 天後壓縮、7 天後刪除）"
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
  exec -T postgres psql -U "$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2)" \
  -d "$(grep '^DB_NAME=' "$ENV_FILE" | cut -d= -f2)" <<'SQL' || warn "政策調整略過（資料表可能尚未建立，之後再跑一次即可）"
SELECT remove_compression_policy('telemetry_logs', if_exists => true);
SELECT add_compression_policy('telemetry_logs', INTERVAL '1 day');
SQL

log "完成。接著跑 ./deploy/healthcheck.sh 驗收"
