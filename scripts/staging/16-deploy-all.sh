#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

assert_staging_prefix

bash "$SCRIPT_DIR/07-deploy-compose.sh"
bash "$SCRIPT_DIR/12-deploy-frontend-docker.sh"
if [ "$ENABLE_STAGING_HTTPS" = "true" ]; then
  bash "$SCRIPT_DIR/11-configure-https-domain.sh"
fi
bash "$SCRIPT_DIR/10-verify-staging.sh"

printf 'SUCCESS: Staging backend, frontend, and smoke verification completed without production fallback.\n'
