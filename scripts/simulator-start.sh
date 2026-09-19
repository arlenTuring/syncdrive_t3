#!/usr/bin/env bash
# 啟動並開啟 SyncDrive T3 外部模擬器（syncdrive_t3_simulator）
#
# 用法：
#   ./scripts/simulator-start.sh           # 啟動（已在跑則略過）並開瀏覽器
#   ./scripts/simulator-start.sh --force   # 強制重啟
#   ./scripts/simulator-start.sh --stop    # 只停止
#   ./scripts/simulator-start.sh --no-open # 啟動但不開瀏覽器
#
# 模擬器目錄預設為本專案的姊妹資料夾；可覆寫：
#   SYNCDRIVE_T3_SIMULATOR=/path/to/syncdrive_t3_simulator ./scripts/simulator-start.sh

set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIM_ROOT="${SYNCDRIVE_T3_SIMULATOR:-$(cd "$ROOT/.." && pwd)/syncdrive_t3_simulator}"
PORT="${SIMULATOR_PORT:-4300}"
URL="http://127.0.0.1:${PORT}"

FORCE=false
STOP=false
OPEN_BROWSER=true
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --stop)  STOP=true ;;
    --no-open) OPEN_BROWSER=false ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

cyan() { printf '\033[36m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }

if [[ ! -d "$SIM_ROOT" ]]; then
  red "找不到模擬器目錄：$SIM_ROOT"
  echo "請確認已 clone syncdrive_t3_simulator，或設定 SYNCDRIVE_T3_SIMULATOR。"
  exit 1
fi

PID_DIR="$SIM_ROOT/.dev"
PID_FILE="$PID_DIR/server.pid"
LOG_FILE="$PID_DIR/server.log"
mkdir -p "$PID_DIR"

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

port_listen() {
  ( nc -z -w 1 127.0.0.1 "$PORT" >/dev/null 2>&1 ) &
  local pid=$!
  local i=0
  while kill -0 "$pid" 2>/dev/null && [[ $i -lt 3 ]]; do
    sleep 0.2
    i=$((i + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    return 1
  fi
  wait "$pid"
}

http_ok() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$URL/" 2>/dev/null || true)"
  [[ "$code" =~ ^[23] ]]
}

kill_port_listeners() {
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  fi
  for pid in $pids; do
    kill -9 "$pid" 2>/dev/null || true
  done
}

stop_simulator() {
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    kill "$pid" 2>/dev/null || true
    sleep 0.5
    kill -9 "$pid" 2>/dev/null || true
    green "[simulator] 已停止 PID $pid"
  else
    yellow "[simulator] 未在執行（無有效 PID）"
  fi
  rm -f "$PID_FILE"
  if port_listen; then
    kill_port_listeners
    yellow "[simulator] 已清掉佔用 port $PORT 的殘留程序"
  fi
}

open_ui() {
  if ! $OPEN_BROWSER; then
    return 0
  fi
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  else
    yellow "請手動開啟 $URL"
  fi
}

if $STOP; then
  cyan "==> 停止 SyncDrive T3 模擬器"
  stop_simulator
  exit 0
fi

cyan "==> SyncDrive T3 模擬器"
echo "目錄: $SIM_ROOT"

if [[ ! -f "$SIM_ROOT/.env" ]]; then
  red "缺少 $SIM_ROOT/.env"
  echo "請先：cp .env.example .env 並填入憑證（見模擬器 README）"
  exit 1
fi

if ! $FORCE && is_running && http_ok; then
  green "[simulator] 已在執行 (PID $(cat "$PID_FILE")) → $URL"
  open_ui
  exit 0
fi

if $FORCE || is_running || port_listen; then
  stop_simulator
  sleep 0.5
fi

[[ -d "$SIM_ROOT/node_modules" ]] || {
  cyan "==> npm install（模擬器）"
  (cd "$SIM_ROOT" && npm install)
}

: >"$LOG_FILE"
(
  cd "$SIM_ROOT"
  # 允許外部帶入 MIRROR_MQTT_URL（GCP→本機鏡像）
  nohup env MIRROR_MQTT_URL="${MIRROR_MQTT_URL:-}" npm start >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
)

# npm start 可能再 spawn node；等埠就緒較準
cyan "==> 等待模擬器就緒 ($URL)…"
ready=false
for _ in $(seq 1 40); do
  if http_ok; then
    ready=true
    break
  fi
  sleep 0.25
done

if ! $ready; then
  red "[simulator] 啟動失敗，請查看 $LOG_FILE"
  tail -20 "$LOG_FILE" 2>/dev/null || true
  exit 1
fi

# 盡量對到真正聽埠的 PID
if command -v lsof >/dev/null 2>&1; then
  listen_pid="$(lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
  if [[ -n "${listen_pid:-}" ]]; then
    echo "$listen_pid" >"$PID_FILE"
  fi
fi

green "[simulator] 已啟動 PID $(cat "$PID_FILE") → $URL"
echo "日誌: $LOG_FILE"

# 啟動後自動向目前目標換／續期憑證（金鑰 24h，過期會 401）
cyan "==> 初始化憑證（POST /api/access/refresh）…"
refresh_code="$(curl -s -o /tmp/sim-access-refresh.json -w '%{http_code}' \
  --max-time 30 -X POST "$URL/api/access/refresh" \
  -H 'Content-Type: application/json' -d '{}' 2>/dev/null || true)"
if [[ "$refresh_code" == "200" ]]; then
  green "[simulator] 憑證已就緒"
else
  yellow "[simulator] 自動取得憑證未成功（HTTP ${refresh_code:-?}）"
  yellow "  請在畫面上按「重新取得憑證」，或檢查 .env 的 EXTERNAL_USER / EXTERNAL_PASSWORD"
  if [[ -f /tmp/sim-access-refresh.json ]]; then
    head -c 300 /tmp/sim-access-refresh.json; echo
  fi
fi

open_ui
