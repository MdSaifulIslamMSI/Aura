# Security Testing Depth Policy

Last updated: 2026-05-25

Scanner coverage is necessary but not enough. Security tests must exercise authorization, tenancy, business logic, uploads, egress, and abuse paths as regression tests.

## Required Test Families

| Family | Coverage | Command Or Evidence |
|---|---|---|
| Auth bypass | Expired, tampered, missing, revoked tokens | `npm run security:auth`, `npm run security:tokens` |
| Tenant isolation | IDOR and cross-tenant reads/writes | `npm run security:idor` |
| Permission matrix | Admin/user/service roles by sensitive action | `npm run security:access-control` |
| Upload bypass | MIME spoof, magic mismatch, oversize, malware, executable | `npm run security:malware-runtime` |
| SSRF and egress | Metadata IP, private IP, redirect-to-private, allowlist | Egress tests and Semgrep |
| Webhook abuse | Invalid signature, old timestamp, replayed event | `npm run security:webhooks` |
| Abuse logic | Password spraying, signup abuse, OTP abuse, checkout/payment invariants | `npm run security:rate-limit`, `npm run security:business-logic` |
| API fuzzing | Malformed JSON, boundary values, unexpected operators | Scheduled fuzz report |

## Definition Of Done

- Every high-risk route has authz and validation tests.
- Security regression suite runs in CI.
- Fuzz findings create regression tests before closure.
- Business logic abuse cases are tracked in the threat model.
