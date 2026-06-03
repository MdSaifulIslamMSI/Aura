# Payment Security Runbook

## Enforced Now

- Existing Stripe and Razorpay webhook tests continue to verify signature rejection and webhook guard behavior.
- Admin payment routes still require `protect` and `admin`.
- Critical admin payment actions are wired through route-level `sensitiveActions.paymentRefund` or `sensitiveActions.paymentPayoutChange`.
- Customer refund, saved-method, setup-intent, intent confirm, and challenge routes require OTP assurance plus fresh sensitive-action posture.
- Saved payment method mutations also use route-level owner authorization before controller mutation.
- Payment webhook receivers record redacted accepted, replayed, and signature-invalid security audit events.

## Rollback

Use `AUTH_SENSITIVE_ACTION_POLICY_ROLLBACK=true` only during an active incident with a named owner. Keep provider webhook verification enabled; do not disable Stripe or Razorpay signature checks to work around a policy issue.

## Local Commands

```sh
npm --prefix server test -- --runTestsByPath tests/paymentSecurityGuards.test.js tests/payments.webhook.security.test.js tests/paymentWebhookTransitionGuards.test.js tests/razorpayProviderSignatureSecurity.test.js --forceExit
npm run security:webhooks
npm run security:routes:coverage:strict
```

## Production Checklist

- Confirm Stripe and Razorpay webhook secrets are present in the deployment secret manager.
- Confirm webhook replay/idempotency storage is healthy.
- Confirm admin payment operators have WebAuthn registered.
- Enable policy in monitor-first rollout, then enforce for a small admin cohort.
- Watch payment refund/capture denial audit events for false positives.

## Remaining Work

- Add provider timestamp tolerance tests where supported by the provider SDK.
- Add durable webhook replay evidence export for incident review.
