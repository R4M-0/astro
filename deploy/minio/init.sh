#!/bin/sh
# One-shot: create the file bucket and a bucket-scoped application user for the
# API/worker, so the MinIO root credentials never leave the minio + backup
# containers. Idempotent — safe to run on every `docker compose up`.
set -eu
: "${MINIO_ROOT_USER:?}" "${MINIO_ROOT_PASSWORD:?}" "${MINIO_APP_ACCESS_KEY:?}" "${MINIO_APP_SECRET_KEY:?}"
bucket="${S3_BUCKET:-astro}"

until mc alias set root http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" > /dev/null 2>&1; do
  echo "[minio-init] waiting for minio…"; sleep 2
done

mc mb --ignore-existing "root/$bucket"
mc anonymous set none "root/$bucket" > /dev/null

cat > /tmp/astro-app.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation", "s3:ListBucketMultipartUploads"],
      "Resource": ["arn:aws:s3:::$bucket"] },
    { "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject",
                 "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      "Resource": ["arn:aws:s3:::$bucket/*"] }
  ]
}
JSON
mc admin policy create root astro-app /tmp/astro-app.json
# `user add` on an existing user only updates its secret (rotation = change the env + re-run)
mc admin user add root "$MINIO_APP_ACCESS_KEY" "$MINIO_APP_SECRET_KEY"
mc admin policy attach root astro-app --user "$MINIO_APP_ACCESS_KEY" 2>/dev/null || true
echo "[minio-init] bucket '$bucket' + scoped user '$MINIO_APP_ACCESS_KEY' ready"
