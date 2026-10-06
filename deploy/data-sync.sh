#!/usr/bin/env bash
#
# 把本機做好的「人為資料」送上部署機，整批替換掉那邊的版本。
#
#   ./deploy/data-sync.sh                    # 送上 34（gcloud instance syncdrive-t3）
#   ./deploy/data-sync.sh --dry-run          # 只在本機匯出、列出會送哪些東西，不連線
#   ./deploy/data-sync.sh --no-maps          # 只送資料表，不動圖資
#   ./deploy/data-sync.sh --restore [名稱]   # 倒回某一次覆蓋前的備份（預設最近一次）
#   ./deploy/data-sync.sh --list-backups     # 列出部署機上的備份
#
# 平常從 vm.sh 叫：vm.sh syncdata（只送資料）、vm.sh syncall（程式碼＋資料）。
#
# 送什麼（以本機為準，整份替換）：
#   - 儀表板：dashboard_planes、模組頁面、資料來源設定
#   - 班表清單：operation_shifts、時間模板、維護任務
#   - 路線、站點動作、格位、車輛與車型、速限、媒體庫、地圖紀錄
#   - 系統基礎模組設定（system_settings 的 system.*）
#   - 圖資：backend/data/published-maps 裡每一張，以及「使用中」是哪一張
#   清單的權威版本在 data-snapshot.sh。
#
# 不送：訂單、遙測、稽核、事件、格位即時狀態、每日計畫採用紀錄、營運時鐘、
# 協力廠商 API 金鑰、帳號。那些是那台機器自己的執行狀態或憑證。
# 本機沒有資料的表會略過，部署機那張表保留原樣（不會被清空）。
#
# 安全：覆蓋前先在部署機上備份（資料表＋圖資）到 deploy/.state/data-backups/，
# 保留最近 10 份。資料表在同一個交易裡替換，任何一張失敗就整批不生效。
# 部署機的資料表欄位比本機舊時會失敗——先跑 vm.sh synccode（或直接 syncall）。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTANCE="${SYNC_INSTANCE:-syncdrive-t3}"
ZONE="${SYNC_ZONE:-asia-east1-a}"
PROJECT="${SYNC_PROJECT:-}"
REMOTE_DIR="${REMOTE_DIR:-/opt/syncdrive_t3}"
MAPS_DIR="$ROOT/backend/data/published-maps"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m失敗：\033[0m %s\n' "$*" >&2; exit 1; }

DRY_RUN=false
WITH_MAPS=true
ACTION=push
RESTORE_NAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --no-maps) WITH_MAPS=false; shift ;;
    --restore)
      ACTION=restore; shift
      if [ -n "${1:-}" ] && [ "${1#--}" = "$1" ]; then RESTORE_NAME="$1"; shift; fi
      ;;
    --list-backups) ACTION=list; shift ;;
    *) die "未知參數：$1" ;;
  esac
done

GCLOUD_ARGS=(--zone "$ZONE")
[ -n "$PROJECT" ] && GCLOUD_ARGS+=(--project "$PROJECT")
remote() { gcloud compute ssh "$INSTANCE" "${GCLOUD_ARGS[@]}" --command "$1"; }

BACKUP_ROOT="$REMOTE_DIR/deploy/.state/data-backups"

# ── 只列備份 ───────────────────────────────────────────────
if [ "$ACTION" = list ]; then
  remote "sudo ls -1t $BACKUP_ROOT 2>/dev/null || echo '（還沒有備份）'"
  exit 0
fi

# ── 倒回備份 ───────────────────────────────────────────────
if [ "$ACTION" = restore ]; then
  log "34：倒回覆蓋前的備份 ${RESTORE_NAME:-（最近一次）}"
  remote "set -euo pipefail
name='$RESTORE_NAME'
[ -n \"\$name\" ] || name=\$(sudo ls -1t $BACKUP_ROOT | head -1)
dir=$BACKUP_ROOT/\$name
sudo test -f \"\$dir/data.sql.gz\" || { echo \"找不到備份 \$dir\" >&2; exit 1; }
echo \"==> 資料表：\$name\"
sudo gunzip -c \"\$dir/data.sql.gz\" | sudo docker exec -i syncdrive_postgres sh -c 'psql -X -q -1 -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"' >/dev/null
if sudo test -f \"\$dir/published-maps.tar.gz\"; then
  echo '==> 圖資'
  rm -rf /tmp/syncdata-restore && mkdir -p /tmp/syncdata-restore
  sudo tar -xzf \"\$dir/published-maps.tar.gz\" -C /tmp/syncdata-restore
  sudo docker cp /tmp/syncdata-restore/published-maps/. syncdrive_backend:/app/data/published-maps/
  sudo rm -rf /tmp/syncdata-restore
fi
echo '==> 重啟後端'
sudo docker restart syncdrive_backend >/dev/null && sleep 10
cd $REMOTE_DIR && sudo ./deploy/healthcheck.sh"
  log "完成"
  exit 0
fi

# ── 本機匯出 ───────────────────────────────────────────────
if [ -z "${DOCKER:-}" ]; then
  if command -v docker >/dev/null 2>&1; then DOCKER=docker
  elif [ -x /Applications/Docker.app/Contents/Resources/bin/docker ]; then DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker
  else die "找不到 docker（本機資料庫在 docker 裡）"
  fi
fi
export DOCKER

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bundle"

log "匯出本機資料表"
"$ROOT/deploy/data-snapshot.sh" --skip-empty > "$WORK/bundle/data.sql"
grep '^-- ' "$WORK/bundle/data.sql" | sed '1d; s/^-- /    /'
gzip -9 "$WORK/bundle/data.sql"
cp "$ROOT/deploy/data-snapshot.sh" "$WORK/bundle/"

if [ "$WITH_MAPS" = true ]; then
  [ -f "$MAPS_DIR/active-map.json" ] || die "找不到 $MAPS_DIR/active-map.json"
  mkdir -p "$WORK/bundle/maps"
  for f in "$MAPS_DIR"/*.json; do
    case "$f" in *.meta.json|*/active-map.json) continue ;; esac
    cp "$f" "$WORK/bundle/maps/"
  done
  cp "$MAPS_DIR/active-map.json" "$WORK/bundle/maps/"
  log "圖資"
  python3 - "$WORK/bundle/maps" <<'PY'
import json, os, sys
d = sys.argv[1]
active = json.load(open(os.path.join(d, 'active-map.json')))['activeMapId']
for name in sorted(os.listdir(d)):
    if name == 'active-map.json':
        continue
    doc = json.load(open(os.path.join(d, name)))
    mark = '（使用中）' if doc.get('mapId') == active else ''
    print(f"    {doc.get('mapId')}  {doc.get('displayName')}  {doc.get('version')}{mark}")
PY
fi

tar -czf "$WORK/syncdata.tar.gz" -C "$WORK/bundle" .
log "打包 $(du -h "$WORK/syncdata.tar.gz" | cut -f1)"

if [ "$DRY_RUN" = true ]; then
  log "試跑：沒有連線，什麼都沒送"
  exit 0
fi

# ── 送上部署機 ─────────────────────────────────────────────
log "上傳到 ${INSTANCE}"
gcloud compute scp "$WORK/syncdata.tar.gz" "$INSTANCE:/tmp/syncdata.tar.gz" "${GCLOUD_ARGS[@]}"

log "34：備份 → 替換資料表 → 送圖資 → 重啟後端"
remote "set -euo pipefail
W=/tmp/syncdata
sudo rm -rf \$W && mkdir -p \$W && tar -xzf /tmp/syncdata.tar.gz -C \$W && rm -f /tmp/syncdata.tar.gz

stamp=\$(date +%Y%m%d-%H%M%S)
B=$BACKUP_ROOT/\$stamp
sudo mkdir -p \$B
echo \"==> 備份目前資料：\$B\"
DOCKER='sudo docker' bash \$W/data-snapshot.sh | gzip -9 | sudo tee \$B/data.sql.gz >/dev/null
mkdir -p \$W/old
sudo docker cp syncdrive_backend:/app/data/published-maps \$W/old/ 2>/dev/null \
  && sudo tar -czf \$B/published-maps.tar.gz -C \$W/old published-maps \
  || echo '    （後端沒有圖資目錄，圖資不備份）'
sudo ls -1t $BACKUP_ROOT | tail -n +11 | while read -r old; do sudo rm -rf \"$BACKUP_ROOT/\$old\"; done

echo '==> 替換資料表（同一個交易）'
gunzip -c \$W/data.sql.gz | sudo docker exec -i syncdrive_postgres sh -c 'psql -X -q -1 -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"' >/dev/null

if [ -d \$W/maps ]; then
  echo '==> 送圖資（走 API）'
  sudo docker exec syncdrive_backend rm -rf /tmp/syncdata-maps
  sudo docker cp \$W/maps syncdrive_backend:/tmp/syncdata-maps
  sudo docker exec syncdrive_backend node -e '
const fs = require(\"fs\"), http = require(\"http\");
const dir = \"/tmp/syncdata-maps\";
const token = process.env.SYNC_INTERNAL_TOKEN || \"sync-dev-internal\";
function put(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({ host: \"127.0.0.1\", port: 3000, method: \"PUT\", path,
      headers: { \"content-type\": \"application/json\", \"content-length\": Buffer.byteLength(body), \"x-sync-internal-token\": token } },
      (res) => { let b = \"\"; res.on(\"data\", (d) => (b += d)); res.on(\"end\", () => res.statusCode === 200 ? resolve() : reject(new Error(path + \" HTTP \" + res.statusCode + \" \" + b.slice(0, 200)))); });
    req.on(\"error\", reject); req.write(body); req.end();
  });
}
(async () => {
  const active = JSON.parse(fs.readFileSync(dir + \"/active-map.json\", \"utf8\"));
  for (const name of fs.readdirSync(dir)) {
    if (name === \"active-map.json\") continue;
    const doc = JSON.parse(fs.readFileSync(dir + \"/\" + name, \"utf8\"));
    await put(\"/syncdrive-api/map/library/\" + doc.mapId, { libraryId: doc.mapId, displayName: doc.displayName, version: doc.version, updatedAt: doc.updatedAt, mapDocument: doc });
    console.log(\"    \" + doc.mapId + \"  \" + doc.displayName + \"  \" + doc.version);
  }
  await put(\"/syncdrive-api/map/library/active\", { mapId: active.activeMapId, libraryId: active.libraryId, displayName: active.displayName });
  console.log(\"    使用中：\" + active.activeMapId);
})().catch((e) => { console.error(e.message); process.exit(1); });
'
  sudo docker exec syncdrive_backend rm -rf /tmp/syncdata-maps
fi
# docker cp 帶出來的圖資備份是 root 的
sudo rm -rf \$W

echo '==> 重啟後端（讓快取的班表、路線、格位重新載入）'
sudo docker restart syncdrive_backend >/dev/null && sleep 10
cd $REMOTE_DIR && sudo ./deploy/healthcheck.sh
echo \"    覆蓋前的備份：\$stamp（倒回：./deploy/vm.sh syncdata --restore \$stamp）\""

log "完成"
