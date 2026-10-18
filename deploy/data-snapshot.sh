#!/usr/bin/env bash
#
# 把「人做出來的資料」印成一份可安全合併的 SQL（標準輸出）。
#
#   ./deploy/data-snapshot.sh                 # 全部表，含空表（拿來當備份）
#   ./deploy/data-snapshot.sh --skip-empty    # 略過沒有資料的表（拿來送上別台）
#
# 每張表先 COPY 到交易內暫存表，再依主鍵 UPDATE／INSERT。遠端獨有資料不刪除，
# 避免訂單、歷史或執行中資料仍引用主檔時被 DELETE 破壞。整份輸出需用 psql -1
# 套用；本機空表配合 --skip-empty 會明確略過，不清空遠端。
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
  "media_play_schedules|"
  "media_play_schedule_items|"
  "maps|"
  "map_versions|"
  "system_settings|WHERE setting_key LIKE 'system.%'"
)

psql_in() {
  if [ -n "${DB_NAME_OVERRIDE:-}" ]; then
    $DOCKER exec -i -e "POSTGRES_DB=$DB_NAME_OVERRIDE" "$CONTAINER" sh -c \
      'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  else
    $DOCKER exec -i "$CONTAINER" sh -c \
      'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  fi
}

echo "-- SyncDrive 人為資料快照 $(date '+%Y-%m-%d %H:%M:%S')"
echo "SET client_encoding = 'UTF8';"

for spec in "${SPECS[@]}"; do
  table="${spec%%|*}"
  where="${spec#*|}"
  exists="$(psql_in <<<"SELECT to_regclass('public.$table') IS NOT NULL;")"
  if [ "$exists" != t ]; then
    echo "-- ${table}：這台沒有這張表，略過"
    continue
  fi
  count="$(psql_in <<<"SELECT count(*) FROM public.$table $where;")"
  if [ "$SKIP_EMPTY" = true ] && [ "$count" = 0 ]; then
    echo "-- ${table}：沒有資料，略過（對方保留原樣）"
    continue
  fi
  cols="$(psql_in <<<"SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
                       FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = '$table';")"
  pk_cols="$(psql_in <<<"SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ordinality)
    FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ordinality)
    JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
    WHERE i.indrelid='public.$table'::regclass AND i.indisprimary;")"
  [ -n "$pk_cols" ] || { echo "資料表 $table 沒有主鍵，拒絕產生不安全同步" >&2; exit 1; }
  updates="$(psql_in <<<"SELECT string_agg(format('%1\$I = EXCLUDED.%1\$I', c.column_name), ', ' ORDER BY c.ordinal_position)
    FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name='$table'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        CROSS JOIN LATERAL unnest(i.indkey) k(attnum)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
        WHERE i.indrelid='public.$table'::regclass AND i.indisprimary AND a.attname=c.column_name
      );")"
  staging="sync_${table}"
  echo "-- ${table}：$count 筆"
  echo "CREATE TEMP TABLE $staging (LIKE public.$table INCLUDING DEFAULTS) ON COMMIT DROP;"
  echo "COPY $staging ($cols) FROM stdin;"
  psql_in <<<"COPY (SELECT $cols FROM public.$table $where) TO STDOUT;"
  echo '\.'
  if [ -n "$updates" ]; then
    echo "INSERT INTO public.$table ($cols) SELECT $cols FROM $staging ON CONFLICT ($pk_cols) DO UPDATE SET $updates;"
  else
    echo "INSERT INTO public.$table ($cols) SELECT $cols FROM $staging ON CONFLICT ($pk_cols) DO NOTHING;"
  fi
done
