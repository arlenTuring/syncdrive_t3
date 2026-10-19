#!/usr/bin/env bash
# Verifies that a restore command failure is not hidden by an if-condition.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
LIVE="$WORK/live"
BACKUP="$WORK/backup"
BIN="$WORK/bin"
mkdir -p "$LIVE/deploy/.state/sync" "$BACKUP" "$BIN"
printf 'IMAGE_TAG=old-tag\nDB_SYNCHRONIZE=false\n' > "$LIVE/deploy/.env"
printf 'old-tag\n' > "$BACKUP/image-tag"
printf 'old-sha\n' > "$BACKUP/git-sha"
printf 'archive\n' > "$BACKUP/database.dump"
cp "$LIVE/deploy/.env" "$BACKUP/deploy.env"
cat > "$LIVE/deploy/.state/sync/last-success.env" <<EOF
ROLLBACK_BACKUP='$BACKUP'
EOF
cat > "$BIN/docker" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *'pg_restore -U '* ) exit 42 ;;
  *) exit 0 ;;
esac
SH
chmod +x "$BIN/docker"
cat > "$BIN/flock" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$BIN/flock"

set +e
PATH="$BIN:$PATH" REMOTE_DIR="$LIVE" bash "$ROOT/deploy/remote-sync.sh" rollback >"$WORK/output" 2>&1
code=$?
set -e
[ "$code" -ne 0 ] || { echo "pg_restore 失敗時 rollback 不應回傳成功" >&2; exit 1; }
grep -q '回復失敗' "$WORK/output"
if grep -q '回復完成並通過驗收' "$WORK/output"; then
  echo "回復失敗時不應印出成功" >&2; exit 1
fi
echo "remote restore failure propagation: PASS"
