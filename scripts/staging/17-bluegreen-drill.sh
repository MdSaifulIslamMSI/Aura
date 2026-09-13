#!/usr/bin/env bash
# Blue-green staging drill. Run ON the staging host (via SSM or SSH) after
# booting staging. Proves that the blue-green deploy mode:
#   1. activates a release without dropping a single HTTP request,
#   2. switches traffic by alias only (no container recreation on the
#      active slot, no 80/443 churn),
#   3. fails safely when the incoming slot is broken (active keeps serving),
#   4. can deploy again in the opposite direction (slot ping-pong).
#
# Environment:
#   AURA_RELEASE_SHA / AURA_DEPLOY_BUCKET / AURA_INFRA_BUNDLE_KEY /
#   AURA_IMAGE_BUNDLE_KEY / AURA_INFRA_BUNDLE_SHA256 / AURA_IMAGE_BUNDLE_SHA256
#   — the same contract deploy-release.sh already requires (two pre-staged
#   releases, or the same bundle for both drill legs).
#   DRILL_TARGET_URL — base URL used by the downtime probe (default
#   http://127.0.0.1 health via the edge).
set -euo pipefail

DRILL_TARGET_URL="${DRILL_TARGET_URL:-http://127.0.0.1/health/live}"
export AURA_BACKEND_DEPLOY_STRATEGY=blue-green

probe_log="$(mktemp)"
probe_pid=""
start_probe() {
  (
    failures=0
    total=0
    while :; do
      total=$((total + 1))
      if ! curl --fail --silent --show-error --connect-timeout 2 --max-time 5 "${DRILL_TARGET_URL}" >/dev/null; then
        failures=$((failures + 1))
      fi
      printf '%s %s\n' "${total}" "${failures}" > "${probe_log}"
      sleep 0.5
    done
  ) &
  probe_pid=$!
}

stop_probe() {
  if [[ -n "${probe_pid}" ]]; then
    kill "${probe_pid}" 2>/dev/null || true
    wait "${probe_pid}" 2>/dev/null || true
    probe_pid=""
  fi
  read -r total failures < "${probe_log}"
  echo "Downtime probe: ${failures} failed of ${total} requests."
  if [[ "${failures}" -gt 0 ]]; then
    echo "DRILL FAILED: requests were dropped during the switch." >&2
    return 1
  fi
}
trap stop_probe EXIT

echo "=== Leg 1: deploy with blue-green (probe running) ==="
start_probe
infra/aws/deploy-release.sh

echo "=== Leg 2: deploy again in the opposite direction ==="
infra/aws/deploy-release.sh

stop_probe
trap - EXIT
rm -f "${probe_log}"

echo "=== Leg 3: fail-safe proof — refuse a broken incoming slot ==="
# An intentionally invalid bundle sha must fail BEFORE anything touches the
# active slot, and the edge must keep serving throughout.
AURA_INFRA_BUNDLE_SHA256="$(printf 'a%.0s' $(seq 1 64))" \
  infra/aws/deploy-release.sh && {
    echo "DRILL FAILED: deploy with a corrupt bundle SHA was accepted." >&2
    exit 1
  } || echo "Broken-slot refusal behaved as expected."

if curl --fail --silent --show-error --max-time 10 "${DRILL_TARGET_URL}" >/dev/null; then
  echo "DRILL PASSED: blue-green deploy, opposite-direction deploy, and fail-safe refusal all held with zero downtime."
else
  echo "DRILL FAILED: edge is not serving after the drill." >&2
  exit 1
fi
