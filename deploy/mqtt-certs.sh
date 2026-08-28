#!/usr/bin/env bash
#
# 產生 MQTT 的 TLS 憑證：一組 CA、一張伺服器憑證、每台車一張用戶端憑證。
#
#   ./deploy/mqtt-certs.sh [主機位址] [車輛代號...]
#   ./deploy/mqtt-certs.sh 34.80.84.224 PMS-01 PMS-02 …
#
# 車端改用憑證而不是帳密，理由是身分的強度：帳密是一串可以被轉貼、被記在筆記本、
# 被寫進程式碼的字串，而且十一台車的密碼一旦外流，補救方式是十一台一起換。
# 用戶端憑證由 CA 簽發，broker 以 use_identity_as_username 把憑證的 CN 當成
# username——ACL 那條 pattern write v1/vtms/%u/# 因此原封不動繼續生效，
# 而「這台車是誰」由簽章決定，不是由一段可複製的字串決定。
#
# <h3>CN 必須等於車輛代號</h3>
# broker 拿 CN 當 username，ACL 拿 username 比對路徑。CN 打錯的那台車不會連不上，
# 它會連上、然後發布到別台的路徑被拒——症狀是「連得上但資料都沒進來」。
#
# <h3>已存在就不覆蓋</h3>
# 重跑這支不會把已經發出去的憑證作廢。要換某一台，先刪掉那一台的 .crt/.key 再跑。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${CERT_DIR:-$ROOT/mosquitto/certs}"
HOST="${1:-127.0.0.1}"
shift || true

VEHICLES=("$@")
if [ ${#VEHICLES[@]} -eq 0 ]; then
  VEHICLES=(PMS-01 PMS-02 PMS-03 PMS-04 PMS-05 PMS-06 PMS-07 PMS-08 PMS-09 PMS-10 PMS-11)
fi

SUBJECT_BASE="/C=TW/O=SyncDrive T3"
CA_DAYS=3650
LEAF_DAYS=825   # 公開信任的上限是 398 天，自簽沒有這個限制；825 是常見的內部上限

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

# ── CA ──────────────────────────────────────────────────────────
if [ -f ca.crt ] && [ -f ca.key ]; then
  log "CA 已存在，沿用（要重建請先刪除 $CERT_DIR/ca.*）"
else
  log "產生 CA"
  openssl genrsa -out ca.key 4096 2>/dev/null
  openssl req -new -x509 -days "$CA_DAYS" -key ca.key -out ca.crt \
    -subj "$SUBJECT_BASE/CN=SyncDrive T3 Vehicle CA" 2>/dev/null
  chmod 600 ca.key
fi

# ── 伺服器憑證 ──────────────────────────────────────────────────
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
    -out server.crt -days "$LEAF_DAYS" -sha256 -extfile server.ext 2>/dev/null
  rm -f server.csr server.ext
  chmod 600 server.key
fi

# ── 車輛用戶端憑證 ──────────────────────────────────────────────
for code in "${VEHICLES[@]}"; do
  if [ -f "$code.crt" ] && [ -f "$code.key" ]; then
    continue
  fi
  log "產生 $code 的用戶端憑證"
  openssl genrsa -out "$code.key" 2048 2>/dev/null
  openssl req -new -key "$code.key" -out "$code.csr" \
    -subj "$SUBJECT_BASE/CN=$code" 2>/dev/null
  cat > "$code.ext" <<EOF
extendedKeyUsage = clientAuth
EOF
  openssl x509 -req -in "$code.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out "$code.crt" -days "$LEAF_DAYS" -sha256 -extfile "$code.ext" 2>/dev/null
  rm -f "$code.csr" "$code.ext"
  chmod 600 "$code.key"
done

# mosquitto 在容器裡以 uid 1883 執行，讀不到 root 擁有的檔案就會靜靜地不啟用 TLS
chown -R 1883:1883 "$CERT_DIR" 2>/dev/null || true
chmod 644 ca.crt server.crt ./*.crt 2>/dev/null || true

log "完成：$CERT_DIR"
printf '    CA          %s\n' "$(openssl x509 -in ca.crt -noout -enddate | cut -d= -f2)"
printf '    伺服器      %s（%s）\n' "$(openssl x509 -in server.crt -noout -enddate | cut -d= -f2)" "$HOST"
printf '    車輛憑證    %d 張\n' "${#VEHICLES[@]}"
