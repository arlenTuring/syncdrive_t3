#!/usr/bin/env bash
#
# 從<strong>目前這台機器</strong>匯出一份種子資料，供新機器起步用。
#
#   ./deploy/seed-export.sh
#
# 為什麼不是整庫備份：新機器要的是「能開始運作的最小組合」，不是開發過程的
# 殘渣。本機的 operation_orders 有四千多筆模擬器產生的假訂單，帶過去只會讓
# 之後的班次紀錄查詢一團亂。所以這裡<strong>逐表挑選</strong>。
#
# 地圖是檔案不是資料表（backend/data/published-maps/），而且被 .gitignore 擋著
# ——不管用哪種方式送程式碼都不會跟著走，只能在這裡一起打包。少了它，班表 API
# 查得到班次卻查不到停靠點別名，健康檢查照樣 200 但回傳的內容是殘缺的。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

CONTAINER="${DB_CONTAINER:-syncdrive_postgres}"
DB_USER="${DB_USER:-syncdrive_user}"
DB_NAME="${DB_NAME:-syncdrive_t3}"
OUT_DIR="$ROOT/deploy/seed"
mkdir -p "$OUT_DIR"

# 要帶的：定義與計畫。不帶的：訂單、遙測、稽核紀錄、事件——那些是執行痕跡，
# 新機器應該從零開始累積自己的。
TABLES=(
  operation_shifts
  time_templates
  maintenance_tasks
  vehicles
  vehicle_definitions
  facility_slots
  operation_routes
  operation_route_stations
  operation_route_station_actions
  dashboard_planes
  module_dashboard_pages
)

ARGS=()
for t in "${TABLES[@]}"; do ARGS+=(-t "$t"); done

log "匯出 ${#TABLES[@]} 張資料表"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --data-only --column-inserts --on-conflict-do-nothing \
  "${ARGS[@]}" > "$OUT_DIR/seed.dump"

log "打包已發布地圖"
if [ -d "$ROOT/backend/data/published-maps" ]; then
  tar -czf "$OUT_DIR/published-maps.tar.gz" \
    -C "$ROOT/backend/data" published-maps
else
  log "  （找不到 backend/data/published-maps，略過）"
fi

log "完成"
ls -lh "$OUT_DIR" | tail -n +2 | awk '{printf "  %-28s %s\n", $9, $5}'
