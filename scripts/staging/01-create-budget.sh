#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

need_env AWS_ACCOUNT_ID
need_env STAGING_BUDGET_EMAIL
need_env STAGING_MONTHLY_BUDGET_USD

budget_name="${PROJECT_NAME}-${STAGING_NAME}-monthly-budget"
budget_file="$STATE_DIR/budget.json"
notification_file="$STATE_DIR/budget-notification.json"
forecast_notification_file="$STATE_DIR/budget-forecast-notification.json"
subscribers_file="$STATE_DIR/budget-subscribers.json"
ensure_state

cat > "$budget_file" <<JSON
{
  "BudgetName": "$budget_name",
  "BudgetLimit": {
    "Amount": "$STAGING_MONTHLY_BUDGET_USD",
    "Unit": "USD"
  },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST"
}
JSON

cat > "$notification_file" <<JSON
[
  {
    "Notification": {
      "NotificationType": "ACTUAL",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 80,
      "ThresholdType": "PERCENTAGE"
    },
    "Subscribers": [
      {
        "SubscriptionType": "EMAIL",
        "Address": "$STAGING_BUDGET_EMAIL"
      }
    ]
  },
  {
    "Notification": {
      "NotificationType": "FORECASTED",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 80,
      "ThresholdType": "PERCENTAGE"
    },
    "Subscribers": [
      {
        "SubscriptionType": "EMAIL",
        "Address": "$STAGING_BUDGET_EMAIL"
      }
    ]
  }
]
JSON

cat > "$forecast_notification_file" <<'JSON'
{
  "NotificationType": "FORECASTED",
  "ComparisonOperator": "GREATER_THAN",
  "Threshold": 80,
  "ThresholdType": "PERCENTAGE"
}
JSON

cat > "$subscribers_file" <<JSON
[
  {
    "SubscriptionType": "EMAIL",
    "Address": "$STAGING_BUDGET_EMAIL"
  }
]
JSON

set +e
if aws_cli budgets describe-budget --region us-east-1 --account-id "$AWS_ACCOUNT_ID" --budget-name "$budget_name" >/dev/null 2>&1; then
  aws_cli budgets update-budget --region us-east-1 --account-id "$AWS_ACCOUNT_ID" --new-budget "$(aws_file_uri "$budget_file")" >/tmp/aura-budget.log 2>&1
  rc=$?
else
  aws_cli budgets create-budget --region us-east-1 --account-id "$AWS_ACCOUNT_ID" --budget "$(aws_file_uri "$budget_file")" --notifications-with-subscribers "$(aws_file_uri "$notification_file")" >/tmp/aura-budget.log 2>&1
  rc=$?
fi
set -e

if [ "$rc" -ne 0 ]; then
  if [ "${ALLOW_NO_BUDGET:-false}" = "true" ]; then
    warn "Budget API failed, continuing because ALLOW_NO_BUDGET=true"
    warn "Budget API error was captured in /tmp/aura-budget.log"
    exit 0
  fi
  cat /tmp/aura-budget.log >&2 || true
  die "Budget guardrail could not be created or updated. Set ALLOW_NO_BUDGET=true only if this is intentional."
fi

forecast_notification_exists="$(aws_cli budgets describe-notifications-for-budget \
  --region us-east-1 \
  --account-id "$AWS_ACCOUNT_ID" \
  --budget-name "$budget_name" \
  --query "contains(Notifications[].NotificationType, 'FORECASTED')" \
  --output text)"
if [ "$forecast_notification_exists" != "True" ]; then
  aws_cli budgets create-notification \
    --region us-east-1 \
    --account-id "$AWS_ACCOUNT_ID" \
    --budget-name "$budget_name" \
    --notification "$(aws_file_uri "$forecast_notification_file")" \
    --subscribers "$(aws_file_uri "$subscribers_file")"
fi

state_set budget_name "$budget_name"
log "Budget guardrail is configured: $budget_name"
