#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

ensure_state
public_dns="$(state_get public_dns)"
[ -n "$public_dns" ] || die "Missing public_dns in $STATE_FILE. Run 05-launch-ec2.sh first."
public_ip="$(state_get public_ip)"
host_name="${public_ip:-$public_dns}"

ssh_user="${STAGING_SSH_USER:-ec2-user}"
generated_key_path="$(state_get ssh_key_file)"
ssh_key_path="${STAGING_KEY_PATH:-${generated_key_path:-$HOME/.ssh/$STAGING_KEY_NAME.pem}}"

[ -f "$ssh_key_path" ] || die "SSH key not found at $ssh_key_path. Set STAGING_KEY_PATH if needed."

cat > "$STATE_DIR/ssh_config" <<CFG
Host aura-staging
  HostName $host_name
  AddressFamily inet
  User $ssh_user
  IdentityFile "$ssh_key_path"
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
  ServerAliveInterval 30
CFG

chmod 600 "$STATE_DIR/ssh_config"
state_set ssh_host_alias aura-staging
state_set ssh_user "$ssh_user"
log "Rendered SSH config for aura-staging"
