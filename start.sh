#!/usr/bin/env bash
# SyncDrive T3 — 根目錄一鍵入口：開啟／關閉整個系統（Docker 資料庫與 MQTT、後端、前端），或與 GCP 同步。
#
#   ./start.sh                 啟動整個系統（已在跑且健康就略過）
#   ./start.sh --force         強制重啟所有程序
#   ./start.sh stop            停止後端與前端（Docker 保留）
#   ./start.sh stop --docker   連 Docker 一起停
#   ./start.sh restart         停止後再啟動
#   ./start.sh status          看每個服務是否正常
#   ./start.sh logs [backend|frontend]   追蹤日誌（Ctrl-C 離開）
#   ./start.sh sync [...]      與 GCP 同步，等同 ./sync.sh（參數照傳，例如 --dry-run、status）
#
# 實際工作交給 scripts/dev-*.sh 與 deploy/sync.sh，這裡只是入口。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

cmd="${1:-start}"
case "$cmd" in
  start|--*) [ "$cmd" = start ] && shift || true; exec "$ROOT/scripts/dev-start.sh" "$@" ;;
  stop) shift; exec "$ROOT/scripts/dev-stop.sh" "$@" ;;
  restart)
    shift
    "$ROOT/scripts/dev-stop.sh"
    exec "$ROOT/scripts/dev-start.sh" "$@"
    ;;
  status|health) exec "$ROOT/scripts/dev-health.sh" ;;
  logs)
    which="${2:-backend}"
    case "$which" in
      backend|frontend) exec tail -n 100 -f "$ROOT/.dev/$which.log" ;;
      *) echo "logs 只接受 backend 或 frontend" >&2; exit 1 ;;
    esac
    ;;
  sync) shift; exec "$ROOT/sync.sh" "$@" ;;
  -h|--help|help) sed -n '2,13p' "$ROOT/start.sh" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "未知指令：$cmd（用 ./start.sh help 查看）" >&2; exit 1 ;;
esac
