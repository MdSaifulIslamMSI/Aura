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

### Current state: implemented, deliberately disabled

The data-subject export and erasure surface is built, wired, and tested. It is **not
enabled**, by design. `server/config/accountPrivacyFlags.js` requires an explicit
policy approval plus a complete runtime contract, and reports
`blockedReason: authoritative_policy_or_runtime_contract_incomplete` otherwise. This
is the repo refusing to invent retention, grace, and jurisdiction policy — the same
rule stated above, applied to itself.

| Endpoint | Method | Gate |
| --- | --- | --- |
| `/api/account/privacy/capabilities` | GET | limiter |
| `/api/account/privacy/exports` | POST | CSRF + fresh MFA + zod |
| `/api/account/privacy/requests/:requestId` | GET | owner-scoped, zod |
| `/api/account/privacy/deactivation` | POST | CSRF + fresh MFA + zod |
| `/api/account/privacy/deactivation/:requestId` | DELETE | CSRF + fresh MFA + zod |
| `/api/account/privacy/deletion-requests` | POST | CSRF + fresh MFA + zod |
| `/api/account/privacy/deletion-requests/:requestId` | DELETE | CSRF + fresh MFA + zod |

Implementation: `server/controllers/accountPrivacyController.js`,
`server/services/accountPrivacyService.js`, `server/models/AccountPrivacyJob.js`,
`server/validators/accountPrivacyValidators.js`. Owner binding and the
`Idempotency-Key` requirement are asserted in
`server/tests/accountPrivacyController.test.js`; the activation contract in
`server/tests/accountPrivacyFlags.test.js`.

### Activation

All of the following must be set. Exports are written to S3 under
`AWS_S3_PRIVACY_BUCKET`, encrypted with `ACCOUNT_PRIVACY_EXPORT_KMS_KEY_ID`.

```sh
ACCOUNT_CENTER_V2_PRIVACY=true
ACCOUNT_PRIVACY_POLICY_APPROVED=true
ACCOUNT_PRIVACY_POLICY_VERSION=<approved version, e.g. policy-2026-07>
ACCOUNT_PRIVACY_JURISDICTIONS=IN
ACCOUNT_PRIVACY_EXPORT_RETENTION_DAYS=7
ACCOUNT_PRIVACY_DELETION_GRACE_DAYS=30
ACCOUNT_PRIVACY_REACTIVATION_POLICY=during-grace
ACCOUNT_PRIVACY_EXPORT_DELIVERY=authenticated-download
AWS_S3_PRIVACY_BUCKET=<bucket>
ACCOUNT_PRIVACY_EXPORT_KMS_KEY_ID=alias/<key>
```

These values are a legal and operational decision, not an engineering one. Do not set
`ACCOUNT_PRIVACY_POLICY_APPROVED=true` until retention windows, the deletion grace
period, and reactivation terms have been agreed and can be defended to a regulator.
Verify activation with `npm --prefix server test -- --runTestsByPath
tests/accountPrivacyFlags.test.js`.

## Remaining Work

- Record the approved jurisdiction/retention policy decision before setting the flags above.
- Add field-level retention owners to the inventory.
- Record production retention decisions in release evidence.
