#!/usr/bin/env bash
#
# 在 Mac（已登入 gcloud 的那台）操作部署機 34 的總控。
#
#   ./deploy/vm.sh sync                同步：VM 拉 GitHub 最新 main → 重建部署 → 升級儀表板資料
#   ./deploy/vm.sh sync --no-deploy    只拉程式碼＋升級儀表板資料，不重建（git-sync.sh 的參數都可以接在後面）
#   ./deploy/vm.sh update              在 VM 上 git pull → 重建部署（不碰儀表板資料）
#   ./deploy/vm.sh restart             重啟前端＋後端（不重建、不換版本）
#   ./deploy/vm.sh restart backend     只重啟後端；也可以 web／postgres／redis／mosquitto／all
#   ./deploy/vm.sh status              目前版本、最後健康版本、各容器狀態
#   ./deploy/vm.sh logs [服務] [-f]    看 log（預設後端，最近 200 行；-f 持續追）
#   ./deploy/vm.sh health              跑完整健康檢查
#   ./deploy/vm.sh rollback            回到上一個通過健康檢查的版本
#   ./deploy/vm.sh ssh                 直接登入 VM
#
# 目標預設是 34（gcloud instance syncdrive-t3、zone asia-east1-a），跟 git-sync.sh 同一組；
# 換機器時改下面兩行，或用環境變數 SYNC_INSTANCE／SYNC_ZONE 臨時覆蓋。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTANCE="${SYNC_INSTANCE:-syncdrive-t3}"
ZONE="${SYNC_ZONE:-asia-east1-a}"
REMOTE_DIR="${REMOTE_DIR:-/opt/syncdrive_t3}"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

# 在 VM 上執行一段指令（在部署目錄裡）
on_vm() {
  gcloud compute ssh "$INSTANCE" --zone "$ZONE" --command "cd $REMOTE_DIR && $1"
}
# 需要互動或持續輸出時（logs -f、ssh）要配一個終端機
on_vm_tty() {
  gcloud compute ssh "$INSTANCE" --zone "$ZONE" --command "cd $REMOTE_DIR && $1" -- -t
}

# 服務名稱 → 容器名稱（docker-compose.prod.yml 的 container_name）
container_of() {
  case "$1" in
    backend|後端) echo syncdrive_backend ;;
    web|frontend|前端) echo syncdrive_web ;;
    postgres|db) echo syncdrive_postgres ;;
    redis) echo syncdrive_redis ;;
    mosquitto|mqtt) echo syncdrive_mosquitto ;;
    *) echo "不認得的服務：$1（可用 backend／web／postgres／redis／mosquitto）" >&2; exit 2 ;;
  esac
}

usage() { sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'; }

cmd="${1:-}"
if [ $# -gt 0 ]; then shift; fi

case "$cmd" in
  sync)
    exec "$ROOT/deploy/git-sync.sh" "$@"
    ;;

  update)
    log "34：git pull → 重建部署（健康檢查沒過會自動回滾）"
    on_vm "sudo ./deploy/deploy.sh --pull"
    ;;

  restart)
    target="${1:-frontend+backend}"
    case "$target" in
      frontend+backend) containers="syncdrive_backend syncdrive_web" ;;
      all) containers="syncdrive_postgres syncdrive_redis syncdrive_mosquitto syncdrive_backend syncdrive_web" ;;
      *) containers="$(container_of "$target")" ;;
    esac
    log "34：重啟 ${containers}"
    # 用 docker restart：沿用現在跑的映像，不重建、不換版本
    on_vm "sudo docker restart ${containers} >/dev/null && echo '已重啟，等待就緒…' && sleep 10 && sudo ./deploy/healthcheck.sh"
    ;;

  status)
    on_vm "echo \"程式碼版本：\$(git log --oneline -1 2>/dev/null || echo 未接上 git)\"; \
           echo \"最後健康版本：\$(sudo cat deploy/.state/last-good-tag 2>/dev/null || echo 無紀錄)\"; \
           echo; sudo docker ps -a --filter name=syncdrive_ --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'"
    ;;

  logs)
    svc=backend
    follow=""
    for arg in "$@"; do
      case "$arg" in
        -f|--follow) follow="-f" ;;
        *) svc="$arg" ;;
      esac
    done
    container="$(container_of "$svc")"
    if [ -n "$follow" ]; then
      log "34：${container} 的 log（Ctrl+C 結束）"
      on_vm_tty "sudo docker logs --tail 200 -f ${container}"
    else
      on_vm "sudo docker logs --tail 200 ${container} 2>&1"
    fi
    ;;

  health)
    on_vm "sudo ./deploy/healthcheck.sh"
    ;;

  rollback)
    log "34：回到上一個通過健康檢查的版本"
    on_vm "sudo ./deploy/deploy.sh --rollback"
    ;;

  ssh)
    gcloud compute ssh "$INSTANCE" --zone "$ZONE" "$@"
    ;;

  ""|-h|--help|help)
    usage
    ;;

  *)
    echo "不認得的指令：$cmd" >&2
    echo >&2
    usage >&2
    exit 2
    ;;
esac
