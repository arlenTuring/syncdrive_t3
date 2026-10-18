#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "push.sh 已整合至 deploy/sync.sh；不再以 rsync 修改遠端工作目錄。" >&2
exec "$ROOT/deploy/sync.sh" "$@"
