# Incident Runbook

## 1) API Availability Incident
- Check `GET /health` and `GET /health/ready`.
- Validate DB connectivity and queue status.
- Inspect request-id correlated error logs.

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
