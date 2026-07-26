# Account and Profile Overhaul: Feature Inventory

Status definitions:

- **Implemented**: a usable frontend and server contract were found.
- **Partial**: meaningful capability exists but does not satisfy the overhaul brief.
- **Absent**: no customer implementation was found.
- **Misleading**: the current UI label or grouping overstates the underlying contract.

| Capability | Frontend | Backend/security | Status | Key evidence or gap |
|---|---|---|---|---|
| Protected account entry | `/profile` uses `ProtectedRoute` | Auth middleware required | Implemented | Live unauthenticated route redirects to sign-in |
| Account overview | Hero, metrics, quick actions | Dashboard aggregation endpoint | Partial | Expensive broad fan-out; some metrics are session/page scoped but presented as broad account intelligence |
| Personal details | Name, phone, DOB, gender, bio, avatar | Explicit field allowlist; fresh phone proof | Partial | Bio limits disagree between client validation and Mongoose schema |
| Avatar | Three-phase upload with progress, validation and durable preview | One-time owner-bound intent/finalize tokens; MIME/extension/magic-byte/size/dimension/decode/scan checks; normalized WebP quarantine, promotion and cleanup | Implemented on integration branch | Account Center writes randomized object media; legacy avatar reads remain for migration compatibility; staging S3/IAM proof remains a release gate |
| Addresses | Embedded CRUD | Owner-scoped user mutation | Partial | Placeholder-only form, no address cap, weak field-error semantics, browser-native delete confirmation |
| Order history | Embedded profile summary and dedicated orders page | Cursor-ready owner-scoped API | Partial | Client requests one page with limit 100, ignores `nextCursor`, lacks search/status/date filters |
| Order detail/actions | Timeline and command surfaces | Ownership and trust guards for sensitive commands | Partial | No invoice download route found; UX is split across account and orders destinations |
| Returns/refunds/replacements | Available through order commands | Server-side ownership/eligibility guards | Implemented | Must remain server-authoritative |
| Wishlist | Dedicated page plus bounded live-hydrated Account Center preview | User-scoped revisioned wishlist contract | Implemented | Full mutations remain in the existing dedicated workflow; Account Center links to it without duplicating authority |
| Rewards/loyalty | Rewards section | User rewards endpoint and embedded ledger | Partial | Ledger growth and independent pagination need review |
| Saved payments | Payment methods section | Auth, active-account, OTP/step-up, ownership guards | Partial | Destructive remove flow needs deliberate confirmation and accessible error recovery |
| Notifications inbox | Read/unread filtering and mark-read controls | User-scoped paginated endpoint | Partial | Client does not expose pagination/error states; rows are not consistently keyboard-semantic |
| Notification preferences | Local toggles in Settings | No durable per-channel preference contract found | Misleading | Toggling appears local-only and does not prove persisted cross-channel preferences |
| Password management | “Open Secure Recovery” | OTP-based recovery flow | Partial | No direct authenticated password-change flow; action signs out and redirects to recovery |
| Passkeys | Enrollment and removal controls | WebAuthn/passkey server enforcement | Implemented | Preserve final-factor and admin-policy protections |
| TOTP MFA | Setup and verification | MFA endpoints and step-up | Implemented | Preserve deployment flags and recent-auth gates |
| Recovery codes | Generate/download/verify | Hashed, single-use server codes | Implemented | One-time display semantics already present |
| Trusted devices | Rename/revoke/revoke-others | Customer/admin policy and device-scoped session revocation | Implemented | Must not be relabeled as complete active sessions |
| Active sessions | Dedicated inventory, refresh, revoke-one, revoke-others, and deliberate revoke-all controls | Owner-scoped opaque aliases, bounded projection, targeted revocation, fresh-MFA bulk revocation | Implemented | Public response excludes raw session, identity, network, fingerprint, cookie, token, and Redis material |
| Security activity | Bounded, retryable, cursor-paginated customer history | Owner filter, explicit event allowlist, safe three-field projection, signed owner-bound cursor, 180-day published-event retention | Implemented | Raw outbox records, identifiers, network data, provider payloads, and internal risk details are never returned |
| Linked sign-in providers | Microsoft/Apple linking controls | Firebase/session identity support | Partial | Needs unlink/recovery policy and tested last-provider protection |
| Seller listings | Bounded Account Center preview plus full management route | Owner-scoped listing APIs and account-hub projection | Implemented for supported capability | Full listing mutations remain behind existing seller and owner guards |
| Trade-ins | Bounded Account Center preview plus full workflow | Owner-scoped CRUD; server-computed valuation | Implemented for supported capability | Account hub never accepts or exposes client authority over valuation |
| Price alerts | Bounded Account Center preview plus full workflow | Owner-scoped alert API | Implemented for supported capability | Full create/delete actions remain in the dedicated route |
| Review management | Owner-scoped Account Center history preview linking to the real product review editor | Verified-purchase upsert, media validation and moderation-aware status | Implemented for supported capability | No fake inline moderation or delete UI was introduced; full pagination remains follow-up work |
| Support tickets | Large embedded support section | User-scoped paginated ticket APIs | Partial | Section is oversized; client fetch limits/history continuation need explicit UX |
| Privacy policy | Link to `/privacy` | Static policy/data inventory docs | Implemented | Policy display is not data-rights execution |
| Data export | Account Center control reflects real capability status | Fresh-MFA, idempotent owner job, worker lease and safe state contract | Policy-gated framework | Activation blocked until delivery, retention, jurisdiction, bucket/KMS and export-handler policy is approved |
| Deactivation | Exact-confirmation control and cancellation state | Fresh-MFA, owner job, cancellable state machine and audit event | Policy-gated framework | Active-order/dispute and reactivation handlers remain blocked on authoritative policy |
| Account deletion | Exact-confirmation grace-period control and cancellation state | Fresh-MFA, owner-bound async job, grace boundary, worker recovery and audit event | Policy-gated framework | Legal hold, retention, anonymization, provider/media cleanup and evidence handlers remain blocked on authoritative policy |
| Offline account UX | No deliberate offline account state found | N/A | Absent | Needs per-module stale/offline semantics |
| Responsive account shell | Horizontal pills and global style overrides | N/A | Partial | Authenticated visual audit blocked; code indicates overflow and density risks |
| Accessibility | Some labels, sections, live status patterns | N/A | Partial | Missing complete tabs semantics, focus treatment, field errors, keyboard rows |
| Account observability | Generic auth/security telemetry exists | Metrics and security outbox | Partial | No account-module latency/failure/adoption dashboard or rollout SLOs |
| Account feature flags | Deployment flags exist for auth/MFA | No unified account-overhaul flag contract found | Absent | Needed for progressive rollout and rollback |

## Preserve-worthy security behavior

- Server-side ownership on orders, listings, trade-ins, support, notifications, and payments.
- Explicit profile-field allowlisting.
- Fresh phone proof for phone mutations.
- Fail-closed avatar content validation.
- Redis-backed opaque sessions and targeted revocation primitives.
- MFA/passkey/recovery-code policy, including stronger admin requirements.
- Payment step-up and active-account checks.
- Sensitive-route coverage checks.

## Inventory limits

An authenticated browser session was not available, so visual state completeness, console errors, authenticated network waterfalls, keyboard traversal, and screen-reader behavior remain unverified. Those are acceptance gates, not assumed passes.
