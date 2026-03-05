# Security Model

## Identity and Access
- Firebase token verification happens in backend `protect` middleware.
- Admin surfaces require explicit `admin` middleware.
- Frontend role checks are UX hints only; backend is authoritative.

## Data Protection
- Input validation is enforced with Zod validators.
- Mongo and XSS sanitizers run globally.
- Sensitive secrets are environment-driven.

## OTP Security
- OTP state is persisted in `OtpSession` (TTL-based expiry on session docs).
- OTP send is fail-closed when provider delivery fails.
- OTP verify enforces attempts and lockouts.

## Payment Security
- Digital checkout requires backend-validated payment intent.
- Webhooks are signature-verified.
- Idempotency keys guard critical mutations.

## Email Security
- Unified gateway validates recipients, subject/body length, event type.
- Audit logs are redacted and request-id traceable.
