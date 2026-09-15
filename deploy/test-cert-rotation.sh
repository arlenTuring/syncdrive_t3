#!/usr/bin/env bash
#
# 憑證輪替的端到端測試。需要 docker，建議在 VM 上以 sudo 執行。
#
#   sudo ./deploy/test-cert-rotation.sh
#
# <h3>要證明什麼</h3>
# 「客戶端只要照正常流程每天取得一次憑據，就永遠連得上，中心端這邊的憑證更新
# 全自動、不需要任何人為處理。」
#
# 這句話牽涉到未來好幾年才會發生的事——伺服器憑證 825 天、中介 5 年、根 10 年。
# 沒辦法用等的方式驗證，所以這支把續簽門檻調到必定觸發，讓整條輪替在幾分鐘內
# 依序發生，每一步都用<strong>真的 mosquitto 與真的 TLS 連線</strong>檢查客戶端是否還連得上。
#
# <h3>模擬的客戶端</h3>
# 只做兩件事，與協力廠商該做的完全相同：
#
#   一、呼叫「取得憑據」——這裡直接用中介 CA 簽一張車輛憑證，並取走 ca-published.crt
#       當信任錨點，等同於 POST /syncdrive-api/auth/token 回傳的那一包。
#   二、以該憑證連上 broker。
#
# 關鍵在於每一步都要分別測試「已經拿著舊憑據的客戶端」與「剛重新取得憑據的
# 客戶端」，因為輪替真正的風險是前者——它在中心端換憑證的那一刻正連著線。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="${SANDBOX:-/tmp/syncdrive-cert-rotation-test}"
CERTS="$SANDBOX/certs"
CLIENTS="$SANDBOX/clients"
PORT=18883
CONTAINER=syncdrive_certtest_broker
IMAGE="eclipse-mosquitto:2"

pass=0; fail=0
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; pass=$((pass + 1)); }
bad()  { printf '  \033[1;31m✗\033[0m %s\n' "$*"; fail=$((fail + 1)); }
step() { printf '\n\033[1;36m── %s\033[0m\n' "$*"; }

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

rm -rf "$SANDBOX"; mkdir -p "$CERTS" "$CLIENTS"

cat > "$SANDBOX/mosquitto.conf" <<'CONF'
per_listener_settings true
listener 8883
cafile /certs/ca-chain.crt
certfile /certs/server.crt
keyfile /certs/server.key
require_certificate true
use_identity_as_username true
listener_allow_anonymous false
log_dest stdout
log_type error
CONF

# 產生／續簽憑證。門檻由呼叫端以環境變數指定，藉此把時間快轉到某個輪替時點。
certs() { "$ROOT/deploy/mqtt-certs.sh" 127.0.0.1 >"$SANDBOX/last.log" 2>&1; }

# broker 換憑證後必須<strong>重建</strong>容器，不是重啟——bind mount 綁的是掛載當時解析
# 到的目錄，整套重建過憑證的話容器裡看到的還是舊的，而且完全沒有錯誤訊息。
broker() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" -p "127.0.0.1:$PORT:8883" \
    -v "$CERTS:/certs:ro" -v "$SANDBOX/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" \
    "$IMAGE" >/dev/null 2>&1
  for _ in $(seq 1 20); do
    docker exec "$CONTAINER" sh -c 'pidof mosquitto' >/dev/null 2>&1 && return 0
    sleep 0.3
  done
  return 1
}

# 模擬客戶端呼叫一次「取得憑據」：拿走信任錨點，並請中介簽一張車輛憑證。
# 這正是 POST /syncdrive-api/auth/token 回傳的內容。
fetch() {  # $1=名稱
  local name="$1" d="$CLIENTS/$1"
  mkdir -p "$d"
  cp "$CERTS/ca-published.crt" "$d/trust.pem"
  openssl genrsa -out "$d/vehicle.key" 2048 2>/dev/null
  openssl req -new -key "$d/vehicle.key" -out "$d/vehicle.csr" \
    -subj "/C=TW/O=SyncDrive T3/CN=PMS01" 2>/dev/null
  openssl x509 -req -in "$d/vehicle.csr" -CA "$CERTS/client-ca.crt" -CAkey "$CERTS/client-ca.key" \
    -CAcreateserial -out "$d/leaf.crt" -days 1 -sha256 2>/dev/null
  # 送出的憑證＝車輛憑證接中介憑證
  cat "$d/leaf.crt" "$CERTS/client-ca.crt" > "$d/chain.crt"
  rm -f "$d/vehicle.csr"
  chmod -R a+rX "$d"
}

# 以某一份憑據連線。用 mosquitto_sub 從另一個容器打，走真正的 TLS 握手。
connect() {  # $1=憑據名稱
  local d="/clients/$1"
  docker run --rm --network host -v "$CLIENTS:/clients:ro" "$IMAGE" \
    mosquitto_sub -h 127.0.0.1 -p "$PORT" -t '$SYS/broker/version' -C 1 -W 4 \
    --cafile "$d/trust.pem" --cert "$d/chain.crt" --key "$d/vehicle.key" >/dev/null 2>&1
}

expect_connect() {  # $1=憑據 $2=說明
  if connect "$1"; then ok "$2"; else bad "$2"; fi
}

expect_reject_nocert() {
  if docker run --rm --network host -v "$CLIENTS:/clients:ro" "$IMAGE" \
       mosquitto_sub -h 127.0.0.1 -p "$PORT" -t '$SYS/broker/version' -C 1 -W 4 \
       --cafile "/clients/day0/trust.pem" >/dev/null 2>&1; then
    bad "無憑證竟然連得上"
  else
    ok "無憑證被拒"
  fi
}

export CERT_DIR="$CERTS"

step "第 0 天：建立體系，客戶端首次取得憑據"
certs; broker || { echo "broker 起不來"; cat "$SANDBOX/last.log"; exit 1; }
fetch day0
expect_connect day0 "首次取得憑據即可連線"
expect_reject_nocert

step "伺服器憑證續簽（剩 90 天時自動發生）"
SERVER_RENEW_AT=99999 certs; broker
expect_connect day0 "★ 已持有舊憑據的客戶端不受影響——沒有重新取得也連得上"
fetch day1
expect_connect day1 "重新取得憑據後連線正常"

step "中介 CA 續簽（剩 365 天時自動發生）"
INTERMEDIATE_RENEW_AT=99999 certs; broker
expect_connect day1 "★ 舊中介簽出的車輛憑證仍然有效——正在線上的車不會被踢掉"
fetch day2
expect_connect day2 "新中介簽出的車輛憑證連線正常"

step "根 CA 接班準備（剩 3 年時自動發生，僅公布不啟用）"
ROOT_PREPARE_AT=99999 certs; broker
expect_connect day2 "★ 現行根未變動，既有客戶端不受影響"
fetch day3
roots=$(grep -c 'BEGIN CERT' "$CLIENTS/day3/trust.pem")
if [ "$roots" = 2 ]; then ok "新取得的信任錨點同時含新舊兩把根（$roots 張）"
else bad "信任錨點應含 2 張根，實際 $roots 張"; fi
expect_connect day3 "重疊期間取得憑據可連線"

step "根 CA 正式切換（接班根公布滿 30 天後自動發生）"
echo $(( $(date +%s) - 31 * 86400 )) > "$CERTS/ca-next.since"
certs; broker
expect_connect day3 "★★ 重疊期間取得憑據的客戶端在換根後仍連得上——這是整套設計的重點"
fetch day4
expect_connect day4 "換根後重新取得憑據連線正常"
if connect day0; then
  bad "第 0 天的憑據在換根後仍可連線——重疊期沒有真的結束"
else
  ok "第 0 天（超過 30 天未更新）的憑據已失效，符合設計"
fi

step "平常的一天：沒有東西到期"
certs; broker
expect_connect day4 "無變動時連線正常"
if [ -f "$CERTS/.changed" ]; then bad "沒有變動卻留下重建記號"; else ok "沒有變動就不重建 broker，車端不會被迫斷線"; fi

printf '\n通過 %d 項，失敗 %d 項\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
