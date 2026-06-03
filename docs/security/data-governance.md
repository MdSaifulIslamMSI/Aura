# Data Governance

## Data Inventory

| Category | Examples | Boundary | Current Control |
| --- | --- | --- | --- |
| Identity | email, phone, Firebase UID, passkey metadata | Firebase and MongoDB | auth middleware, redacted logs, security telemetry |
| Commerce | orders, carts, listings, reviews | MongoDB | owner/admin checks, business-logic tests |
| Payment | payment intents, refund state, provider IDs | Aura plus Stripe/Razorpay | provider webhooks, payment guards, no card storage in Aura |
| Uploads | review media, profile avatars | upload pipeline/storage | MIME, magic-byte, malware-scan hooks, upload telemetry |
| Audit | request IDs, actor IDs, reason codes | logs/outbox | bounded event names, redaction, minimized IP/user-agent |
| AI | prompts, assistant context, media references | model providers and Aura services | provider adapters, tool registry, rate limits |

## Developer Logging Rules

- Do not log passwords, OTPs, cookies, raw Authorization headers, session tokens, API keys, webhook secrets, card data, raw upload content, or private keys.
- Use bounded reason codes rather than free-form sensitive strings.
- Prefer request IDs, actor IDs, resource types, and safe resource IDs over raw payloads.
- Hash or truncate IP/user-agent data when operationally acceptable.

## Export And Delete

Data export and delete routes should require owner authorization or admin authorization with recent auth and WebAuthn step-up for critical mutations. If a route does not yet exist, do not add a stub that implies compliance; add explicit acceptance criteria and tests before launch.

## Remaining Work

- Add field-level retention owners to the inventory.
- Add data export/delete route tests when those routes are implemented or hardened.
- Record production retention decisions in release evidence.
