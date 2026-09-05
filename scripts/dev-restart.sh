#!/usr/bin/env bash
# SyncDrive T3 — 完整重啟（停掉舊程序 → 啟動全部 → 刷新示範資料）
# 用法：./scripts/dev-restart.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> 完整重啟 SyncDrive T3"
"$ROOT/scripts/dev-stop.sh"
exec "$ROOT/scripts/dev-start.sh" --force --seed --dev
