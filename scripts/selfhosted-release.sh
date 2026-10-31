#!/usr/bin/env bash
# Build a self-hosted Astro release for one customer.
#
#   LICENSE_PUBLIC_KEY_FILE=~/.astro/license-public.pem \
#   scripts/selfhosted-release.sh <version> <customer-slug> <app-domain> <files-domain> [--push]
#
# Produces:
#   $REGISTRY/astro/api:<version>                 — generic, V8 bytecode, license-enforcing
#   $REGISTRY/astro/web-<customer>:<version>      — Next build for the customer's domains
#   dist/selfhosted/astro-<customer>-<version>.tar.gz — compose bundle (no application source)
set -euo pipefail

version=${1:?version}
customer=${2:?customer slug}
app_domain=${3:?app domain}
files_domain=${4:?files domain}
push=${5:-}
registry=${REGISTRY:-registry.astro.app}
key_file=${LICENSE_PUBLIC_KEY_FILE:?LICENSE_PUBLIC_KEY_FILE (license-public.pem)}
root=$(cd "$(dirname "$0")/.." && pwd)
build_date=$(date -u +%Y-%m-%dT%H:%M:%SZ)

[[ "$customer" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "customer slug: lowercase letters, digits, dashes"; exit 1; }

api_image="$registry/astro/api:$version"
web_image="$registry/astro/web-$customer:$version"

echo "› api image $api_image"
docker build -f "$root/apps/api/Dockerfile.selfhosted" \
  --build-arg LICENSE_PUBLIC_KEY="$(base64 -w0 "$key_file")" \
  --build-arg BUILD_DATE="$build_date" \
  -t "$api_image" "$root"

echo "› web image $web_image"
docker build -f "$root/apps/web/Dockerfile" \
  --build-arg NEXT_PUBLIC_API_URL="https://$app_domain/api/v1" \
  --build-arg NEXT_PUBLIC_FILES_ORIGIN="https://$files_domain" \
  --build-arg NEXT_PUBLIC_DEPLOYMENT_MODE=self-hosted \
  -t "$web_image" "$root"

if [[ "$push" == "--push" ]]; then
  docker push "$api_image"
  docker push "$web_image"
fi

echo "› install bundle"
out="$root/dist/selfhosted"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
bundle="$stage/astro"
mkdir -p "$bundle/deploy"
cp -r "$root/deploy/self-hosted" "$root/deploy/minio" "$root/deploy/backup" "$root/deploy/Caddyfile" "$bundle/deploy/"
sed -i \
  -e "s#^ASTRO_REGISTRY=.*#ASTRO_REGISTRY=$registry#" \
  -e "s#^ASTRO_CUSTOMER=.*#ASTRO_CUSTOMER=$customer#" \
  -e "s#^ASTRO_VERSION=.*#ASTRO_VERSION=$version#" \
  -e "s#^APP_DOMAIN=.*#APP_DOMAIN=$app_domain#" \
  -e "s#^FILES_DOMAIN=.*#FILES_DOMAIN=$files_domain#" \
  "$bundle/deploy/self-hosted/.env.example"
mkdir -p "$out"
tar -C "$stage" -czf "$out/astro-$customer-$version.tar.gz" astro
echo "✓ $out/astro-$customer-$version.tar.gz"
