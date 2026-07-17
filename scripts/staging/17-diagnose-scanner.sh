#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

ensure_state
[ -f "$STATE_DIR/ssh_config" ] || {
  warn "Scanner diagnostic skipped because staging SSH config is unavailable"
  exit 0
}

if ! ssh -F "$STATE_DIR/ssh_config" -o BatchMode=yes -o ConnectTimeout=5 aura-staging true >/dev/null 2>&1; then
  warn "Scanner diagnostic skipped because staging SSH is unavailable"
  exit 0
fi

warn "Collecting bounded staging scanner diagnostics after readiness failure"
ssh -F "$STATE_DIR/ssh_config" -o BatchMode=yes -o ConnectTimeout=5 aura-staging 'bash -s' <<'REMOTE'
set -euo pipefail
cd /opt/aura-staging/src/infra/staging
sudo docker compose ps scanner
sudo docker compose logs --tail=80 scanner
sudo docker compose exec -T backend node <<'NODE'
const net = require('net');
const socket = net.createConnection({ host: 'scanner', port: 3310 });
let settled = false;
const finish = (code, message) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.destroy();
    console.log(message);
    process.exitCode = code;
};
const timer = setTimeout(() => finish(1, 'backend-to-scanner PING timed out after 5000ms'), 5000);
socket.on('error', (error) => finish(1, `backend-to-scanner PING failed: ${error.code || 'socket_error'}`));
socket.on('data', (chunk) => {
    const response = chunk.toString('utf8').replace(/\0/g, '').trim();
    finish(/\bPONG\b/i.test(response) ? 0 : 1, `backend-to-scanner PING response: ${response || 'empty'}`);
});
socket.on('connect', () => socket.write('zPING\0'));
NODE
REMOTE
