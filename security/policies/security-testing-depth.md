# Security Testing Depth Policy

Last updated: 2026-06-14

Scanner coverage is necessary but not enough. Security tests must exercise authorization, tenancy, business logic, uploads, egress, and abuse paths as regression tests.

The repo-specific negative-test design standard is `docs/security/negative-test-design-plan.md`.

## Core Negative-Test Rule

For every sensitive action, prove that the wrong actor, wrong auth, wrong resource, wrong state, wrong token/grant, wrong input, wrong sequence, replay, and race fail safely before dangerous code runs.

A passing negative test must assert more than the response status. It must verify the protected database state, external side effects, sensitive response data, and audit/security evidence that apply to that route.

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
| Side-effect safety | Denied requests leave DB/external provider/email/upload/token state unchanged | `expectDocumentUnchanged`, suite-specific spies/count assertions |
| Security observability | Blocked P0/P1 attempts are redacted and auditable | `npm run security:logging`, suite-specific audit assertions |

## Definition Of Done

- Every high-risk route has authz and validation tests.
- Security regression suite runs in CI.
- Fuzz findings create regression tests before closure.
- Business logic abuse cases are tracked in the threat model.
- Every new P0/P1 negative test asserts safe response, no dangerous side effect, no sensitive response leak, and audit/security evidence when applicable.
- Race and replay coverage is required whenever an action spends money, consumes a grant, changes ownership, changes stock, writes files, revokes sessions, or mutates admin state.
