#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "data-sync.sh 已停止提供獨立覆蓋；請使用 deploy/sync.sh，資料會與固定 Git 版本一併驗證。" >&2
exec "$ROOT/deploy/sync.sh" "$@"
