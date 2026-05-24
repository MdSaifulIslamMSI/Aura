#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOST_ROOT="$REPO_ROOT"
if command -v cygpath >/dev/null 2>&1; then
  HOST_ROOT="$(cygpath -w "$REPO_ROOT")"
fi

TARGET_URL="${1:-http://host.docker.internal:3000}"
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"
SCAN_TARGET="$TARGET_URL"

mkdir -p "$REPO_ROOT/security-reports"

case "$TARGET_URL" in
  *localhost*|*127.0.0.1*|*host.docker.internal*|*staging*|*preview*)
    ;;
  *)
    echo "Refusing OWASP ZAP baseline for non-local/non-staging target: $TARGET_URL" >&2
    exit 2
    ;;
esac

SCAN_TARGET="${SCAN_TARGET//localhost/host.docker.internal}"
SCAN_TARGET="${SCAN_TARGET//127.0.0.1/host.docker.internal}"

echo "Running OWASP ZAP baseline against $SCAN_TARGET"

docker run --rm \
  -v "$HOST_ROOT/security-reports:/zap/wrk" \
  "$ZAP_IMAGE" \
  zap-baseline.py \
  -t "$SCAN_TARGET" \
  -r zap-baseline.html \
  -J zap-baseline.json \
  -w zap-baseline.md
