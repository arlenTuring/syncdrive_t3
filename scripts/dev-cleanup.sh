#!/usr/bin/env bash
# 釋放本機磁碟空間（開發用，不刪除 Postgres 資料卷）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cyan() { printf '\033[36m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

cyan "==> SyncDrive 開發環境清理"

# 專案日誌與暫存
mkdir -p "$ROOT/.dev"
for f in backend frontend; do
  log="$ROOT/.dev/${f}.log"
  if [[ -f "$log" ]]; then
    : >"$log"
    green "已清空 .dev/${f}.log"
  fi
done
rm -f "$ROOT"/.dev/*.log.trimmer.pid "$ROOT"/.dev/*.log.trim 2>/dev/null || true
rm -f "$ROOT"/sh-thd-* 2>/dev/null && green "已刪除 shell 暫存檔 sh-thd-*" || true

# 建置產物（可 npm run dev 重建）
for dir in "$ROOT/backend/dist" "$ROOT/frontend/dist"; do
  if [[ -d "$dir" ]]; then
    rm -rf "$dir"
    green "已刪除 $(basename "$(dirname "$dir")")/dist"
  fi
done

# npm / yarn 快取（可安全重建）
if command -v npm >/dev/null 2>&1; then
  npm cache clean --force >/dev/null 2>&1 || true
  green "已清理 npm cache"
fi
if [[ -d "$HOME/Library/Caches/Yarn" ]]; then
  rm -rf "$HOME/Library/Caches/Yarn" 2>/dev/null || true
  green "已清理 Yarn cache"
fi

# Docker 建置快取與未使用映像（保留 pgdata 等 volume）
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  yellow "清理 Docker 建置快取與未使用映像…"
  docker builder prune -af >/dev/null 2>&1 || true
  docker image prune -af >/dev/null 2>&1 || true
  docker container prune -f >/dev/null 2>&1 || true
  green "Docker 快取已清理"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx syncdrive_postgres; then
    yellow "清理資料庫舊 telemetry（保留 3 天）…"
    (cd "$ROOT/backend" && npm run db:cleanup) || yellow "db:cleanup 略過（Postgres 未就緒）"
  fi
else
  yellow "Docker 未執行，略過容器清理"
fi

echo ""
df -h /System/Volumes/Data 2>/dev/null | tail -1 || df -h / | tail -1
green "清理完成"
