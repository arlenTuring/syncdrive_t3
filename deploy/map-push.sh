#!/usr/bin/env bash
#
# 把本機的圖資送進遠端<strong>執行中的後端</strong>。
#
#   ./deploy/map-push.sh --gcloud syncdrive-t3 asia-east1-a integral-cell-498905-s0
#   ./deploy/map-push.sh --gcloud <instance> <zone> <project> <mapId>   # 指定某一張
#
# 為什麼要另外一支：push.sh 打包的是<strong>原始碼樹</strong>，而後端執行期的
# data/ 掛的是 docker named volume（docker-compose.prod.yml 的 backenddata:/app/data）。
# 那個 volume 是故意的——沒有它，每次重新部署圖資就沒了。代價是把檔案塞進
# /opt/syncdrive_t3/backend/data/published-maps 一點用都沒有：那是原始碼樹裡的副本，
# 容器根本不讀。圖資只能走 API 進去。
#
# 實際踩過：push.sh 跑完、檔案也確實在 VM 上，但 /map/library 回的還是八條路線的
# 舊版，因為容器讀的是 volume 裡那一份。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAPS_DIR="$ROOT/backend/data/published-maps"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

if [ "${1:-}" != "--gcloud" ]; then
  echo "用法：./deploy/map-push.sh --gcloud <instance> <zone> <project> [mapId]" >&2
  exit 2
fi
INSTANCE="${2:?需要 instance 名稱}"
ZONE="${3:?需要 zone}"
PROJECT="${4:-}"
ONLY_MAP="${5:-}"
GCLOUD_ARGS=(--zone "$ZONE")
[ -n "$PROJECT" ] && GCLOUD_ARGS+=(--project "$PROJECT")

# 沒指定就送「目前使用中」那一張——其餘的留在遠端，不動別人正在用的東西
if [ -z "$ONLY_MAP" ]; then
  ONLY_MAP="$(python3 -c "import json;print(json.load(open('$MAPS_DIR/active-map.json'))['activeMapId'])")"
  log "沒指定 mapId，送本機使用中的那一張：$ONLY_MAP"
fi

SRC="$MAPS_DIR/$ONLY_MAP.json"
[ -f "$SRC" ] || { echo "找不到 $SRC" >&2; exit 1; }

log "上傳 $ONLY_MAP"
gcloud compute scp "$SRC" "$INSTANCE:/tmp/map-push.json" "${GCLOUD_ARGS[@]}"

log "送進後端（走 API，不是塞檔案）"
gcloud compute ssh "$INSTANCE" "${GCLOUD_ARGS[@]}" --command '
set -e
sudo docker cp /tmp/map-push.json syncdrive_backend:/tmp/map-push.json
sudo docker exec syncdrive_backend node -e "
const fs=require(\"fs\"), http=require(\"http\");
const doc=JSON.parse(fs.readFileSync(\"/tmp/map-push.json\",\"utf8\"));
const body=JSON.stringify({libraryId:doc.mapId,displayName:doc.displayName,version:doc.version,updatedAt:doc.updatedAt,mapDocument:doc});
const req=http.request({host:\"127.0.0.1\",port:3000,method:\"PUT\",path:\"/syncdrive-api/map/library/\"+doc.mapId,headers:{\"content-type\":\"application/json\",\"content-length\":Buffer.byteLength(body),\"x-sync-internal-token\":process.env.SYNC_INTERNAL_TOKEN||\"sync-dev-internal\"}},r=>{let b=\"\";r.on(\"data\",d=>b+=d);r.on(\"end\",()=>{console.log(\"PUT\",r.statusCode);process.exit(r.statusCode===200?0:1);});});
req.on(\"error\",e=>{console.log(\"ERR\",e.message);process.exit(1);});
req.write(body);req.end();
"
sudo docker exec syncdrive_backend node -e "
const http=require(\"http\");
http.get(\"http://127.0.0.1:3000/syncdrive-api/map/library\",r=>{let b=\"\";r.on(\"data\",d=>b+=d);r.on(\"end\",()=>{
  const j=JSON.parse(b);
  for (const m of j.maps) console.log(\" \", m.mapId, m.displayName, m.version, \"routes\", m.routeCount, m.updatedAt);
  console.log(\"  active\", j.activeMapId);
});});
"
'
log "完成"
