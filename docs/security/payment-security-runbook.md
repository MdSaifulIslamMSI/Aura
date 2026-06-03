# Payment Security Runbook

## Enforced Now

- Existing Stripe and Razorpay webhook tests continue to verify signature rejection and webhook guard behavior.
- Admin payment routes still require `protect` and `admin`.
- Critical admin payment actions are classified by the central sensitive-action policy as `PAYMENT_REFUND` or `PAYMENT_PAYOUT_CHANGE`.
- The policy requires admin, recent auth, registered WebAuthn, and fresh WebAuthn step-up in production unless an explicit rollback flag is enabled.
- Security audit events are emitted with redacted payment metadata.

## Rollback

Use `AUTH_SENSITIVE_ACTION_POLICY_ROLLBACK=true` only during an active incident with a named owner. Keep provider webhook verification enabled; do not disable Stripe or Razorpay signature checks to work around a policy issue.

## Local Commands

```sh
npm --prefix server test -- --runTestsByPath tests/paymentSecurityGuards.test.js tests/payments.webhook.security.test.js tests/paymentWebhookTransitionGuards.test.js tests/razorpayProviderSignatureSecurity.test.js --forceExit
npm run security:webhooks
```

## Production Checklist

- Confirm Stripe and Razorpay webhook secrets are present in the deployment secret manager.
- Confirm webhook replay/idempotency storage is healthy.
- Confirm admin payment operators have WebAuthn registered.
- Enable policy in monitor-first rollout, then enforce for a small admin cohort.
- Watch payment refund/capture denial audit events for false positives.

## Remaining Work

- Add route-level `requireSensitiveAction` directly on refund, capture, retry-capture, payout, and bank-change routes.
- Add provider timestamp tolerance tests where supported by the provider SDK.
- Add durable webhook replay evidence export for incident review.
