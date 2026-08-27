#!/usr/bin/env bash
# 快速檢查本機開發環境狀態
set -euo pipefail

export PATH="/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

cyan() { printf '\033[36m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

check_port() {
  local port="$1"
  local name="$2"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    green "✓ $name (:$port)"
    return 0
  fi
  red "✗ $name (:$port) 未監聽"
  return 1
}

check_http() {
  local url="$1"
  local name="$2"
  if curl -sf --max-time 3 "$url" >/dev/null 2>&1; then
    green "✓ $name"
    return 0
  fi
  red "✗ $name"
  return 1
}

cyan "==> SyncDrive 環境檢查"
df -h /System/Volumes/Data 2>/dev/null | tail -1 || true
echo ""

cyan "Docker"
(
  docker info >/dev/null 2>&1 &
  dp=$!
  i=0
  while kill -0 "$dp" 2>/dev/null && [[ $i -lt 6 ]]; do sleep 1; i=$((i+1)); done
  if kill -0 "$dp" 2>/dev/null; then kill -9 "$dp" 2>/dev/null; wait "$dp" 2>/dev/null; exit 1; fi
  wait "$dp"
) && {
  green "✓ Docker daemon"
  docker ps --format 'table {{.Names}}\t{{.Status}}' 2>/dev/null | head -8 || true
} || {
  red "✗ Docker daemon 未就緒（請開啟 Docker Desktop 並確認圖示為 Running）"
}
echo ""

cyan "服務埠"
check_port 5432 "PostgreSQL" || true
check_port 1883 "MQTT" || true
check_port 3000 "Backend API" || true
check_port 5173 "Frontend" || true
echo ""

cyan "HTTP"
check_http "http://localhost:5173/" "儀表板" || true
check_http "http://localhost:3000/syncdrive-api/datasource/ping" "後端 ping" || true
check_http "http://localhost:3000/syncdrive-api/demo/simulation/status" "模擬 API" || true
echo ""

