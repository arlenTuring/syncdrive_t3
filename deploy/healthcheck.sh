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

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERNAL="${BASE_INTERNAL:-http://127.0.0.1}"
EXTERNAL="${BASE_EXTERNAL:-http://127.0.0.1:3100}"

# 對外端點需要金鑰。從 deploy/.env 讀——那個檔是 600 root，所以讀不到時用 sudo，
# 再讀不到就只跳過需要金鑰的檢查，不要讓整份驗收假性失敗。
API_KEY="${VTMS_API_KEY:-}"
if [ -z "$API_KEY" ] && [ -f "$ROOT/deploy/.env" ]; then
  API_KEY="$(grep '^VTMS_API_KEY=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
  [ -z "$API_KEY" ] && API_KEY="$(sudo grep '^VTMS_API_KEY=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
fi

# 內部（80 埠）走 nginx Basic Auth。與金鑰同樣的讀法：讀不到就不帶，
# 讓檢查照跑並以 401 呈現，而不是靜靜跳過。
WEB_USER="$(grep '^WEB_AUTH_USER=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
WEB_PASS="$(grep '^WEB_AUTH_PASSWORD=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
if [ -z "$WEB_PASS" ]; then
  WEB_USER="$(sudo grep '^WEB_AUTH_USER=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
  WEB_PASS="$(sudo grep '^WEB_AUTH_PASSWORD=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
fi
WEB_AUTH=()
[ -n "$WEB_PASS" ] && WEB_AUTH=(-u "${WEB_USER:-syncdrive}:$WEB_PASS")

# 對外那一側的瀏覽帳密（入口頁、文件、Swagger 用；API 本體仍是 x-api-key）
EXT_USER="$(grep '^EXTERNAL_AUTH_USER=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
EXT_PASS="$(grep '^EXTERNAL_AUTH_PASSWORD=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
if [ -z "$EXT_PASS" ]; then
  EXT_USER="$(sudo grep '^EXTERNAL_AUTH_USER=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
  EXT_PASS="$(sudo grep '^EXTERNAL_AUTH_PASSWORD=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
fi
EXT_AUTH=()
[ -n "$EXT_PASS" ] && EXT_AUTH=(-u "${EXT_USER:-partner}:$EXT_PASS")

# 廠商看圖台用的帳號：能進圖台與內部 API，不能進技術文件與內部 Swagger
VEN_USER="$(grep '^VENDOR_AUTH_USER=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
VEN_PASS="$(grep '^VENDOR_AUTH_PASSWORD=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
if [ -z "$VEN_PASS" ]; then
  VEN_USER="$(sudo grep '^VENDOR_AUTH_USER=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
  VEN_PASS="$(sudo grep '^VENDOR_AUTH_PASSWORD=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
fi

pass=0
fail=0

check() {
  local label="$1" url="$2" want="$3" key="${4:-}"
  local got
  local auth=()
  # 80 埠的請求要帶 Basic Auth；3100 走的是 x-api-key，兩者不混用。
  # key 傳 "noauth" 代表這一條就是要驗「沒帶憑證會不會被擋」，一律不補。
  if [ "$key" = "vendor" ]; then
    # 廠商帳號：驗證它進得了圖台、進不了技術文件
    auth=(-u "${VEN_USER:-vendor}:$VEN_PASS"); key=""
  elif [ "$key" != "noauth" ]; then
    # 順序不能反：INTERNAL 是 http://host、EXTERNAL 是 http://host:3100，
    # 前者的萬用比對<strong>也會吃掉後者</strong>，先比 EXTERNAL 才不會帶錯帳密
    # （2026-08-26 實測：對外五項全部拿到 401）
    case "$url" in
      "$EXTERNAL"/syncdrive-api/*) ;;   # API 走 x-api-key，不帶瀏覽帳密
      "$EXTERNAL"*) auth=("${EXT_AUTH[@]+"${EXT_AUTH[@]}"}") ;;
      # 80 埠只有文件與內部 Swagger 需要帳密，圖台與內部 API 是開放的
      "$INTERNAL"*) auth=("${WEB_AUTH[@]+"${WEB_AUTH[@]}"}") ;;
    esac
  else
    key=""
  fi
  if [ -n "$key" ]; then
    got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${auth[@]+"${auth[@]}"}" -H "x-api-key: $key" "$url" || echo 000)"
  else
    got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${auth[@]+"${auth[@]}"}" "$url" || echo 000)"
  fi
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
check "對外入口頁"          "$EXTERNAL/"                                        200
check "對外文件站"          "$EXTERNAL/docs/"                                   200
check "對外 Swagger"        "$EXTERNAL/api/docs/public"                         200
if [ -n "$API_KEY" ]; then
  check "班表班次"            "$EXTERNAL/syncdrive-api/operation-shift/timetable/trips"       200 "$API_KEY"
  check "班表站點 ETA"        "$EXTERNAL/syncdrive-api/operation-shift/timetable/station-etas" 200 "$API_KEY"
  check "即時 ETA：依站"      "$EXTERNAL/syncdrive-api/vehicles/eta/by-station"    200 "$API_KEY"
  check "即時 ETA：依車"      "$EXTERNAL/syncdrive-api/vehicles/eta/by-vehicle"    200 "$API_KEY"
  # 訂單查詢：用不存在的 id，正確回應是 404。但「路由沒對外開放」也是 404，
  # 兩者要分得開——不帶金鑰時回 401 才證明路由存在且掛著守衛；若路由根本沒
  # 開放，ExternalPortGuard 會讓它在對外埠上直接 404，不會有 401 這一步。
  check "訂單查詢（車端用）存在"   "$EXTERNAL/syncdrive-api/order/queryById?id=x" 401 noauth
  check "訂單查詢（車端用）可打"   "$EXTERNAL/syncdrive-api/order/queryById?id=x" 404 "$API_KEY"
  # 金鑰要真的有在擋，不是宣告了但沒生效
  check "沒帶金鑰必須被拒"    "$EXTERNAL/syncdrive-api/vehicles/eta/by-station"    401 noauth
else
  printf '  \033[1;33m—\033[0m %s\n' "讀不到 VTMS_API_KEY，略過需要金鑰的 5 項檢查"
fi

echo "對外邊界"
check "內部端點不可從對外埠打到" "$EXTERNAL/syncdrive-api/operation-shift/list"  404
check "內部 Swagger 不可從對外埠打到" "$EXTERNAL/api/docs"                       404
check "資料庫查詢端點不可外露"   "$EXTERNAL/syncdrive-api/datasource/tables"     404
# 內部文件不該存在於對外那一側的檔案系統裡，不是靠權限擋
check "內部文件不可從對外埠取得" "$EXTERNAL/docs/使用者對話紀錄.md"              404
check "協議文件對外可取得"       "$EXTERNAL/docs/營運任務狀態協議.md"            200
check "內部文件（開發進度）同上" "$EXTERNAL/docs/TP13C_2-2-4_開發進度.md"        404
if [ -n "$EXT_PASS" ]; then
  check "對外入口沒帶帳密必須被拒" "$EXTERNAL/docs/"                             401 noauth
fi

echo "存取控制"
# 圖台與內部 API 刻意開放（圖台靠內部 API 運作，鎖了就活不了）；
# 要保護的是演算法與系統結構，那些在文件與內部 Swagger 裡。
# 80 埠整個要帳密：圖台、內部 API、文件、Swagger 都一樣。在沒有帳號權限系統
# 之前，這是內部 API 唯一的保護。
check "圖台沒帶帳密必須被拒"     "$INTERNAL/"                                   401 noauth
check "內部 API 沒帶帳密必須被拒" "$INTERNAL/syncdrive-api/operation-shift/list" 401 noauth
if [ -n "$WEB_PASS" ]; then
  check "內部文件沒帶帳密必須被拒" "$INTERNAL/docs/"                            401 noauth
  check "內部 Swagger 沒帶帳密必須被拒" "$INTERNAL/api/docs"                     401 noauth
  check "內部入口沒帶帳密必須被拒"     "$INTERNAL/portal"                        401 noauth
  check "內部入口帶帳密可進入"         "$INTERNAL/portal"                        200
fi
if [ -n "$VEN_PASS" ]; then
  # 廠商帳號的邊界：圖台進得去，技術文件與內部 Swagger 進不去
  check "廠商帳號可進圖台"         "$INTERNAL/"            200 vendor
  check "廠商帳號可打內部 API"     "$INTERNAL/syncdrive-api/operation-shift/list" 200 vendor
  check "廠商帳號不可進技術文件"   "$INTERNAL/docs/"       401 vendor
  check "廠商帳號不可進內部 Swagger" "$INTERNAL/api/docs"  401 vendor
  check "廠商帳號不可進內部入口"   "$INTERNAL/portal"      401 vendor
fi

echo "參數驗證"
check "值域外的參數回 400"  "$EXTERNAL/syncdrive-api/vehicles/eta/by-station?limit_per_station=99" 400 "$API_KEY"

# ── MQTT broker 的認證邊界 ────────────────────────────────────────
#
# 這一項是事後補的：broker 的設定曾經以「把 prod 蓋在 mosquitto.conf 上」的方式
# 掛載，而目錄裡那份是開發用的（allow_anonymous true）。發過一次 SIGHUP 之後
# mosquitto 讀到開發那份，匿名與錯誤密碼全部連得上——1883 是對全世界開放的，
# 而整個過程沒有任何錯誤訊息，前面 33 項也全數通過。
#
# 所以要真的去連一次。用 mosquitto_sub 從 broker 容器裡打，不必在主機上裝東西。
echo "MQTT 認證邊界"
# docker 可能需要 sudo，也可能不用——與上面讀 .env 同樣的處理方式
if docker ps >/dev/null 2>&1; then DOCKER="docker"; else DOCKER="sudo docker"; fi
mqtt_denied() {
  local label="$1"; shift
  local out
  out="$($DOCKER exec syncdrive_mosquitto mosquitto_sub -h 127.0.0.1 -p 1883 \
        -t '$SYS/broker/version' -C 1 -W 3 "$@" 2>&1 || true)"
  if printf '%s' "$out" | grep -qi 'not authorised\|Connection Refused\|refused'; then
    printf '\033[1;32m✓\033[0m %-40s 被拒\n' "$label"; pass=$((pass + 1))
  else
    printf '\033[1;31m✗\033[0m %-40s 竟然連得上——broker 沒有在驗證帳密\n' "$label"; fail=$((fail + 1))
  fi
}
if $DOCKER exec syncdrive_mosquitto sh -c 'command -v mosquitto_sub' >/dev/null 2>&1; then
  mqtt_denied "MQTT 匿名連線必須被拒"
  mqtt_denied "MQTT 錯誤密碼必須被拒" -u PMS-01 -P definitely-not-the-password
else
  printf '\033[1;33m略過\033[0m 容器裡沒有 mosquitto_sub，無法檢查 MQTT 認證\n'
fi

printf '\n通過 %d 項，失敗 %d 項\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
