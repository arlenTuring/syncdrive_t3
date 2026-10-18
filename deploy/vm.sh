#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
printf '提示：deploy/vm.sh 已更名為 deploy/sync.sh。\n' >&2
exec "$ROOT/deploy/sync.sh" "$@"
