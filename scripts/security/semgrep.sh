#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOST_ROOT="$REPO_ROOT"
if command -v cygpath >/dev/null 2>&1; then
  HOST_ROOT="$(cygpath -w "$REPO_ROOT")"
fi

SEMGREP_IMAGE="${SEMGREP_IMAGE:-semgrep/semgrep:1.163.0}"

mkdir -p "$REPO_ROOT/security-reports"

docker run --rm \
  -v "$HOST_ROOT:/src" \
  -w /src \
  "$SEMGREP_IMAGE" \
  semgrep scan \
  --config auto \
  --severity ERROR \
  --error \
  --json \
  --output /src/security-reports/semgrep-report.json \
  /src
