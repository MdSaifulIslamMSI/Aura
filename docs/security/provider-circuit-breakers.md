# Provider Circuit Breakers

Provider dependency risk is tracked for:

- Stripe
- Razorpay
- Resend
- Firebase Admin/Auth
- MongoDB
- Redis
- AI providers
- Object storage
- LiveKit

Each provider needs timeout, retry budget, fallback/degraded behavior, idempotency where writes are possible, audit events on failure, user-safe errors, and cost guardrails. Where code-level circuit breakers are not yet safe to add without changing provider behavior, this document records the readiness gap and the aggregate checker reports warning rather than hiding the risk.

Payment, email, auth, and webhook behavior must not be broken by circuit-breaker changes. Blocking mode must be introduced only after staging verification.
