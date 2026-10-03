#!/usr/bin/env bash
#
# 把 seed-export.sh 匯出的種子資料倒進<strong>這台機器</strong>。
#
#   ./deploy/seed-restore.sh
#
# 匯入是<strong>可重複執行</strong>的：dump 以 ON CONFLICT DO NOTHING 產生，
# 已存在的資料不會被覆寫也不會報錯。想要換成另一份班表時請自行先刪，
# 這支腳本刻意不做刪除——在一台可能已經在營運的機器上自動刪資料太危險。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m失敗：\033[0m %s\n' "$*" >&2; exit 1; }

SEED_DIR="$ROOT/deploy/seed"
[ -f "$SEED_DIR/seed.dump" ] || die "找不到 $SEED_DIR/seed.dump"

ENV_FILE="$ROOT/deploy/.env"
[ -f "$ENV_FILE" ] || die "找不到 deploy/.env，請先跑 ./deploy/bootstrap.sh"
DB_USER="$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2)"
DB_NAME="$(grep '^DB_NAME=' "$ENV_FILE" | cut -d= -f2)"
COMPOSE="docker compose -f deploy/docker-compose.prod.yml --env-file $ENV_FILE"

# ── 1. 資料表 ───────────────────────────────────────────────
if $COMPOSE ps --services 2>/dev/null | grep -qx postgres; then
  log "匯入資料表（內建資料庫）"
  $COMPOSE exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -q < "$SEED_DIR/seed.dump"
else
  # 外部資料庫：用 psql 直連。DB_HOST 由 .env 指定
  command -v psql >/dev/null 2>&1 || die "使用外部資料庫時需要本機有 psql"
  DB_HOST="$(grep '^DB_HOST=' "$ENV_FILE" | cut -d= -f2)"
  DB_PASSWORD="$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2)"
  log "匯入資料表（外部資料庫 ${DB_HOST}）"
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -q < "$SEED_DIR/seed.dump"
fi

# ── 2. 已發布地圖 ───────────────────────────────────────────
# 後端從檔案讀已發布地圖（station-alias.ts），不是從資料庫。
if [ -f "$SEED_DIR/published-maps.tar.gz" ]; then
  log "還原已發布地圖"
  mkdir -p "$ROOT/backend/data"
  tar -xzf "$SEED_DIR/published-maps.tar.gz" -C "$ROOT/backend/data"
  # 後端容器裡也要有一份——映像不含 data/，所以複製進去
  $COMPOSE cp "$ROOT/backend/data/published-maps" backend:/app/data/published-maps \
    || log "  （後端容器尚未啟動，稍後重啟時會由掛載帶入）"
fi

log "完成。用 ./deploy/healthcheck.sh 確認，或直接打："
echo "  curl -s http://127.0.0.1:3100/syncdrive-api/operation-shift/timetable/trips | head -c 200"
