#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$SCRIPT_DIR/00-preflight.sh"
bash "$SCRIPT_DIR/01-create-budget.sh"
bash "$SCRIPT_DIR/02-create-s3-bucket.sh"
bash "$SCRIPT_DIR/03-put-ssm-params.sh"
bash "$SCRIPT_DIR/04-create-security-group.sh"
bash "$SCRIPT_DIR/05-launch-ec2.sh"
bash "$SCRIPT_DIR/06-render-ssh-config.sh"
bash "$SCRIPT_DIR/07-deploy-compose.sh"
bash "$SCRIPT_DIR/08-set-github-vars.sh"
bash "$SCRIPT_DIR/09-set-vercel-vars.sh"
bash "$SCRIPT_DIR/12-deploy-frontend-docker.sh"
if [ "${ENABLE_STAGING_HTTPS:-false}" = "true" ]; then
  bash "$SCRIPT_DIR/11-configure-https-domain.sh"
fi
bash "$SCRIPT_DIR/10-verify-staging.sh"

printf 'SUCCESS: Code is staging-safe, and live staging infrastructure is present.\n'
