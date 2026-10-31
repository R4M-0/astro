#!/usr/bin/env bash
# Runs backup.sh every day at BACKUP_AT (HH:MM, server local time = UTC in the container).
set -euo pipefail
at="${BACKUP_AT:-02:30}"
echo "[backup] scheduler up — daily run at ${at} UTC"
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) ${at}" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  /usr/local/bin/backup.sh || echo "[backup] FAILED at $(date -u +%FT%TZ)" >&2
done
