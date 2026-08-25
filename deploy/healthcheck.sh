#!/usr/bin/env bash
#
# 部署驗收。deploy.sh 會呼叫它決定要不要回滾，也可以自己跑。
#
#   ./deploy/healthcheck.sh
#   BASE_INTERNAL=http://10.140.0.5 BASE_EXTERNAL=http://10.140.0.5:3100 ./deploy/healthcheck.sh
#
# 檢查的不只是「服務有沒有起來」，還包括<strong>對外邊界有沒有真的擋住</strong>。
# 內部端點從對外埠打進去必須是 404——那是這套部署最容易在改動中被弄壞的一件事，
# 而且壞掉時服務看起來完全正常。

set -uo pipefail

INTERNAL="${BASE_INTERNAL:-http://127.0.0.1}"
EXTERNAL="${BASE_EXTERNAL:-http://127.0.0.1:3100}"

pass=0
fail=0

check() {
  local label="$1" url="$2" want="$3"
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo 000)"
  if [ "$got" = "$want" ]; then
    printf '  \033[1;32m✓\033[0m %-46s %s\n' "$label" "$got"
    pass=$((pass + 1))
  else
    printf '  \033[1;31m✗\033[0m %-46s 期望 %s，實際 %s\n' "$label" "$want" "$got"
    fail=$((fail + 1))
  fi
}

echo "內部（$INTERNAL）"
check "前端首頁"            "$INTERNAL/"                                        200
check "內部 API：班表清單"   "$INTERNAL/syncdrive-api/operation-shift/list"      200
check "內部 Swagger"        "$INTERNAL/api/docs"                                200
check "文件站"              "$INTERNAL/docs/"                                   200

echo "對外（$EXTERNAL）"
check "對外 Swagger"        "$EXTERNAL/api/docs/public"                         200
check "班表班次"            "$EXTERNAL/syncdrive-api/operation-shift/timetable/trips"       200
check "班表站點 ETA"        "$EXTERNAL/syncdrive-api/operation-shift/timetable/station-etas" 200
check "即時 ETA：依站"      "$EXTERNAL/syncdrive-api/vehicles/eta/by-station"    200
check "即時 ETA：依車"      "$EXTERNAL/syncdrive-api/vehicles/eta/by-vehicle"    200

echo "對外邊界（這幾條必須是 404）"
check "內部端點不可從對外埠打到" "$EXTERNAL/syncdrive-api/operation-shift/list"  404
check "內部 Swagger 不可從對外埠打到" "$EXTERNAL/api/docs"                       404
check "資料庫查詢端點不可外露"   "$EXTERNAL/syncdrive-api/datasource/tables"     404

echo "參數驗證"
check "值域外的參數回 400"  "$EXTERNAL/syncdrive-api/vehicles/eta/by-station?limit_per_station=99" 400

printf '\n通過 %d 項，失敗 %d 項\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
