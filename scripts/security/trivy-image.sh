#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOST_ROOT="$REPO_ROOT"
if command -v cygpath >/dev/null 2>&1; then
  HOST_ROOT="$(cygpath -w "$REPO_ROOT")"
fi

IMAGE_NAME="${1:-app-security-local:latest}"
TRIVY_IMAGE="${TRIVY_IMAGE:-aquasec/trivy:0.69.3}"

mkdir -p "$REPO_ROOT/security-reports" "$REPO_ROOT/.trivycache"

if [ -f "$REPO_ROOT/Dockerfile" ]; then
  docker build -t "$IMAGE_NAME" "$REPO_ROOT"
elif [ -f "$REPO_ROOT/server/Dockerfile" ]; then
  docker build -f "$REPO_ROOT/server/Dockerfile" -t "$IMAGE_NAME" "$REPO_ROOT/server"
else
  echo "No Dockerfile found. Skipping Trivy image scan."
  exit 0
fi

docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOST_ROOT:/project" \
  -v "$HOST_ROOT/.trivycache:/root/.cache/" \
  "$TRIVY_IMAGE" \
  image "$IMAGE_NAME" \
  --scanners vuln,secret,misconfig \
  --severity HIGH,CRITICAL \
  --format table \
  --exit-code 1 \
  | tee "$REPO_ROOT/security-reports/trivy-image-table.txt"
