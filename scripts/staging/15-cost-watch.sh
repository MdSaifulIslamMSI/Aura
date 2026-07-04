#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

assert_staging_prefix
need_env AWS_REGION
need_env STAGING_MONTHLY_BUDGET_USD
ensure_state

start_date="$(date -u +"%Y-%m-01")"
end_date="$(date -u -d tomorrow +"%Y-%m-%d" 2>/dev/null || node -e 'const d = new Date(Date.now() + 86400000); process.stdout.write(d.toISOString().slice(0, 10));')"

tag_status="$(aws_cli ce list-cost-allocation-tags \
  --region us-east-1 \
  --status Active \
  --tag-keys Environment \
  --query "CostAllocationTags[?TagKey=='Environment'].Status | [0]" \
  --output text 2>"$STATE_DIR/cost-allocation-tags.err" || true)"
if [ "$tag_status" != "Active" ]; then
  if [ "${ALLOW_NO_COST_WATCH:-false}" = "true" ]; then
    if [ -s "$STATE_DIR/cost-allocation-tags.err" ]; then
      warn "Could not verify the Environment cost allocation tag; skipping optional tag-filtered cost watch."
    else
      warn "Environment cost allocation tag is not active; leaving tag-filtered cost watch as a warning."
    fi
    cat "$STATE_DIR/cost-allocation-tags.err" >&2
    exit 0
  fi
  cat "$STATE_DIR/cost-allocation-tags.err" >&2
  die "Cost watch requires the Environment cost allocation tag to be active."
fi

cost_output="$STATE_DIR/cost-watch.json"
if ! aws_cli ce get-cost-and-usage \
  --region us-east-1 \
  --time-period "Start=$start_date,End=$end_date" \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --filter '{"Tags":{"Key":"Environment","Values":["staging"],"MatchOptions":["EQUALS"]}}' \
  --output json > "$cost_output" 2>"$STATE_DIR/cost-watch.err"; then
  if [ "${ALLOW_NO_COST_WATCH:-false}" = "true" ]; then
    warn "Cost Explorer read failed and ALLOW_NO_COST_WATCH=true is set; leaving cost watch as a warning."
    cat "$STATE_DIR/cost-watch.err" >&2
    exit 0
  fi
  cat "$STATE_DIR/cost-watch.err" >&2
  die "Cost watch failed. Grant Cost Explorer read permissions or set ALLOW_NO_COST_WATCH=true intentionally."
fi

amount="$(node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const amount = data.ResultsByTime?.[0]?.Total?.UnblendedCost?.Amount || "0";
process.stdout.write(Number(amount).toFixed(2));
' "$(node_path "$cost_output")")"

node -e '
const amount = Number(process.argv[1]);
const budget = Number(process.argv[2]);
if (!Number.isFinite(amount) || !Number.isFinite(budget)) process.exit(2);
if (amount > budget) {
  console.error(`Staging spend ${amount.toFixed(2)} exceeds budget ${budget.toFixed(2)}.`);
  process.exit(1);
}
' "$amount" "$STAGING_MONTHLY_BUDGET_USD" || die "Staging cost watch exceeded the configured budget."

report="$REPO_ROOT/docs/staging-cost-watch.md"
cat > "$report" <<REPORT
# Staging Cost Watch

Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

| Check | Value |
| --- | --- |
| Environment | staging |
| SSM prefix | /aura/staging |
| Period start | $start_date |
| Period end | $end_date |
| Current tagged unblended cost | $amount USD |
| Monthly budget guard | $STAGING_MONTHLY_BUDGET_USD USD |
| Status | PASS |

This report uses Cost Explorer tag filtering for `Environment=staging`. Keep all staging AWS resources tagged with `Environment=staging` and `ManagedBy=codex-staging-bootstrap`.
REPORT

log "Staging cost watch passed: $amount USD / $STAGING_MONTHLY_BUDGET_USD USD"
