#!/usr/bin/env bash
#
# MQTT TLS 憑證體系：建立與續簽。
#
#   ./deploy/mqtt-certs.sh [主機位址]
#   ./deploy/mqtt-certs.sh 34.80.84.224
#
# 這支是<strong>冪等</strong>的：第一次執行建立整套，之後每天執行只做該做的續簽。
# 由 deploy/mqtt-certs.timer 每日觸發，不需要人記得。
#
# <h3>要解決的問題</h3>
# 憑證到期會讓系統整個停擺，而且是在沒有任何改動的那一天突然發生。車輛憑證因為
# 每天換一次所以不會，但它上面還有三張長效憑證——伺服器憑證、中介 CA、根 CA——
# 過去的做法是「已存在就沿用」，也就是永遠不會續簽，只是把停擺排程到幾年後。
#
# 所以改成：每天檢查，快到期就提前換掉，換的過程要能在車端每天重新取得憑據的
# 節奏下無感完成。
#
# <h3>三張憑證各自怎麼換</h3>
#
#   伺服器憑證   剩 90 天內續簽。車端不持有它，只驗證它是不是根簽的，所以換掉
#                對車端完全無感。唯一要求是 broker 要重讀——見文末的 .changed。
#
#   中介 CA      剩 365 天內續簽。車端每天取得的憑據裡就含中介憑證，隔天自動用到
#                新的。舊中介留在 broker 的信任鏈裡直到它自己過期，所以換的當下
#                已經發出去的車輛憑證（效期 24 小時）仍然驗得過。
#
#   根 CA        剩 3 年時產生接班的新根，但<strong>先不啟用</strong>，只是加進發給車端的
#                信任錨點裡。等 30 天後——確定所有車端都至少換過一次憑據——才把
#                中介與伺服器憑證改由新根簽發。舊根留在信任鏈裡直到過期。
#
#                分兩階段是因為根是唯一車端「事先就要信任」的東西。若當場換掉，
#                昨天取得憑據的車端只認舊根，會驗不過 broker 的新憑證而斷線。
#                車端每天換一次，30 天的重疊期綽綽有餘。
#
# <h3>檔案</h3>
#
#   ca.key / ca.crt              現行根。ca.key 只有 root 讀得到。
#   ca-next.key / ca-next.crt    接班根，過渡期間存在。
#   ca-published.crt             發給車端的信任錨點：現行根 ＋ 尚未過期的舊根。
#   client-ca.key / client-ca.crt 現行中介。後端讀 key 來簽車輛憑證。
#   ca-chain.crt                 broker 的 cafile：所有仍有效的根與中介。
#   server.key / server.crt      broker 自己的身分。
#   retired/                     已退役但尚未過期的根與中介，過期後自動刪除。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${CERT_DIR:-$ROOT/mosquitto/certs}"
HOST="${1:-127.0.0.1}"

SUBJECT_BASE="/C=TW/O=SyncDrive T3"

# 簽發效期
ROOT_DAYS=3650
INTERMEDIATE_DAYS=1825
SERVER_DAYS=825

# 提前多久續簽。都遠大於車端一天一次的換發週期，留足反應時間。
ROOT_PREPARE_AT=1095        # 根剩 3 年：產生接班根，加入信任錨點但不啟用
ROOT_CUTOVER_AFTER_DAYS=30  # 接班根公布滿 30 天：正式改用它簽發
INTERMEDIATE_RENEW_AT=365   # 中介剩 1 年：換新
SERVER_RENEW_AT=90          # 伺服器憑證剩 90 天：換新

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }

mkdir -p "$CERT_DIR/retired"
cd "$CERT_DIR"

# 用 openssl -checkend 判斷剩餘效期，不用 date 算差——date 的參數在 GNU 與 BSD
# 上不相容，而這支要能在 VM 與開發者的 Mac 上都跑得起來。
expiring() { ! openssl x509 -in "$1" -noout -checkend $(( $2 * 86400 )) >/dev/null 2>&1; }
enddate()  { openssl x509 -in "$1" -noout -enddate | cut -d= -f2; }
fingerprint() { openssl x509 -in "$1" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2; }
# 用 openssl 算檔案雜湊，不用 sha256sum——後者在 macOS 上不存在，而這支要能
# 在 VM 與開發者的機器上都跑得起來。
filehash() { openssl dgst -sha256 "$1" 2>/dev/null | awk '{print $NF}'; }

# 換掉伺服器憑證或信任鏈時 broker 必須重讀。留一個記號讓呼叫端知道，
# 沒換的日子就不要重建容器——那會讓所有車端斷線重連。
before_server="$( [ -f server.crt ] && fingerprint server.crt || echo none )"
before_chain="$( [ -f ca-chain.crt ] && filehash ca-chain.crt || echo none )"
rm -f .changed

make_root() {  # $1=key $2=crt
  openssl genrsa -out "$1" 4096 2>/dev/null
  openssl req -new -x509 -days "$ROOT_DAYS" -key "$1" -out "$2" \
    -subj "$SUBJECT_BASE/CN=SyncDrive T3 Root CA $(date +%Y)" 2>/dev/null
}

make_intermediate() {
  # pathlen:0 表示它底下不能再有 CA——中介只能簽終端憑證，簽不出另一層 CA。
  # keyCertSign 是簽發能力本身；少了它 OpenSSL 會拒絕用它驗證任何鏈。
  openssl genrsa -out client-ca.key 4096 2>/dev/null
  openssl req -new -key client-ca.key -out client-ca.csr \
    -subj "$SUBJECT_BASE/CN=SyncDrive T3 Vehicle Issuing CA $(date +%Y)" 2>/dev/null
  cat > client-ca.ext <<'EOF'
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
EOF
  openssl x509 -req -in client-ca.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out client-ca.crt -days "$INTERMEDIATE_DAYS" -sha256 -extfile client-ca.ext 2>/dev/null
  rm -f client-ca.csr client-ca.ext
}

make_server() {
  # SAN 一定要帶。只寫 CN 的憑證新版 TLS 客戶端一律拒絕（CN 早已不被採信），
  # 症狀是車端連線時報 hostname mismatch 而不是憑證無效，很難查。
  # 同時帶 IP 與 DNS：現場用 IP 連，docker 內部用服務名連。
  openssl genrsa -out server.key 2048 2>/dev/null
  openssl req -new -key server.key -out server.csr \
    -subj "$SUBJECT_BASE/CN=$HOST" 2>/dev/null
  cat > server.ext <<EOF
subjectAltName = @alt
extendedKeyUsage = serverAuth
basicConstraints = CA:FALSE
[alt]
DNS.1 = mosquitto
DNS.2 = localhost
IP.1 = 127.0.0.1
EOF
  if printf '%s' "$HOST" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
    printf 'IP.2 = %s\n' "$HOST" >> server.ext
  else
    printf 'DNS.3 = %s\n' "$HOST" >> server.ext
  fi
  openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out server.crt -days "$SERVER_DAYS" -sha256 -extfile server.ext 2>/dev/null
  rm -f server.csr server.ext
}

retire() {  # $1=憑證檔 $2=類別
  cp "$1" "retired/$2-$(date +%Y%m%d%H%M%S).crt"
}

# ── 根 CA ───────────────────────────────────────────────────────
resign_all=0

if [ ! -f ca.crt ] || [ ! -f ca.key ]; then
  log "產生根 CA"
  make_root ca.key ca.crt
elif [ -f ca-next.crt ] && [ -f ca-next.since ]; then
  # 接班根已公布，看是否過了重疊期
  since=$(cat ca-next.since)
  age_days=$(( ( $(date +%s) - since ) / 86400 ))
  if [ "$age_days" -ge "$ROOT_CUTOVER_AFTER_DAYS" ]; then
    log "接班根已公布 $age_days 天，正式切換"
    retire ca.crt root
    mv ca-next.key ca.key
    mv ca-next.crt ca.crt
    rm -f ca-next.since ca.srl
    resign_all=1
    note "舊根保留在信任鏈中直到過期，車端不會斷線"
  else
    note "接班根公布中（第 $age_days 天，滿 $ROOT_CUTOVER_AFTER_DAYS 天切換）"
  fi
elif expiring ca.crt "$ROOT_PREPARE_AT"; then
  log "根 CA 剩不到 $ROOT_PREPARE_AT 天，產生接班根並公布"
  make_root ca-next.key ca-next.crt
  date +%s > ca-next.since
  chown root:root ca-next.key 2>/dev/null || true
  chmod 600 ca-next.key 2>/dev/null || true
  note "此刻起車端同時信任新舊兩把根；$ROOT_CUTOVER_AFTER_DAYS 天後才實際改用新根簽發"
fi

# ── 中介 CA ─────────────────────────────────────────────────────
if [ ! -f client-ca.crt ] || [ ! -f client-ca.key ]; then
  log "產生中介 CA（車輛簽發用）"
  make_intermediate
elif [ "$resign_all" = 1 ]; then
  log "改由新根簽發中介 CA"
  retire client-ca.crt intermediate
  make_intermediate
elif expiring client-ca.crt "$INTERMEDIATE_RENEW_AT"; then
  log "中介 CA 剩不到 $INTERMEDIATE_RENEW_AT 天，續簽"
  retire client-ca.crt intermediate
  make_intermediate
  note "舊中介保留在信任鏈中直到過期，已發出的車輛憑證仍然有效"
fi

# ── 伺服器憑證 ──────────────────────────────────────────────────
#
# 除了到期，主機位址改變也要重簽——SAN 對不上時車端會報 hostname mismatch。
host_changed=0
if [ -f server.crt ]; then
  san="$(openssl x509 -in server.crt -noout -ext subjectAltName 2>/dev/null || true)"
  case "$san" in
    *"$HOST"*) ;;
    *) host_changed=1 ;;
  esac
fi

if [ ! -f server.crt ] || [ ! -f server.key ]; then
  log "產生伺服器憑證（$HOST）"
  make_server
elif [ "$resign_all" = 1 ]; then
  log "改由新根簽發伺服器憑證"
  make_server
elif [ "$host_changed" = 1 ]; then
  log "主機位址已變更為 $HOST，重簽伺服器憑證"
  make_server
elif expiring server.crt "$SERVER_RENEW_AT"; then
  log "伺服器憑證剩不到 $SERVER_RENEW_AT 天，續簽"
  make_server
fi

# ── 信任鏈 ──────────────────────────────────────────────────────
#
# 退役但尚未過期的憑證要留著：舊中介簽出去的車輛憑證還在效期內，舊根則是
# 昨天才取得憑據的車端仍在信任的東西。過期的就刪掉，留著只會讓鏈變長。
for f in retired/*.crt; do
  [ -e "$f" ] || continue
  if expiring "$f" 0; then rm -f "$f"; fi
done

# broker 的 cafile：所有仍有效的根與中介
cat ca.crt client-ca.crt retired/*.crt > ca-chain.crt 2>/dev/null \
  || cat ca.crt client-ca.crt > ca-chain.crt

# 發給車端的信任錨點：現行根、接班根（若有）、尚未過期的舊根
: > ca-published.crt
cat ca.crt >> ca-published.crt
if [ -f ca-next.crt ]; then cat ca-next.crt >> ca-published.crt; fi
for f in retired/root-*.crt; do
  if [ -e "$f" ]; then cat "$f" >> ca-published.crt; fi
done

# ── 權限 ────────────────────────────────────────────────────────
#
#   ca.key         根私鑰。能簽出中介，也能簽出伺服器憑證——外流等於整套重建。
#                  只有 root 讀得到；正式環境應該把它搬離這台機器。
#   client-ca.key  中介私鑰。後端要用它簽車輛憑證，所以群組給後端的 gid 1000。
#   server.key     broker 專用，只有 mosquitto（uid 1883）讀得到。
chown 1883:1883 ca.crt client-ca.crt server.crt server.key ca-chain.crt ca-published.crt 2>/dev/null || true
chmod 644 ca.crt client-ca.crt server.crt ca-chain.crt ca-published.crt 2>/dev/null || true
chmod 600 server.key 2>/dev/null || true
chown root:root ca.key 2>/dev/null || true
chmod 600 ca.key 2>/dev/null || true
chown 1883:1000 client-ca.key 2>/dev/null || true
chmod 640 client-ca.key 2>/dev/null || true
chmod 755 retired 2>/dev/null || true
chmod 644 retired/*.crt 2>/dev/null || true

# ── broker 要不要重讀 ───────────────────────────────────────────
#
# 只有伺服器憑證或信任鏈真的變了才留記號。每天無謂地重建容器會讓車端斷線重連，
# 那本身就是一種停擺。
after_server="$(fingerprint server.crt)"
after_chain="$(filehash ca-chain.crt)"
if [ "$before_server" != "$after_server" ] || [ "$before_chain" != "$after_chain" ]; then
  touch .changed
  chmod 644 .changed 2>/dev/null || true
fi

log "完成：$CERT_DIR"
note "根 CA      $(enddate ca.crt)"
if [ -f ca-next.crt ]; then
  note "接班根     $(enddate ca-next.crt)（公布中，尚未啟用）"
fi
note "中介 CA    $(enddate client-ca.crt)"
note "伺服器     $(enddate server.crt)（$HOST）"
note "車輛憑證   由 POST /syncdrive-api/auth/token 即時簽發，效期＝該次 ttl_minutes"
# 用 glob 數，不用 ls——set -o pipefail 之下目錄是空的時 ls 會讓整條管線回非零，
# 而 set -e 就在這裡把整支腳本結束掉，摘要印到一半、退出碼 2。
retired_count=0
for f in retired/*.crt; do
  if [ -e "$f" ]; then retired_count=$((retired_count + 1)); fi
done
if [ "$retired_count" != 0 ]; then
  note "信任鏈另含 $retired_count 張退役但未過期的憑證"
fi
if [ -f .changed ]; then
  note ""
  note "憑證有變動，broker 需要重建容器才會讀到："
  note "  docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --force-recreate mosquitto"
fi

# 明確以 0 結束。腳本的退出碼是最後一個指令的退出碼，而上面那些條件判斷
# 不成立時會回非零——呼叫端會誤判成續簽失敗。
exit 0
