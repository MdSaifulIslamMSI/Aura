#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOST_ROOT="$REPO_ROOT"
if command -v cygpath >/dev/null 2>&1; then
  HOST_ROOT="$(cygpath -w "$REPO_ROOT")"
fi

TRIVY_IMAGE="${TRIVY_IMAGE:-aquasec/trivy:0.69.3}"

mkdir -p "$REPO_ROOT/security-reports" "$REPO_ROOT/.trivycache"

COMMON_ARGS=(
  fs /project
  --scanners vuln,secret,misconfig
  --skip-dirs /project/.trivycache
  --skip-dirs /project/security-reports
  --skip-dirs /project/node_modules
  --skip-dirs /project/app/node_modules
  --skip-dirs /project/server/node_modules
  --skip-dirs /project/.git
  --skip-dirs /project/.cache
  --skip-dirs /project/.netlify
  --skip-dirs /project/.vercel
  --skip-dirs /project/app/dist
  --skip-dirs /project/app/android/.gradle
  --skip-dirs /project/desktop-release
  --skip-dirs /project/generated
  --skip-dirs /project/output
  --skip-dirs /project/server/data
  --skip-dirs /project/server/uploads
)

docker run --rm \
  -v "$HOST_ROOT:/project" \
  -v "$HOST_ROOT/.trivycache:/root/.cache/" \
  "$TRIVY_IMAGE" \
  "${COMMON_ARGS[@]}" \
  --severity LOW,MEDIUM,HIGH,CRITICAL \
  --format table \
  --exit-code 0 \
  | tee "$REPO_ROOT/security-reports/trivy-fs-table.txt"

docker run --rm \
  -v "$HOST_ROOT:/project" \
  -v "$HOST_ROOT/.trivycache:/root/.cache/" \
  "$TRIVY_IMAGE" \
  "${COMMON_ARGS[@]}" \
  --severity HIGH,CRITICAL \
  --format json \
  --output /project/security-reports/trivy-fs.json \
  --exit-code 1
