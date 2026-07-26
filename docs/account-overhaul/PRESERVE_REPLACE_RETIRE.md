# Account and Profile Overhaul: Preserve, Replace, Retire

This decision log freezes the audit outcome before application-code implementation.

## Preserve

| Surface | Decision | Reason |
|---|---|---|
| Protected account routes | Preserve | Correct route-level authentication boundary |
| Firebase identity and server session exchange | Preserve | Existing multi-step identity contract |
| Redis opaque browser sessions | Preserve | Server-controlled session state and bounded revocation primitives |
| Passkey, TOTP, recovery-code and admin assurance rules | Preserve | Security-critical, tested behavior |
| Separate customer/admin trusted-device policy | Preserve | Prevents remembered browsers from weakening privileged MFA |
| Profile mutation allowlist and fresh phone proof | Preserve | Server-authoritative field and identity control |
| Ownership guards on commerce domains | Preserve | Required anti-IDOR boundary |
| Payment step-up and active-account guards | Preserve | Value-sensitive server enforcement |
| Existing domain route families | Preserve and formalize | A modular monolith is appropriate; service extraction is not justified |
| Production confirmation and rollback workflows | Preserve | Safe release boundary |

## Replace incrementally

| Surface | Replacement direction | Compatibility rule |
|---|---|---|
| `Profile/index.jsx` orchestration | Account shell plus feature modules and per-module queries | Keep legacy route working until module parity tests pass |
| Horizontal ten-pill navigation | Desktop rail and mobile account hierarchy | Preserve deep links and browser history |
| Eager page fan-out | Active-module loading, caching, cancellation, invalidation | Do not weaken fresh security checks |
| Global profile theme remaps | Account-scoped tokens and primitives | Avoid unrelated global restyling |
| Embedded base64 avatar | Signed object-storage upload/finalize/delete flow | Read legacy avatars during migration |
| Browser-native destructive confirmations | Accessible, deliberate confirmation dialogs | Server remains final authorization boundary |
| One-page order history | Cursor-based history and filters | Accept existing response shape during transition |
| Local notification toggles | Durable versioned preference API | Default safely when fields are absent |
| Trusted-device “session” copy | Separate trusted-device and active-session views | Never reinterpret stored credentials |
| Oversized support/settings sections | Cohesive submodules | Preserve all existing actions and policy checks |

## Retire after evidence

| Surface | Retirement gate |
|---|---|
| Global selectors that translate legacy light profile markup | All account modules use scoped primitives and visual regression passes |
| Broad 45-second account refresh | Query freshness and mutation invalidation tests pass |
| Misleading lifetime/session-total labels | Server contract and UX copy are source-accurate |
| Local-only preference toggles | Durable preference read/update is live and migrated |
| Base64 avatar writes | Object storage rollout completes and legacy-read migration is verified |
| Duplicate embedded/dedicated order experiences | Unified IA and deep-link compatibility are verified |
| Any client-supplied identity or ownership fields | Server derives subject and ownership exclusively |

## Explicitly not selected

- A microservice rewrite.
- A new authentication provider.
- Weakening OTP, passkey, trusted-device, or admin requirements for convenience.
- Automatic dependency audit fixes.
- A one-shot production replacement.
- A visual mock that bypasses the real API and state contracts.

## Decision review gates

These decisions must be revisited if target-branch reconciliation reveals newer account architecture, if legal retention requirements differ from the documented inventory, or if authenticated browser evidence contradicts the static audit.
