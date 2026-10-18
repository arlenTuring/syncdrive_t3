#!/usr/bin/env bash
# Compatibility shim for operators already logged into the VM.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "${1:-}" in
  --rollback) exec "$ROOT/deploy/remote-sync.sh" rollback ;;
  *)
    echo "deploy.sh 不再單獨切換版本；請從開發機執行 ./deploy/sync.sh。" >&2
    echo "回復仍可在 VM 執行：sudo ./deploy/deploy.sh --rollback" >&2
    exit 2
    ;;
esac
