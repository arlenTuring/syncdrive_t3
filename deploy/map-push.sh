#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "map-push.sh 已整合至 deploy/sync.sh；地圖會與固定版本及資料包一起校驗。" >&2
exec "$ROOT/deploy/sync.sh" "$@"
