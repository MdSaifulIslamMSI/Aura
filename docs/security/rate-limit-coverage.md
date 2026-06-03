# Rate Limit Coverage

`npm run security:traffic:rate-limits` checks dangerous route families:

- Login/session/recovery/device challenge.
- OTP send, verify, reset, and account check.
- Admin mutations and data exports.
- Payment intents, refunds, methods, and provider webhooks.
- Order mutations.
- Upload and review upload.
- Seller/listing mutations.
- AI chat, voice, sessions, and visual search.
- Search-heavy public catalog/listing routes.

High-risk user routes use scanner-recognized `express-rate-limit` where useful and Redis-backed `createDistributedRateLimit` for horizontal enforcement. Webhooks use provider-safe signature, replay, and idempotency evidence instead of user rate limits that could block legitimate provider retries.
