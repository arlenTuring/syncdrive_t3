#!/usr/bin/env bash
# 以<strong>本地為準</strong>，把介面資源推上 GCP（GCP 跟 local 對齊）。
#
# 推送：
#   - dashboard_planes（圖台版面，含載具容器尺寸）
#   - vehicle_definitions（載具外觀／車號字級）
#   - module_dashboard_pages（模組頁面對應）
#
# 另可選：把模擬器切回本機目標（本機車隊狀態為主）。
#
# 用法：
#   GCP_BASIC_AUTH='user:pass' ./scripts/sync-local-with-gcp.sh
#   GCP_BASIC_AUTH='user:pass' ./scripts/sync-local-with-gcp.sh --fleet-local
#
# 環境變數：
#   LOCAL_API_BASE   預設 http://127.0.0.1:3000
#   GCP_API_BASE     預設 http://34.80.84.224
#   GCP_BASIC_AUTH   必填，格式 user:password

set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:${PATH:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_API_BASE="${LOCAL_API_BASE:-http://127.0.0.1:3000}"
GCP_API_BASE="${GCP_API_BASE:-http://34.80.84.224}"
SIM_URL="${SIMULATOR_URL:-http://127.0.0.1:4300}"

FLEET_LOCAL=false
for arg in "$@"; do
  case "$arg" in
    --fleet-local) FLEET_LOCAL=true ;;
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

cyan() { printf '\033[36m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }

cyan "==> 以本地為準 → 推上 GCP"

if [[ -z "${GCP_BASIC_AUTH:-}" ]]; then
  red "請設定 GCP_BASIC_AUTH='user:password'"
  exit 1
fi

python3 - "$LOCAL_API_BASE" "$GCP_API_BASE" "$GCP_BASIC_AUTH" <<'PY'
import json, sys, urllib.request, base64

local_base, gcp_base, auth = sys.argv[1], sys.argv[2], sys.argv[3]
auth_h = "Basic " + base64.b64encode(auth.encode()).decode()

def get(url, auth=False):
    req = urllib.request.Request(url, headers={"Authorization": auth_h} if auth else {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def put(url, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Authorization": auth_h},
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status, json.load(r)

planes = get(f"{local_base}/syncdrive-api/dashboard/planes")
defs = get(f"{local_base}/syncdrive-api/vehicle-definitions")
pages = get(f"{local_base}/syncdrive-api/dashboard/module-pages")
print(f"local planes={len(planes)} defs={len(defs)} pages={len(pages)}")

st, res = put(
    f"{gcp_base}/syncdrive-api/dashboard/planes",
    {"items": planes, "updatedBy": "local-push"},
)
print(f"PUT planes → {st} ({len(res) if isinstance(res, list) else '?'} rows)")

st, res = put(
    f"{gcp_base}/syncdrive-api/vehicle-definitions",
    {"items": defs, "updatedBy": "local-push"},
)
print(f"PUT vehicle-definitions → {st} ({len(res) if isinstance(res, list) else '?'} rows)")

pages_payload = [
    {
        "id": p.get("pageKey") or p.get("id"),
        "moduleId": p.get("moduleId"),
        "label": p.get("label"),
        "planeId": p.get("planeId"),
        "sortOrder": p.get("sortOrder"),
    }
    for p in pages
]
st, res = put(
    f"{gcp_base}/syncdrive-api/dashboard/module-pages",
    {"items": pages_payload, "updatedBy": "local-push"},
)
print(f"PUT module-pages → {st} ({len(res) if isinstance(res, list) else '?'} rows)")
PY

green "介面資源已推上 GCP（以本地為準）"

if [[ "$FLEET_LOCAL" == true ]]; then
  cyan "==> 模擬器切回本機目標"
  if curl -sf --max-time 2 "$SIM_URL/api/state" >/dev/null; then
    curl -sf --max-time 30 -X POST "$SIM_URL/api/fleet/stop" \
      -H 'Content-Type: application/json' -d '{}' >/dev/null || true
    sleep 1
    curl -sf --max-time 30 -X POST "$SIM_URL/api/target" \
      -H 'Content-Type: application/json' -d '{"id":"local"}' >/dev/null \
      || yellow "套用 local 目標失敗"
    curl -sf --max-time 30 -X POST "$SIM_URL/api/access/refresh" \
      -H 'Content-Type: application/json' -d '{}' >/dev/null || true
    curl -sf --max-time 60 -X POST "$SIM_URL/api/fleet/start" \
      -H 'Content-Type: application/json' -d '{}' >/dev/null \
      && green "車隊已上線（本機）" \
      || red "車隊上線失敗"
  else
    yellow "模擬器未啟動（$SIM_URL），略過 --fleet-local"
  fi
fi

green "=========================================="
green " 方向：local → GCP"
green " GCP 圖台：${GCP_API_BASE}/"
green " 本地圖台：http://localhost:5173"
green "=========================================="
echo "請硬重新整理 GCP 瀏覽器（清掉前端快取）。"
