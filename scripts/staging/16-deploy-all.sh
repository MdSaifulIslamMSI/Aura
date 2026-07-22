#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

assert_staging_prefix
validate_staging_admin_security_phase

https_configured_before_deploy=false
if staging_admin_security_enabled; then
  bash "$SCRIPT_DIR/11-configure-https-domain.sh"
  bash "$SCRIPT_DIR/03b-put-admin-security-ssm-params.sh"
  https_configured_before_deploy=true
fi

bash "$SCRIPT_DIR/07-deploy-compose.sh"
bash "$SCRIPT_DIR/12-deploy-frontend-docker.sh"
if [ "$ENABLE_STAGING_HTTPS" = "true" ] && [ "$https_configured_before_deploy" = "false" ]; then
  bash "$SCRIPT_DIR/11-configure-https-domain.sh"
fi
bash "$SCRIPT_DIR/10-verify-staging.sh"

printf 'SUCCESS: Staging backend, frontend, and smoke verification completed without production fallback.\n'
