#!/usr/bin/env bash
# One backup run: Postgres custom-format dump (encrypted, verified), local
# retention, and — when BACKUP_S3_ENDPOINT is set — upload of the encrypted dump
# + an encrypted mirror of the file bucket to off-box S3-compatible storage.
# Writes /backups/last-success on success.
#
# Encryption is mandatory: the dump is encrypted while it is written (the
# plaintext never touches the disk) with AES-256-CBC/PBKDF2 keyed by
# BACKUP_ENCRYPTION_PASSPHRASE; restore.sh decrypts it. Keep the passphrase
# outside this server — without it the backups are unreadable.
set -euo pipefail

: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required (backups are always encrypted)}"
enc() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE "$@"; }
dec() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_PASSPHRASE "$@"; }

ts=$(date -u +%Y%m%dT%H%M%SZ)
dir=/backups/pg
mkdir -p "$dir"
umask 077
out="$dir/astro-$ts.dump.enc"

echo "[backup] $ts dumping database"
export PGPASSWORD="$POSTGRES_PASSWORD"
pg_dump -h postgres -U "$POSTGRES_USER" -d astro -Fc -Z 6 -f - | enc -out "$out.partial"
dec -in "$out.partial" | pg_restore -l > /dev/null   # refuse to keep an unreadable dump
mv "$out.partial" "$out"
echo "[backup] dump ok: $(du -h "$out" | cut -f1)"

find "$dir" -name 'astro-*.dump*' -mtime +"${BACKUP_KEEP_DAYS:-7}" -delete

if [ -z "${BACKUP_S3_ENDPOINT:-}" ]; then
  echo "[backup] WARNING: BACKUP_S3_ENDPOINT not set — backups stay on this server's disk only (no protection against disk loss)" >&2
else
  mc alias set src http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" > /dev/null
  mc alias set dst "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY" > /dev/null
  bucket="${BACKUP_S3_BUCKET:?set BACKUP_S3_BUCKET}"
  dest="dst/$bucket"

  mc cp --quiet "$out" "$dest/postgres/"
  mc rm --recursive --force --older-than "${BACKUP_REMOTE_KEEP_DAYS:-30}d" "$dest/postgres/" > /dev/null || true

  # Files. Objects deleted in the app are kept remotely for recovery; _exports/
  # (temporary generated archives) is skipped.
  case "${BACKUP_FILES_MODE:-sse-c}" in
    sse-c)
      # Additive mirror, encrypted server-side with a customer key (SSE-C) derived
      # from the passphrase: the remote provider stores only ciphertext and never
      # the key. Requires an https endpoint that supports SSE-C.
      key=$(printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | openssl dgst -sha256 -binary | base64)
      mc mirror --quiet --overwrite --exclude "_exports/*" \
        --enc-c "dst/$bucket/files/=$key" \
        "src/${S3_BUCKET:-astro}" "$dest/files/"
      ;;
    tar)
      # For providers without SSE-C: one encrypted archive per run (full copy each night).
      mc mirror --quiet --overwrite --exclude "_exports/*" "src/${S3_BUCKET:-astro}" /tmp/files-mirror
      tar -C /tmp/files-mirror -cf - . | enc | mc pipe --quiet "$dest/files-archives/files-$ts.tar.enc"
      rm -rf /tmp/files-mirror
      mc rm --recursive --force --older-than "${BACKUP_REMOTE_KEEP_DAYS:-30}d" "$dest/files-archives/" > /dev/null || true
      ;;
    *) echo "[backup] unknown BACKUP_FILES_MODE '${BACKUP_FILES_MODE}' (sse-c|tar)" >&2; exit 1 ;;
  esac
  echo "[backup] shipped to ${BACKUP_S3_ENDPOINT}/${bucket}"
fi

date -u +%FT%TZ > /backups/last-success
echo "[backup] done"
