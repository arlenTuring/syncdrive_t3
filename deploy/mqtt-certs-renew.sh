#!/usr/bin/env bash
#
# 每日續簽 MQTT 憑證，必要時重建 broker。由 mqtt-certs.timer 觸發。
#
#   sudo ./deploy/mqtt-certs-renew.sh
#
# mqtt-certs.sh 本身是冪等的：沒有東西快到期就什麼都不做。這支只多做兩件事——
# 把主機位址帶進去（伺服器憑證的 SAN 要對得上），以及在憑證真的換了的時候重建
# broker 容器。
#
# 為什麼是重建而不是重啟：mosquitto 的憑證是 bind mount 進去的，而重新產生憑證
# 若動到目錄本身（例如整套重建），容器裡的掛載會仍然指向舊的 inode，broker 會
# 繼續送舊憑證而且完全沒有錯誤訊息。實測過一次：憑證換了、broker 送的還是舊的。
#
# 重建會讓所有車端斷線重連一次，所以只在 mqtt-certs.sh 留下 .changed 記號時才做。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$ROOT/mosquitto/certs"
COMPOSE="docker compose -f $ROOT/deploy/docker-compose.prod.yml --env-file $ROOT/deploy/.env"

# 主機位址：伺服器憑證的 SAN 要含它，否則車端會報 hostname mismatch。
# 優先用 deploy/.env 裡對外公告的那個，讀不到就問 GCP metadata。
HOST="$(grep '^MQTT_PUBLIC_HOST=' "$ROOT/deploy/.env" 2>/dev/null | cut -d= -f2)"
if [ -z "${HOST:-}" ]; then
  HOST="$(curl -s -m 3 -H 'Metadata-Flavor: Google' \
    'http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip' 2>/dev/null)"
fi
HOST="${HOST:-127.0.0.1}"

"$ROOT/deploy/mqtt-certs.sh" "$HOST" || {
  echo "續簽失敗——憑證維持原狀，broker 不受影響" >&2
  exit 1
}

if [ -f "$CERT_DIR/.changed" ]; then
  echo "憑證有變動，重建 broker"
  $COMPOSE up -d --force-recreate mosquitto || {
    echo "broker 重建失敗——新憑證尚未生效，請人工處理" >&2
    exit 1
  }
  rm -f "$CERT_DIR/.changed"
  echo "完成"
else
  echo "無需變動"
fi
