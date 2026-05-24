#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HADOLINT_IMAGE="${HADOLINT_IMAGE:-hadolint/hadolint:latest-debian}"

mkdir -p "$REPO_ROOT/security-reports"

if [ -f "$REPO_ROOT/Dockerfile" ]; then
  docker run --rm -i "$HADOLINT_IMAGE" < "$REPO_ROOT/Dockerfile" | tee "$REPO_ROOT/security-reports/hadolint.txt"
elif [ -f "$REPO_ROOT/server/Dockerfile" ]; then
  docker run --rm -i "$HADOLINT_IMAGE" < "$REPO_ROOT/server/Dockerfile" | tee "$REPO_ROOT/security-reports/hadolint.txt"
else
  echo "No Dockerfile found. Skipping Hadolint." | tee "$REPO_ROOT/security-reports/hadolint.txt"
fi
