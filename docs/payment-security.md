# Payment Security

Implemented foundation protections:

- Raw PAN/card number/CVV/CVC/magnetic stripe fields are rejected by architecture payload guards.
- Provider mutations require idempotency keys.
- Webhooks require provider signature verification before parsing.
- Mock provider records duplicate webhook event ids safely.
- Live mode env validation fails closed if required payment secrets are missing.
- Observability helpers redact tokens, API keys, secrets, and authorization values.
- Policy helpers enforce ownership, refund permission, high-value refund approval, and verified webhooks.
- Ledger transactions are balanced and immutable; corrections must be reversing entries.

Non-goals for this increment:

- No live money movement is enabled.
- No hosted checkout is swapped into production routes.
- No raw card collection is introduced.
- No production deployment is triggered.

Future hardening:

- Wire the provider contract into existing payment routes behind a feature flag.
- Add persisted idempotency and webhook dedupe records for Hyperswitch events.
- Add SAST rules for forbidden card-data field names at API boundaries.
- Add a dedicated payment rate-limit policy for new Hyperswitch routes.
