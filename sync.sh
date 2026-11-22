#!/usr/bin/env bash
# SyncDrive T3 — 根目錄的 GCP 同步入口，等同 deploy/sync.sh（唯一的 GCP 同步流程）。
#
#   ./sync.sh                  本機設定資料 + GitHub main → GCP（備份、Migration、同步、啟動及驗收）
#   ./sync.sh --dry-run        只產生計畫：不上傳、不改資料、不重啟
#   ./sync.sh status           看 GCP 上各服務狀態
#   ./sync.sh health           GCP 健康檢查
#   ./sync.sh logs backend     看 GCP 上的日誌
#   ./sync.sh rollback         退回上一個版本
#
# 方向是「本機 → GCP」。正式同步前要先 commit、push 到 main，本機 HEAD 必須等於 GitHub main；
# 細節與防呆見 deploy/sync.sh。實際同步會改 GCP 上的資料，第一次建議先跑 --dry-run。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
  -h|--help|help) sed -n '2,12p' "$ROOT/sync.sh" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac
exec "$ROOT/deploy/sync.sh" "$@"
