#!/usr/bin/env sh
# Fails when a production dependency has a known advisory (moderate or worse).
set -e
cd "$(dirname "$0")/.."
pnpm audit --prod --audit-level=moderate
