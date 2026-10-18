#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "git-sync.sh 已停止提供獨立部署；請使用 deploy/sync.sh，避免程式與資料版本分離。" >&2
exec "$ROOT/deploy/sync.sh" "$@"
