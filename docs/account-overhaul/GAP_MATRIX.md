# Account and Profile Overhaul: Gap Matrix

Priority definitions:

- **P0**: security, privacy, data integrity, rollout, or truthful-product blocker.
- **P1**: required functional or architectural gap for the account overhaul.
- **P2**: polish or optimization that should follow the safe core.

| ID | Priority | Area | Current gap | Required outcome | Acceptance evidence |
|---|---|---|---|---|---|
| G-001 | P0 | Source/release integrity | Local SHA differs from observed live SHA | Reconcile target branch and bind all evidence to one release SHA | Clean target diff, CI SHA, release markers |
| G-002 | P0 | Privacy | Technical framework resolved on integration branch; activation remains intentionally blocked because authoritative jurisdiction, retention, legal-hold, reactivation and delivery policy is unavailable | Preserve fresh-MFA, idempotent owner jobs, grace/cancellation, safe worker recovery and fail-closed activation; install handlers only after policy approval | Disabled/enabled flag tests, owner/idempotency/grace/cancel/worker tests, then policy review and staging lifecycle rehearsal |
| G-003 | P0 | Session security | Resolved on integration branch: trusted credentials and active sessions are separate, with revoke-one/others/all controls | Preserve the separation and fresh-MFA bulk revocation | List/current/revoke-one/revoke-others/revoke-all tests; cross-user denial |
| G-004 | P0 | Rollout | No account-specific feature flag, SLO, or rollback plan | Progressive, observable release with server/client compatibility | Flag tests, dashboards, rollback rehearsal |
| G-005 | P0 | Verification | Authenticated account UI cannot be reproduced in the controlled browser | Deterministic test account or fixture | Desktop/tablet/mobile screenshots and network/console logs |
| G-006 | P0 | Dependency risk | Audit reports high-severity dependency findings | Review paths, upgrade only scoped packages, verify regressions | Triage record and clean/accepted audit gate |
| G-007 | P1 | Local workflow | `npm run dev:on` references a missing script | Restore a supported local start/stop workflow | Doctor check and clean shutdown |
| G-008 | P1 | Frontend architecture | 1,408-line profile orchestrator and oversized child sections | Route/module shell with isolated queries and commands | Component boundaries, focused tests, smaller route chunks |
| G-009 | P1 | Data fetching | Mount and 45-second refresh fan out across inactive modules | Fetch by active module, dedupe, cancel stale requests, explicit freshness | Network trace and query-cache tests |
| G-010 | P1 | Account navigation | Ten horizontal pills and scattered marketplace routes | Responsive account shell with desktop rail and mobile hierarchy | 320–2560 px screenshots and keyboard traversal |
| G-011 | P1 | Profile contract | Client bio max and schema max disagree | One shared, server-authoritative constraint | Boundary tests at max and max+1 |
| G-012 | P1 | Avatar storage | Resolved on integration branch: Account Center writes normalized object media through replay-resistant owner-bound upload/finalize tokens | Preserve randomized key allowlist, quarantine, optimistic finalize, old-object deletion and legacy read fallback | MIME/extension/magic-byte/size/dimension/decode/scan, tamper, replay, ownership, conflict and orphan-cleanup tests |
| G-013 | P1 | Addresses | No cap, weak form semantics, native confirmation | Accessible validated CRUD, maximum count, deliberate destructive dialog | Field, cap, default, cross-user and keyboard tests |
| G-014 | P1 | Orders | Client ignores cursor continuation and lacks filters | Cursor pagination, search/status/date filters and stable empty/error states | Multi-page and stale-cursor tests |
| G-015 | P1 | Orders | No invoice download capability found | Owner-scoped signed invoice/download contract where legally supported | Ownership, expiry, content-disposition tests |
| G-016 | P1 | Notifications | Client hides server pagination and errors | Paginated inbox with accessible row actions and retry | Keyboard, unread count, multi-page, failure tests |
| G-017 | P1 | Preferences | Settings notification toggles are not shown to persist | Durable per-channel/topic preferences with server allowlist | Read/update/concurrency and cross-device tests |
| G-018 | P1 | Security activity | Resolved on integration branch: customer-safe allowlisted projection with signed owner-bound cursor | Preserve redaction, retention, and subject binding | PII-redaction, cursor-tamper, and ownership tests |
| G-019 | P1 | Password/provider UX | Recovery substitutes for password change; provider lifecycle incomplete | Authenticated change/recovery distinction and last-factor guard | Step-up, revoke sessions, last-provider tests |
| G-020 | P1 | Marketplace account | Resolved for repository-supported domains on the integration branch: saved items, reviews, listings, trade-ins and price alerts share one bounded Account Center hub and link into their real workflows | Preserve owner-only projections and server authority for ownership, valuation, eligibility and moderation | Account hub routing/projection/owner-denial tests plus existing listing and review security suites; full-history pagination remains on dedicated routes |
| G-021 | P1 | Support | Support section is a 93 kB mixed responsibility surface | Ticket list/detail/create modules with bounded history | Pagination and attachment/ownership tests |
| G-022 | P1 | Accessibility | Incomplete tabs, focus, labels, row semantics, field errors | WCAG 2.2 AA interaction and status semantics | axe, keyboard, SR spot checks, zoom/reflow |
| G-023 | P1 | Styling | Global CSS remaps legacy light components | Account-scoped tokens and components without broad selector overrides | Visual regression and stylesheet ownership review |
| G-024 | P1 | Test signal | Full suites exceed 10–15 minute local bounds | Deterministic shards with reportable exits | CI timing budget and no orphan children |
| G-025 | P2 | Performance | Profile route and total lazy payload are large | Module-level code splitting and render isolation | Bundle diff, interaction trace, request budget |
| G-026 | P2 | Offline UX | No deliberate stale/offline states | Read-only cached state with clear retry and mutation blocking | Offline browser test |
| G-027 | P2 | Localization | Large account copy is spread across components | Stable message catalog with locale fallbacks | Key discovery and representative locale tests |
| G-028 | P1 | Database migration | Resolved on integration branch: Account Center schema versioning, owner-history indexes and resumable evidence tooling are additive and fail-closed | Preserve count-only audit, explicit apply authorization, bounded checkpoints, safe failure quarantine and redacted explain evidence | Four focused suites / 16 tests; staging snapshot audit, index build, backup/restore, repair-pass and query-plan rehearsal |

## Implementation order implied by risk

1. Reconcile source, verification harness, requirements, and rollout contracts.
2. Build the account shell and query boundaries without changing security semantics.
3. Migrate existing profile, address, order, payment, notification, support, and marketplace features.
4. Add active sessions and redacted security activity on top of existing primitives.
5. Add privacy lifecycle workflows only after retention and legal requirements are confirmed.
6. Optimize bundles and refine visual polish after behavior and abuse tests pass.

## No-go gates

- Do not expose raw `SecurityEvent` or auth outbox records to customers.
- Do not treat a trusted device as proof of an active session or as MFA unless the existing server policy does.
- Do not accept client-provided user IDs, ownership, roles, prices, account state, or deletion eligibility.
- Do not hard-delete legally retained payment, tax, fraud, or security evidence.
- Do not release if this branch diverges from the reviewed target SHA or required target-branch checks are incomplete.
- Do not claim authenticated browser, accessibility, performance, or production validation until it is observed.
