#!/usr/bin/env bash
# Historical local -> GCP resource uploader.  Keep only a compatibility path so
# it cannot bypass the version, migration, backup and verification guarantees.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "sync-local-with-gcp.sh 已整合至 deploy/sync.sh；方向仍是本機設定 → GCP。" >&2
exec "$ROOT/deploy/sync.sh" "$@"
