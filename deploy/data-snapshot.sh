#!/usr/bin/env bash
#
# 把「人做出來的資料」印成一份可直接倒回去的 SQL（標準輸出）。
#
#   ./deploy/data-snapshot.sh                 # 全部表，含空表（拿來當備份）
#   ./deploy/data-snapshot.sh --skip-empty    # 略過沒有資料的表（拿來送上別台）
#
# 本機（vm.sh syncdata 匯出）和部署機（覆蓋前備份）都跑這一支，所以兩邊格式一樣：
# 每張表是「DELETE 這張表 → COPY 整份資料」，用 psql -1 倒進去就是整批替換，
# 中途有一張表失敗就整批不生效。備份檔也能用同一個方式倒回去。
#
# 要找資料庫容器：DOCKER（預設 docker；部署機上傳 "sudo docker"）、
# DB_CONTAINER（預設 syncdrive_postgres）。帳號與資料庫名稱讀容器自己的
# POSTGRES_USER／POSTGRES_DB，兩邊不用各自設定。
#
# 只帶定義與設定，不帶執行痕跡（訂單、遙測、稽核、事件、格位即時狀態），
# 也不帶每台機器自己的東西（協力廠商 API 金鑰、帳號）。

set -euo pipefail

DOCKER="${DOCKER:-docker}"
CONTAINER="${DB_CONTAINER:-syncdrive_postgres}"
SKIP_EMPTY=false
[ "${1:-}" = "--skip-empty" ] && SKIP_EMPTY=true

# 表名|篩選條件（空的就是整張表）
#
# system_settings 只帶 system.*（系統基礎模組、監控門檻）。其餘是執行狀態：
# 每日計畫採用紀錄、營運時鐘、調度開關，跟著那台機器的營運走，不能拿本機的蓋過去。
SPECS=(
  "dashboard_planes|"
  "module_dashboard_pages|"
  "data_sources|"
  "operation_shifts|"
  "time_templates|"
  "maintenance_tasks|"
  "operation_routes|"
  "operation_route_stations|"
  "operation_route_station_actions|"
  "facility_slots|"
  "vehicles|"
  "vehicle_definitions|"
  "speed_limit_configs|"
  "media_library_items|"
  "media_schedules|"
  "maps|"
  "map_versions|"
  "system_settings|WHERE setting_key LIKE 'system.%'"
)

psql_in() {
  $DOCKER exec -i "$CONTAINER" sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

echo "-- SyncDrive 人為資料快照 $(date '+%Y-%m-%d %H:%M:%S')"
echo "SET client_encoding = 'UTF8';"

for spec in "${SPECS[@]}"; do
  table="${spec%%|*}"
  where="${spec#*|}"
  exists="$(psql_in <<<"SELECT to_regclass('public.$table') IS NOT NULL;")"
  if [ "$exists" != t ]; then
    echo "-- $table：這台沒有這張表，略過"
    continue
  fi
  count="$(psql_in <<<"SELECT count(*) FROM public.$table $where;")"
  if [ "$SKIP_EMPTY" = true ] && [ "$count" = 0 ]; then
    echo "-- $table：沒有資料，略過（對方保留原樣）"
    continue
  fi
  cols="$(psql_in <<<"SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
                       FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = '$table';")"
  echo "-- $table：$count 筆"
  echo "DELETE FROM public.$table $where;"
  echo "COPY public.$table ($cols) FROM stdin;"
  psql_in <<<"COPY (SELECT $cols FROM public.$table $where) TO STDOUT;"
  echo '\.'
done
