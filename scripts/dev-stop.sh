#!/usr/bin/env bash
# SyncDrive T3 — 停止本機開發環境（前端/後端程序；Docker 可選保留）

set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:${PATH:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT/.dev"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
VTMS_SIM_PID_FILE="$PID_DIR/vtms-simulator.pid"

STOP_DOCKER=false
if [[ "${1:-}" == "--all" ]] || [[ "${1:-}" == "--docker" ]]; then
  STOP_DOCKER=true
fi

stop_pid_file() {
  local name="$1"
  local pid_file="$2"
  if [[ ! -f "$pid_file" ]]; then
    echo "[$name] 未在執行"
    return
  fi
  local pid
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 0.5
    kill -9 "$pid" 2>/dev/null || true
    echo "[$name] 已停止 PID $pid"
  else
    echo "[$name] PID $pid 已不存在"
  fi
  rm -f "$pid_file"
}

echo "==> 停止 SyncDrive T3 開發程序"
stop_pid_file "frontend" "$FRONTEND_PID_FILE"
stop_pid_file "backend" "$BACKEND_PID_FILE"
stop_pid_file "vtms-simulator" "$VTMS_SIM_PID_FILE"
pkill -f "vtms-shift-demo-simulator.js" 2>/dev/null && echo "[vtms-simulator] 已清理殘留程序" || true

# 清掉佔用 3000 的殘留程序（避免 EADDRINUSE 導致後端無法啟動）
if command -v lsof >/dev/null 2>&1; then
  stale="$( ( lsof -t -iTCP:3000 -sTCP:LISTEN 2>/dev/null ) & pid=$!; sleep 2; kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; )" || true
  if [[ -n "$stale" ]]; then
    for pid in $stale; do
      kill -9 "$pid" 2>/dev/null || true
      echo "[backend] 已清掉佔用 port 3000 的殘留 PID $pid"
    done
  fi
fi
pkill -f "nest start" 2>/dev/null || true

for pid_file in "$PID_DIR"/*.log.trimmer.pid; do
  [[ -f "$pid_file" ]] || continue
  kill "$(cat "$pid_file")" 2>/dev/null || true
  rm -f "$pid_file"
done
for f in backend frontend vtms-simulator; do
  log="$PID_DIR/${f}.log"
  [[ -f "$log" ]] && : >"$log"
done
rm -f "$PID_DIR"/*.log.trim 2>/dev/null || true

if $STOP_DOCKER; then
  echo "==> 停止 Docker 服務"
  cd "$ROOT"
  if docker compose version >/dev/null 2>&1; then
    docker compose down
  else
    docker-compose down
  fi
else
  echo ""
  echo "Docker 容器仍運行中。若要一併停止："
  echo "  ./scripts/dev-stop.sh --docker"
fi
