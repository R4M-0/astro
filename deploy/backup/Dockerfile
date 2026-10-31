# Nightly Postgres dump + MinIO mirror, optionally shipped off-box.
FROM minio/mc@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727 AS mc

FROM postgres:16-alpine
RUN apk add --no-cache bash openssl
COPY --from=mc /usr/bin/mc /usr/local/bin/mc
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
