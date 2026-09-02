#!/usr/bin/env bash
# Registers a bouncer with the Aura CrowdSec agent and prints the API key.
#
# Usage (from the host with the edge compose stack running):
#   ./infra/edge/crowdsec/register-bouncer.sh <bouncer-name>
#
# The printed key is given ONCE to the bouncer component (e.g. the
# firewall-bouncer installed on the EC2 host — see docs runbook). Store it in
# your secrets manager, never in git.
set -euo pipefail

NAME="${1:?bouncer name required}"
docker compose -f "$(dirname "$0")/../docker-compose.yml" exec -T crowdsec \
  cscli bouncers add "$NAME" -o raw
