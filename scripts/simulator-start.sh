#!/usr/bin/env bash
# 啟動並開啟 SyncDrive T3 外部模擬器（syncdrive_t3_simulator）
#
# 用法：
#   ./scripts/simulator-start.sh           # 啟動（已在跑則略過）並開瀏覽器
#   ./scripts/simulator-start.sh --force   # 強制重啟（含清掉佔用 4300 的殘留程序）
#   ./scripts/simulator-start.sh --stop    # 只停止（含清掉佔用 4300 的殘留程序）
#   ./scripts/simulator-start.sh --no-open # 啟動但不開瀏覽器
#
# 模擬器目錄預設為本專案的姊妹資料夾；可覆寫：
#   SYNCDRIVE_T3_SIMULATOR=/path/to/syncdrive_t3_simulator ./scripts/simulator-start.sh
#
# 實作在模擬器那邊的 sim.sh（依賴安裝、.env、路線路徑頁建置、產品服務檢查、背景啟動、
# 憑證續期、強制重啟與清埠都在那裡）；這裡只轉參數，兩邊不會各寫一套而走樣。

set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIM_ROOT="${SYNCDRIVE_T3_SIMULATOR:-$(cd "$ROOT/.." && pwd)/syncdrive_t3_simulator}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }

if [[ ! -x "$SIM_ROOT/sim.sh" ]]; then
  red "找不到 $SIM_ROOT/sim.sh"
  echo "請確認已 clone syncdrive_t3_simulator，或設定 SYNCDRIVE_T3_SIMULATOR。"
  exit 1
fi

command=start
args=()
open_browser=true
for arg in "$@"; do
  case "$arg" in
    --stop) command=stop ;;
    --force) args+=(--force) ;;
    --no-open) open_browser=false ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) red "不認得的參數：$arg"; exit 1 ;;
  esac
done

if [[ "$command" == "stop" ]]; then
  exec "$SIM_ROOT/sim.sh" stop
fi
$open_browser && args+=(--open)
exec env SYNCDRIVE_T3="$ROOT" "$SIM_ROOT/sim.sh" start ${args[@]+"${args[@]}"}
