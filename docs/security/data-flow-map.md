# Data Flow Map

Last updated: 2026-05-25

## PII Collected

| Data | Present? | Purpose | Storage | Access |
|---|---:|---|---|---|
| Name | Yes | Account, checkout, support | MongoDB, emails, logs if redacted summary | User, support/admin |
| Email | Yes | Auth, notifications, support, order email | MongoDB, email provider, audit events | User, support/admin |
| Phone | Yes | OTP, delivery/contact, account recovery | MongoDB, SMS provider | User, support/admin |
| Address | Yes | Order fulfillment | MongoDB/order records | User, fulfillment/admin |
| Payment metadata | Yes | Payment intent, refunds, reconciliation | MongoDB, payment provider | User, payment/admin |
| Uploaded files | Yes | Reviews, avatars, listings, AI/media features | Object/local storage, provider payloads | Owner/admin/service |
| Device/IP data | Yes | Auth risk, rate limits, audit, fraud prevention | Logs, Redis, MongoDB/security events | Security/admin |

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

## User Rights

- Export: Document endpoint/admin process and evidence package.
- Delete: Soft-delete plus retention/legal hold workflow.
- Correction: User profile edit and support/admin correction path.
- Access restriction: Admin/support process for compromised or disputed accounts.
