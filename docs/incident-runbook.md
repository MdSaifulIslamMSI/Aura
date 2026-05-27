# Incident Runbook

## First Five Minutes

- Name an incident owner and a communications owner.
- Confirm whether the issue is staging or production.
- Check Argo CD sync and Kubernetes rollout state.
- Check public `GET /health` and liveness `GET /health/live`.
- Inspect Grafana metrics, Prometheus alerts, and Loki logs.

## 1) API Availability Incident
- Check public `GET /health`.
- Check detailed `GET /health/ready` with the `x-health-token` header from the production readiness secret.
- Validate DB connectivity and queue status.
- Inspect request-id correlated error logs.
- Kubernetes:
  - `kubectl -n <namespace> rollout status deploy/aura-api`
  - `kubectl -n <namespace> logs deploy/aura-api --since=15m`
  - `kubectl -n <namespace> describe hpa aura-api`

## 2) OTP Delivery Incident
- Confirm provider credentials and gateway errors.
- Verify fail-closed behavior (`/api/otp/send` should return 503 on provider failure).
- Inspect `OtpSession` creation and expiry behavior.

## 3) Payment Capture Incident
- Check `PaymentOutboxTask` for pending/failed capture tasks.
- Requeue/retry via admin operations where needed.
- Verify intent/order state transitions and idempotency records.

## 4) Order Email Delivery Incident
- Query `/api/admin/order-emails` by status.
- Retry failed notifications with idempotency key.
- Verify terminal alert path to ops mailbox.

## 5) Security Incident
- Rotate exposed credentials immediately.
- Restrict CORS allowlist and verify admin-only route protection.
- Audit recent profile updates and privilege-related changes.
- Disable compromised deploys by reverting Git desired state and syncing Argo CD.
