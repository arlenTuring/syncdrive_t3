#!/usr/bin/env bash
#
# 產生 MQTT 的 TLS 憑證體系：根 CA、車輛簽發用的中介 CA、broker 的伺服器憑證。
#
#   ./deploy/mqtt-certs.sh [主機位址]
#   ./deploy/mqtt-certs.sh 34.80.84.224
#
# <h3>為什麼分成根與中介兩層</h3>
# 車輛憑證改成「申請金鑰時即時簽發、效期跟著金鑰」之後，後端必須拿得到一把能簽車輛
# 身分的私鑰。若那把就是根 CA，後端一旦被攻破，攻擊者不只能冒充任何一台車，還能簽出
# 伺服器憑證冒充 broker——中間人就成立了。
#
# 所以簽車輛的權力交給<strong>中介 CA</strong>：
#
#   ca.key         根。只簽中介與伺服器憑證。簽完就沒有日常用途，應離線保存。
#   client-ca.key  中介。後端讀得到，只用來簽車輛用戶端憑證。
#   server.key     broker 自己的身分，由根直接簽，與中介無關。
#
# 後端被攻破的後果因此縮小到「能冒充車輛」，冒充不了 broker；而且撤銷中介、換一把
# 重簽即可，不必動到根與所有車端已知的信任錨點。
#
# <h3>這支不再簽車輛憑證</h3>
# 車輛憑證由 POST /syncdrive-api/auth/token 在申請當下簽發，效期等於該次的
# ttl_minutes（預設一天）。這支只負責建立體系與 broker 身分。
#
# <h3>已存在就不覆蓋</h3>
# 重跑不會作廢已發出去的東西。要重建整套，先刪掉整個 certs 目錄——注意那會讓所有
# 已簽發的車輛憑證失效。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${CERT_DIR:-$ROOT/mosquitto/certs}"
HOST="${1:-127.0.0.1}"

SUBJECT_BASE="/C=TW/O=SyncDrive T3"
ROOT_DAYS=3650
INTERMEDIATE_DAYS=1825
SERVER_DAYS=825

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

# ── 根 CA ───────────────────────────────────────────────────────
if [ -f ca.crt ] && [ -f ca.key ]; then
  log "根 CA 已存在，沿用"
else
  log "產生根 CA"
  openssl genrsa -out ca.key 4096 2>/dev/null
  openssl req -new -x509 -days "$ROOT_DAYS" -key ca.key -out ca.crt \
    -subj "$SUBJECT_BASE/CN=SyncDrive T3 Root CA" 2>/dev/null
fi

# ── 中介 CA（只簽車輛用戶端憑證）────────────────────────────────
#
# pathlen:0 表示它底下不能再有 CA——中介只能簽終端憑證，簽不出另一層 CA。
# keyCertSign 是簽發能力本身；少了它 OpenSSL 會拒絕用它驗證任何鏈。
if [ -f client-ca.crt ] && [ -f client-ca.key ]; then
  log "中介 CA 已存在，沿用"
else
  log "產生中介 CA（車輛簽發用）"
  openssl genrsa -out client-ca.key 4096 2>/dev/null
  openssl req -new -key client-ca.key -out client-ca.csr \
    -subj "$SUBJECT_BASE/CN=SyncDrive T3 Vehicle Issuing CA" 2>/dev/null
  cat > client-ca.ext <<'EOF'
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
EOF
  openssl x509 -req -in client-ca.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out client-ca.crt -days "$INTERMEDIATE_DAYS" -sha256 -extfile client-ca.ext 2>/dev/null
  rm -f client-ca.csr client-ca.ext
fi

# ── 伺服器憑證（由根直接簽）─────────────────────────────────────
#
# SAN 一定要帶。只寫 CN 的憑證新版 TLS 用戶端一律拒絕（CN 早已不被採信），
# 症狀是車端連線時報 hostname mismatch 而不是憑證無效，很難查。
# 同時帶 IP 與 DNS：現場用 IP 連，docker 內部用服務名連。
if [ -f server.crt ] && [ -f server.key ]; then
  log "伺服器憑證已存在，沿用"
else
  log "產生伺服器憑證（$HOST）"
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
fi

# ── 信任鏈 ──────────────────────────────────────────────────────
#
# broker 的 cafile 要同時含根與中介：根用來讓它自己的伺服器憑證成鏈，
# 中介用來驗證後端簽出去的車輛憑證。少了中介，每一張車輛憑證都會驗不過。
cat ca.crt client-ca.crt > ca-chain.crt

# ── 權限 ────────────────────────────────────────────────────────
#
#   ca.key         根私鑰。能簽出中介，也能簽出伺服器憑證——外流等於整套重建。
#                  只有 root 讀得到；正式環境應該把它搬離這台機器。
#   client-ca.key  中介私鑰。後端要用它簽車輛憑證，所以群組給後端的 gid 1000。
#   server.key     broker 專用，只有 mosquitto（uid 1883）讀得到。
chown 1883:1883 ca.crt client-ca.crt server.crt server.key ca-chain.crt 2>/dev/null || true
chmod 644 ca.crt client-ca.crt server.crt ca-chain.crt 2>/dev/null || true
chmod 600 server.key 2>/dev/null || true

chown root:root ca.key 2>/dev/null || true
chmod 600 ca.key 2>/dev/null || true

chown 1883:1000 client-ca.key 2>/dev/null || true
chmod 640 client-ca.key 2>/dev/null || true

log "完成：$CERT_DIR"
printf '    根 CA      %s\n' "$(openssl x509 -in ca.crt -noout -enddate | cut -d= -f2)"
printf '    中介 CA    %s\n' "$(openssl x509 -in client-ca.crt -noout -enddate | cut -d= -f2)"
printf '    伺服器     %s（%s）\n' "$(openssl x509 -in server.crt -noout -enddate | cut -d= -f2)" "$HOST"
printf '    車輛憑證   由 POST /syncdrive-api/auth/token 即時簽發，效期＝該次 ttl_minutes\n'
