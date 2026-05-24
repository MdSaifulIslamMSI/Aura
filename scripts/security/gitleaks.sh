#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOST_ROOT="$REPO_ROOT"
if command -v cygpath >/dev/null 2>&1; then
  HOST_ROOT="$(cygpath -w "$REPO_ROOT")"
fi

GITLEAKS_IMAGE="${GITLEAKS_IMAGE:-ghcr.io/gitleaks/gitleaks:v8.30.1}"

mkdir -p "$REPO_ROOT/security-reports"

ARGS=(
  run --rm
  -v "$HOST_ROOT:/repo"
  "$GITLEAKS_IMAGE"
  detect
  --source="/repo"
  --report-format=json
  --report-path="/repo/security-reports/gitleaks-report.json"
  --redact
  --exit-code=1
)

if [ -f "$REPO_ROOT/.gitleaks.toml" ]; then
  ARGS+=(--config="/repo/.gitleaks.toml")
fi

if [ -f "$REPO_ROOT/.gitleaks-baseline.json" ]; then
  ARGS+=(--baseline-path="/repo/.gitleaks-baseline.json")
fi

docker "${ARGS[@]}"
