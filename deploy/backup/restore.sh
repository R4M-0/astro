#!/usr/bin/env bash
# Restore a dump produced by backup.sh.
#
#   restore.sh verify <dump>   restore into a scratch DB, print row counts, drop it (monthly drill)
#   restore.sh apply  <dump>   REPLACE the live `astro` database — stop the api first
#
# Encrypted (.enc) dumps — every dump since Oct 2026 — are decrypted with
# BACKUP_ENCRYPTION_PASSPHRASE into a private temp file that is removed on exit.
#
# Off-box files: SSE-C mirror (BACKUP_FILES_MODE=sse-c) — read back with
#   key=$(printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | openssl dgst -sha256 -binary | base64)
#   mc mirror --enc-c "dst/<bucket>/files/=$key" dst/<bucket>/files/ src/astro
# tar mode — mc cat dst/<bucket>/files-archives/files-<ts>.tar.enc \
#   | openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_PASSPHRASE | tar -xf -
set -euo pipefail
mode="${1:-}"; file="${2:-}"
[ -f "$file" ] || { echo "usage: restore.sh verify|apply <dump file>" >&2; exit 1; }
export PGPASSWORD="$POSTGRES_PASSWORD"
psql_() { psql -h postgres -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 "$@"; }

if [[ "$file" == *.enc ]]; then
  : "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required to decrypt $file}"
  umask 077
  plain="$(mktemp -d)/$(basename "${file%.enc}")"
  trap 'rm -rf "$(dirname "$plain")"' EXIT
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$file" -out "$plain"
  file="$plain"
fi

case "$mode" in
  verify)
    db=astro_restore_check
    psql_ -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db"
    pg_restore -h postgres -U "$POSTGRES_USER" -d "$db" --no-owner --exit-on-error "$file"
    psql_ -d "$db" -qc "ANALYZE"
    psql_ -d "$db" -c "SELECT relname AS table, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 15"
    psql_ -d "$db" -Atc 'SELECT count(*) || '"' organizations'"' FROM "Organization"'
    psql_ -d postgres -c "DROP DATABASE $db"
    echo "[restore] verify OK"
    ;;
  apply)
    echo "[restore] replacing database astro from $file in 10s — Ctrl-C to abort"; sleep 10
    pg_restore -h postgres -U "$POSTGRES_USER" -d astro --clean --if-exists --no-owner --exit-on-error "$file"
    echo "[restore] applied — start the api again"
    ;;
  *) echo "usage: restore.sh verify|apply <dump file>" >&2; exit 1 ;;
esac
