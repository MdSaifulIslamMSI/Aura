# Emergency Controls

This system is a defensive production safety layer. It is not a backdoor, does not delete data, does not bypass authentication, and does not expose secret public routes.

## Access

- Public status: `GET /api/emergency/status`
- Admin panel: `/admin/emergency-controls`
- Admin API: `/api/admin/emergency-controls`
- Required admin posture: authenticated admin with `SUPER_ADMIN` or `SECURITY_ADMIN`, or an audited email in `EMERGENCY_CONTROL_ADMIN_EMAILS`.
- Mutations require the existing strong session posture. Critical actions require a reason. `GLOBAL_MAINTENANCE`, `READ_ONLY_MODE`, and `FORCE_LOGOUT_ALL_USERS` require `I UNDERSTAND`.

## Precedence

1. Environment overrides have highest priority, for example `EMERGENCY_GLOBAL_MAINTENANCE=true`.
2. `GLOBAL_MAINTENANCE` blocks normal user behavior while keeping health checks, `/api/emergency/status`, payment webhooks, and emergency admin recovery APIs reachable.
3. `READ_ONLY_MODE` blocks writes and mutations while keeping emergency recovery APIs and payment webhook ingestion reachable.
4. Feature-specific flags apply after global and read-only checks.

## Flags

- `GLOBAL_MAINTENANCE`: block normal routes with HTTP 503. Default expiry suggestion: 30 minutes.
- `READ_ONLY_MODE`: allow reads and block writes with HTTP 423. Default expiry suggestion: 1 hour.
- `DISABLE_LOGIN`: block new login flows. Existing sessions continue unless force logout is active.
- `DISABLE_SIGNUP`: block new account creation.
- `DISABLE_CHECKOUT`: block checkout and order creation while product/cart browsing stays available. Default expiry suggestion: 2 hours.
- `DISABLE_PAYMENT`: block new digital payment initiation/confirmation/refunds/provider actions. COD can remain available. Default expiry suggestion: 2 hours.
- `DISABLE_OTP_SEND`: block OTP send with a generic message. Default expiry suggestion: 1 hour.
- `DISABLE_PASSWORD_RESET`: block forgot/reset password flows.
- `DISABLE_AI_ASSISTANT`: block assistant APIs and hide assistant entry points.
- `DISABLE_ADMIN_MUTATIONS`: block normal admin write actions, excluding emergency recovery APIs.
- `DISABLE_REFUNDS`: block refund actions.
- `DISABLE_ORDER_CANCELLATION`: block customer/admin cancellation actions.
- `STRICT_RATE_LIMIT_MODE`: applies stricter global request limits.
- `FORCE_LOGOUT_ALL_USERS`: revokes browser sessions and rejects older tokens by global activation timestamp.
- `DISABLE_PUBLIC_API_MUTATIONS`: blocks risky non-admin public mutations.
- `SHOW_EMERGENCY_BANNER`: displays the public user message from the status endpoint.

Expired flags are ignored automatically by enforcement and still appear in the admin UI as inactive/expired.

## Fail Mode

If emergency config cannot be read:

- Product browsing may fail open.
- Public GET pages may fail open.
- Checkout mutations fail closed.
- Payment mutations fail closed.
- Admin mutations fail closed.
- Refunds and order cancellation fail closed.
- Risky public mutations fail closed.

Every emergency-blocked API response includes a `requestId`. Public responses never include `internalReason`, actor metadata, audit hashes, or admin-only fields.

## Webhook Safety Matrix

| Condition | Raw provider webhook | Payment/order mutation |
| --- | --- | --- |
| Normal | Persisted | Allowed if idempotent and valid |
| `DISABLE_PAYMENT` | Persisted | Suppressed |
| `READ_ONLY_MODE` | Persisted | Suppressed |
| `GLOBAL_MAINTENANCE` | Persisted | Suppressed |
| Emergency status unknown | Persisted when possible | Suppressed |

Never delete pending orders or payment intents during an emergency. Pending payment states should expire through normal timeout rules. Reconciliation can continue only when it is safe and idempotent.

## Audit And Observability

`EmergencyAuditLog` is append-only. The app exposes no update/delete API routes for it. Each row stores `requestId`, actor, IP, user agent, previous value, new value, reason, and a hash-chain field for future tamper detection.

Structured logs include flag evaluation failures, activations, deactivations, blocked requests, unauthorized attempts, and notification failures without secrets, OTPs, tokens, or payment credentials.

Metrics:

- `emergency_flag_active{flagKey}`
- `emergency_request_blocked_total{flagKey,route}`
- `emergency_admin_action_total{action,flagKey}`

Notification hook:

- `notifyEmergencyFlagChanged(flagKey, action, actor, reason)` is currently a safe placeholder.
- Notification failures are logged and never block activation/deactivation.

## Rollback

1. Confirm incident owner and current active flags.
2. Deactivate the smallest flag that restores safe behavior.
3. Record the reason.
4. Verify public status no longer lists the disabled feature.
5. Run a direct API check for the formerly blocked route.
6. Review audit trail and incident notes.

## Incident Examples

Payment provider outage:
Activate `DISABLE_PAYMENT` for 2 hours. Leave catalog/cart/COD available. Webhooks are still ingested and unsafe mutations are suppressed.

OTP abuse attack:
Activate `DISABLE_OTP_SEND` for 1 hour. Login/signup/recovery surfaces show generic verification unavailable messaging and do not reveal account existence.

Database write-risk incident:
Activate `READ_ONLY_MODE` for 1 hour. Product pages and public GETs can remain available while mutations fail closed.

AI assistant issue:
Activate `DISABLE_AI_ASSISTANT`. Assistant APIs are blocked, and frontend assistant launchers/workspace show fallback support.

Admin compromise suspicion:
Activate `DISABLE_ADMIN_MUTATIONS` and consider `FORCE_LOGOUT_ALL_USERS`. Emergency control APIs remain available to authorized emergency admins for recovery.

## Commands

```bash
npm run seed:emergency-flags
npm run test:emergency-controls
```

## Testing Checklist

- Public status hides `internalReason`.
- Direct API calls cannot bypass disabled payment/checkout/admin mutation flags.
- Maintenance allows health, status, webhooks, and emergency admin recovery.
- Read-only allows GET and blocks POST/PUT/PATCH/DELETE.
- Critical actions require reason and confirmation phrase where applicable.
- Failed emergency-control attempts create audit logs.
- Webhook raw payloads persist while unsafe mutations are suppressed.
