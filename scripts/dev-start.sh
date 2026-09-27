#!/usr/bin/env bash
# SyncDrive T3 — 一鍵啟動本機開發環境（Docker + 後端 + VTMS + 前端）
# 用法：
#   ./scripts/dev-start.sh           # 啟動（已運行且健康則略過）
#   ./scripts/dev-start.sh --force   # 強制重啟所有程序（含清掉佔用 3000／3100／5173 的殘留程序）
#   ./scripts/dev-start.sh --seed    # 啟動後寫入示範資料到 DB
#   ./scripts/dev-start.sh --demo    # 同時啟動 VTMS MQTT 班次模擬（預設由儀表板「開始模擬」按鈕控制）
# 停止：./scripts/dev-stop.sh

set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:${PATH:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FORCE=false
SEED=false
FRONTEND_DEV=false
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --seed)  SEED=true ;;
    --dev)   FRONTEND_DEV=true ;;
  esac
done

PID_DIR="$ROOT/.dev"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
BACKEND_LOG="$PID_DIR/backend.log"
FRONTEND_LOG="$PID_DIR/frontend.log"

mkdir -p "$PID_DIR"

# 開發日誌：啟動時一律清空；執行中背景裁切，避免 nest/vite 洗版撐滿磁碟
DEV_LOG_MAX_BYTES=$((256 * 1024))

rotate_dev_log() {
  local log="$1"
  [[ -f "$log" ]] || return 0
  : >"$log"
}

start_log_trimmer() {
  local log_file="$1"
  local trimmer_pid_file="${log_file}.trimmer.pid"
  [[ -f "$trimmer_pid_file" ]] && kill "$(cat "$trimmer_pid_file")" 2>/dev/null || true
  (
    while [[ -f "$log_file" ]]; do
      sleep 45
      [[ -f "$log_file" ]] || break
      local size
      size="$(wc -c <"$log_file" 2>/dev/null || echo 0)"
      if [[ "$size" -gt "$DEV_LOG_MAX_BYTES" ]]; then
        tail -c "$DEV_LOG_MAX_BYTES" "$log_file" > "${log_file}.trim" \
          && mv "${log_file}.trim" "$log_file"
      fi
    done
  ) </dev/null >/dev/null 2>&1 &
  # 背景裁切不能繼承呼叫端的輸出：被接在管線後面（例如 dev-start.sh | tail）時，
  # 它一直握著管線不放，呼叫端就永遠等不到結束
  echo $! >"$trimmer_pid_file"
}

stop_log_trimmers() {
  for pid_file in "$PID_DIR"/*.log.trimmer.pid; do
    [[ -f "$pid_file" ]] || continue
    kill "$(cat "$pid_file")" 2>/dev/null || true
    rm -f "$pid_file"
  done
}

cyan() { printf '\033[36m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }

stop_log_trimmers
rotate_dev_log "$BACKEND_LOG"
rotate_dev_log "$FRONTEND_LOG"

docker_cmd() {
  if command -v docker >/dev/null 2>&1; then echo docker; return; fi
  if [[ -x /usr/local/bin/docker ]]; then echo /usr/local/bin/docker; return; fi
  if [[ -x /Applications/Docker.app/Contents/Resources/bin/docker ]]; then
    echo /Applications/Docker.app/Contents/Resources/bin/docker
    return
  fi
  return 1
}

# 避免 docker info / compose --wait 在 daemon 異常時無限卡住
docker_ready() {
  local bin="$1"
  ( "$bin" info >/dev/null 2>&1 ) &
  local pid=$!
  local i=0
  while kill -0 "$pid" 2>/dev/null && [[ $i -lt 8 ]]; do
    sleep 1
    i=$((i + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    return 1
  fi
  wait "$pid"
}

compose_up_with_timeout() {
  local bin="$1"
  local compose_file="$2"
  if "$bin" compose -f "$compose_file" up -d 2>/dev/null; then
    return 0
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$compose_file" up -d
  else
    return 1
  fi
}

port_listen() {
  ( nc -z -w 1 127.0.0.1 "$1" >/dev/null 2>&1 ) &
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

# 清掉佔著某個埠的程序（不管是不是這支腳本起的）：先 TERM，3 秒內沒走再 KILL。
# lsof 加 -nP 不查 DNS／服務名，避免卡住。
kill_port_listeners() {
  local port="$1"
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  fi
  [[ -n "$pids" ]] || return 0
  local pid
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done
  local i
  for i in $(seq 1 12); do
    pids="$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -z "$pids" ]] && break
    sleep 0.25
  done
  for pid in $pids; do
    kill -9 "$pid" 2>/dev/null || true
  done
  yellow "已清掉佔用 port $port 的程序"
}

# 只殺這個專案底下的殘留程序，不波及別的專案的 nest／vite
kill_project_processes() {
  local pattern="$1"
  pkill -f "$pattern" 2>/dev/null || true
  sleep 0.5
  pkill -9 -f "$pattern" 2>/dev/null || true
}
BACKEND_PROC_PATTERN="$ROOT/backend/(node_modules/\.bin/nest|dist/main)"
FRONTEND_PROC_PATTERN="$ROOT/frontend/node_modules/(\.bin/vite|@esbuild)"

backend_healthy() {
  curl -sf --max-time 3 http://127.0.0.1:3000/syncdrive-api/datasource/ping 2>/dev/null \
    | grep -q '"ok":true'
}

is_running() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  kill -0 "$(cat "$pid_file")" 2>/dev/null
}

stop_pid_file() {
  local name="$1"
  local pid_file="$2"
  [[ -f "$pid_file" ]] || return 0
  local pid
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 0.5
    kill -9 "$pid" 2>/dev/null || true
    yellow "[$name] 已停止 PID $pid"
  fi
  rm -f "$pid_file"
}

start_process() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  local workdir="$4"
  local cmd="$5"

  (
    cd "$workdir"
    nohup bash -lc "$cmd" >>"$log_file" 2>&1 &
    echo $! >"$pid_file"
  )
  start_log_trimmer "$log_file"
  sleep 2
  if is_running "$pid_file"; then
    green "[$name] 已啟動 PID $(cat "$pid_file")，日誌: $log_file"
  else
    red "[$name] 啟動失敗，請查看 $log_file"
    tail -8 "$log_file" 2>/dev/null || true
    return 1
  fi
}

ensure_docker() {
  local DOCKER
  DOCKER="$(docker_cmd)" || {
    red "找不到 docker CLI，請安裝 Docker Desktop" >&2
    exit 1
  }

  if docker_ready "$DOCKER"; then
    green "Docker daemon 已就緒" >&2
    printf '%s' "$DOCKER"
    return 0
  fi

  yellow "Docker 未啟動，正在開啟 Docker Desktop…" >&2
  if [[ -d "/Applications/Docker.app" ]]; then
    open -a Docker 2>/dev/null || open "/Applications/Docker.app" 2>/dev/null || true
  else
    red "找不到 Docker Desktop，請手動安裝並啟動" >&2
    exit 1
  fi

  cyan "等待 Docker 就緒（最長 3 分鐘）…" >&2
  local i
  for i in $(seq 1 90); do
    if docker_ready "$DOCKER"; then
      green "Docker 已就緒 (${i}×2s)" >&2
      printf '%s' "$DOCKER"
      return 0
    fi
    sleep 2
  done

  red "Docker 在 3 分鐘內未就緒。請確認 Docker Desktop 圖示為 Running 後再執行：" >&2
  red "  cd $ROOT && npm run dev" >&2
  exit 1
}

wait_postgres() {
  local DOCKER="$1"
  cyan "等待 Postgres 就緒…"
  local i
  for i in $(seq 1 45); do
    if "$DOCKER" exec syncdrive_postgres pg_isready -U syncdrive_user -d syncdrive_t3 >/dev/null 2>&1; then
      green "Postgres 已就緒"
      return 0
    fi
    sleep 1
  done
  yellow "Postgres 尚未回應，後端將持續重試"
}

wait_mqtt() {
  cyan "等待 MQTT broker 就緒…"
  local i
  for i in $(seq 1 30); do
    if (echo >/dev/tcp/127.0.0.1/1883) 2>/dev/null; then
      green "MQTT 已就緒 (127.0.0.1:1883)"
      return 0
    fi
    sleep 1
  done
  yellow "MQTT 尚未回應，模擬器可能無法發車（請確認 Docker mosquitto 容器）"
}

wait_backend() {
  cyan "等待後端 API 就緒…"
  local i
  for i in $(seq 1 45); do
    if backend_healthy; then
      green "後端 API 已就緒 (http://localhost:3000)"
      return 0
    fi
    sleep 1
  done
  red "後端未在預期時間內就緒，請查看 $BACKEND_LOG"
  tail -15 "$BACKEND_LOG" 2>/dev/null || true
  return 1
}

seed_dashboard() {
  cyan "寫入示範資料到資料庫…"
  if curl -sf --max-time 30 -X POST http://localhost:3000/syncdrive-api/datasource/seed-dashboard >/dev/null; then
    green "示範資料已寫入"
  else
    yellow "示範資料寫入失敗（後端可能尚未完全就緒）"
  fi
}

cyan "==> SyncDrive T3 一鍵啟動"
echo "專案目錄: $ROOT"
echo ""

# ── Docker ──
DOCKER="$(ensure_docker)"
cyan "==> 啟動 Docker 容器 (postgres / redis / mqtt / adminer)"
if ! compose_up_with_timeout "$DOCKER" "$ROOT/docker-compose.yml"; then
  red "docker compose up 失敗，請確認 Docker Desktop 為 Running"
  exit 1
fi
wait_postgres "$DOCKER"
wait_mqtt
echo ""

# ── Backend ──
need_backend=true
if ! $FORCE && is_running "$BACKEND_PID_FILE" && backend_healthy; then
  yellow "[backend] 已在執行且健康 (PID $(cat "$BACKEND_PID_FILE"))，略過"
  need_backend=false
elif $FORCE || is_running "$BACKEND_PID_FILE" || port_listen 3000 || port_listen 3100; then
  # 強制重啟／殘留：PID 檔那一支、佔著 3000（內部 API）與 3100（對外 API）的、
  # 這個專案底下殘留的 nest watch 與 dist/main，全部清掉再起
  stop_pid_file "backend" "$BACKEND_PID_FILE"
  kill_project_processes "$BACKEND_PROC_PATTERN"
  kill_port_listeners 3000
  kill_port_listeners 3100
  sleep 1
fi
if $need_backend; then
  cyan "==> 啟動 Backend (http://localhost:3000)"
  [[ -d "$ROOT/backend/node_modules" ]] || (cd "$ROOT/backend" && npm install)
  start_process "backend" "$BACKEND_PID_FILE" "$BACKEND_LOG" "$ROOT/backend" "LOG_LEVEL=warn npm run start:dev"
  if ! wait_backend; then
    yellow "後端啟動異常，嘗試清掉 port 3000／3100 後重試一次…"
    stop_pid_file "backend" "$BACKEND_PID_FILE"
    kill_project_processes "$BACKEND_PROC_PATTERN"
    kill_port_listeners 3000
    kill_port_listeners 3100
    sleep 1
    start_process "backend" "$BACKEND_PID_FILE" "$BACKEND_LOG" "$ROOT/backend" "LOG_LEVEL=warn npm run start:dev"
    wait_backend
  fi
fi
echo ""

# 外部模擬器（另一個資料夾）：./scripts/simulator-start.sh 或 npm run simulator
#   → http://127.0.0.1:4300（實作在模擬器那邊的 sim.sh）

# ── Frontend ──
need_frontend=true
if ! $FORCE && is_running "$FRONTEND_PID_FILE" && port_listen 5173; then
  yellow "[frontend] 已在執行 (PID $(cat "$FRONTEND_PID_FILE"))，略過"
  need_frontend=false
elif $FORCE || is_running "$FRONTEND_PID_FILE" || port_listen 5173; then
  # 只清這個專案的 vite 與佔著 5173 的程序；不再 pkill 所有 vite（會殺到別的專案）
  stop_pid_file "frontend" "$FRONTEND_PID_FILE"
  kill_project_processes "$FRONTEND_PROC_PATTERN"
  kill_port_listeners 5173
  sleep 1
fi
if $need_frontend; then
  [[ -d "$ROOT/frontend/node_modules" ]] || (cd "$ROOT/frontend" && npm install)
  if $FRONTEND_DEV; then
    cyan "==> 啟動 Frontend 開發模式 (http://localhost:5173)"
    start_process "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_LOG" "$ROOT/frontend" "npm run dev"
  else
    cyan "==> 建置 Frontend (production)…"
    (cd "$ROOT/frontend" && npm run build)
    cyan "==> 啟動 Frontend 正式版 (http://localhost:5173)"
    start_process "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_LOG" "$ROOT/frontend" "npm run preview"
  fi
fi
echo ""

if $SEED && backend_healthy; then
  seed_dashboard
  echo ""
fi

green "=========================================="
green " 全部服務已啟動"
green "=========================================="
echo ""
echo "  儀表板        http://localhost:5173  (production build；熱更新請 dev-start.sh --dev)"
echo "  後端 API      http://localhost:3000"
echo "  Swagger       http://localhost:3000/api"
echo "  資料庫 GUI    http://localhost:8080"
echo ""
echo "  完整重啟+資料  npm run dev:restart"
echo "  外部模擬器      npm run simulator   → http://127.0.0.1:4300"
echo "  停止全部      ./scripts/dev-stop.sh"
echo "  查看日誌      tail -f .dev/backend.log .dev/frontend.log"
echo ""
