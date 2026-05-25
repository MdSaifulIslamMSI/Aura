# Data Flow Map

Last updated: 2026-05-25

## PII Collected

| Data | Present? | Classification | Purpose | Storage | Access |
|---|---:|---|---|---|---|
| Name | Yes | Confidential | Account, checkout, support | MongoDB, emails, logs if redacted summary | User, support/admin |
| Email | Yes | Confidential | Auth, notifications, support, order email | MongoDB, email provider, audit events | User, support/admin |
| Phone | Yes | Confidential | OTP, delivery/contact, account recovery | MongoDB, SMS provider | User, support/admin |
| Address | Yes | Confidential | Order fulfillment | MongoDB/order records | User, fulfillment/admin |
| Payment metadata | Yes | Restricted | Payment intent, refunds, reconciliation | MongoDB, payment provider | User, payment/admin |
| Uploaded files | Yes | Confidential or Restricted | Reviews, avatars, listings, AI/media features | Object/local storage, provider payloads | Owner/admin/service |
| Device/IP data | Yes | Confidential | Auth risk, rate limits, audit, fraud prevention | Logs, Redis, MongoDB/security events | Security/admin |

## Data Classification

| Class | Examples | Control |
|---|---|---|
| Public | Public catalog and listing metadata | Integrity monitoring and abuse controls |
| Internal | Aggregated metrics, non-sensitive operational notes | Access controls and retention limits |
| Confidential | Contact data, addresses, device/IP signals, support context | Encryption, redaction, least privilege |
| Restricted | Payment-like metadata, secrets, admin actions, sensitive uploads | Field-level encryption or tokenization where feasible, audit logs, restricted access |

## Purpose

- Authentication: email, phone, device, IP, session state.
- Order processing: name, address, payment metadata, order records.
- Fraud prevention: IP, device signals, rate-limit and auth-risk events.
- Support: contact details, ticket history, attachments when enabled.
- Legal/compliance: audit logs, security events, retention records.

## Storage

- Database: user profile, order, payment, support, admin, status, security event data.
- Object storage/local uploads: review media, listing/profile media, assistant media where enabled.
- Logs: request IDs, route/status/duration, auth/upload/admin security events.
- Analytics: aggregated marketplace/status/security signals.
- Third parties: Firebase, Stripe/Razorpay, email/SMS providers, LiveKit, OpenAI/VoyageAI where features are enabled.

## Retention

| Category | Target Retention | Evidence Needed |
|---|---|---|
| User account | Until deletion request or legal retention need | Account deletion/export workflow proof |
| Uploads | Product/support lifetime or explicit deletion policy | Storage lifecycle config |
| Security logs | 90-365 days depending severity | SIEM/log retention config |
| Payment metadata | Per provider/legal requirements | Payment data retention policy |
| Backups | Daily 30 days, weekly immutable 90 days target | Backup provider evidence |

## DLP And Tokenization

| Control | Requirement | Evidence Needed |
|---|---|---|
| PII detection | Scan logs, support exports, uploads, and CI artifacts for accidental PII/secrets | DLP scan report |
| Redaction | Redact tokens, passwords, cookies, OTPs, API keys, private keys, and payment details | Logging redaction tests |
| Field-level encryption | Use for restricted fields where platform support exists | Schema/config review |
| Tokenization | Prefer provider tokens for payment-like data and secrets instead of raw values | Provider config and code review |
| Sensitive-read audit | Log privileged reads of restricted data | `db.sensitive_read` events |

## User Rights

- Export: Document endpoint/admin process and evidence package.
- Delete: Soft-delete plus retention/legal hold workflow.
- Correction: User profile edit and support/admin correction path.
- Access restriction: Admin/support process for compromised or disputed accounts.

## Evidence Gaps

- Attach export/delete workflow proof.
- Attach DLP test evidence.
- Identify restricted fields that still need field-level encryption or tokenization review.
