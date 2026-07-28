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
| G-004 | P0 | Rollout | Account-specific dashboard, alert defaults and a Wave N rollback boundary now exist; rollout flag, live SLO calibration and rehearsal remain unresolved | Progressive, observable release with server/client compatibility | Flag tests, staging dashboard/alert proof, rollback rehearsal |
| G-005 | P0 | Verification | Authenticated account UI cannot be reproduced in the controlled browser | Deterministic test account or fixture | Desktop/tablet/mobile screenshots and network/console logs |
| G-006 | P0 | Dependency risk | Audit reports high-severity dependency findings | Review paths, upgrade only scoped packages, verify regressions | Triage record and clean/accepted audit gate |
| G-007 | P1 | Local workflow | `npm run dev:on` references a missing script | Restore a supported local start/stop workflow | Doctor check and clean shutdown |
| G-008 | P1 | Frontend architecture | 1,408-line profile orchestrator and oversized child sections | Route/module shell with isolated queries and commands | Component boundaries, focused tests, smaller route chunks |
| G-009 | P1 | Data fetching | Mount and 45-second refresh fan out across inactive modules | Fetch by active module, dedupe, cancel stale requests, explicit freshness | Network trace and query-cache tests |
| G-010 | P1 | Account navigation | Responsive rail/mobile shell is implemented; authenticated visual proof remains unavailable | Preserve desktop rail, mobile hierarchy, deep links, current-page semantics and route-heading focus | 320–2560 px screenshots and keyboard traversal |
| G-011 | P1 | Profile contract | Client bio max and schema max disagree | One shared, server-authoritative constraint | Boundary tests at max and max+1 |
| G-012 | P1 | Avatar storage | Resolved on integration branch: Account Center writes normalized object media through replay-resistant owner-bound upload/finalize tokens | Preserve randomized key allowlist, quarantine, optimistic finalize, old-object deletion and legacy read fallback | MIME/extension/magic-byte/size/dimension/decode/scan, tamper, replay, ownership, conflict and orphan-cleanup tests |
| G-013 | P1 | Addresses | Validated CRUD/cap and deliberate accessible destructive dialog are implemented; authenticated browser proof remains | Preserve persistent labels, maximum count, server ownership/default enforcement, safe initial focus, Tab/Escape and focus return | Field, cap, default, cross-user and keyboard tests |
| G-014 | P1 | Orders | Client ignores cursor continuation and lacks filters | Cursor pagination, search/status/date filters and stable empty/error states | Multi-page and stale-cursor tests |
| G-015 | P1 | Orders | No invoice download capability found | Owner-scoped signed invoice/download contract where legally supported | Ownership, expiry, content-disposition tests |
| G-016 | P1 | Notifications | Client hides server pagination and errors | Paginated inbox with accessible row actions and retry | Keyboard, unread count, multi-page, failure tests |
| G-017 | P1 | Preferences | Settings notification toggles are not shown to persist | Durable per-channel/topic preferences with server allowlist | Read/update/concurrency and cross-device tests |
| G-018 | P1 | Security activity | Resolved on integration branch: customer-safe allowlisted projection with signed owner-bound cursor | Preserve redaction, retention, and subject binding | PII-redaction, cursor-tamper, and ownership tests |
| G-019 | P1 | Password/provider UX | Recovery substitutes for password change; provider lifecycle incomplete | Authenticated change/recovery distinction and last-factor guard | Step-up, revoke sessions, last-provider tests |
| G-020 | P1 | Marketplace account | Resolved for repository-supported domains on the integration branch: saved items, reviews, listings, trade-ins and price alerts share one bounded Account Center hub and link into their real workflows | Preserve owner-only projections and server authority for ownership, valuation, eligibility and moderation | Account hub routing/projection/owner-denial tests plus existing listing and review security suites; full-history pagination remains on dedicated routes |
| G-021 | P1 | Support | Support section is a 93 kB mixed responsibility surface | Ticket list/detail/create modules with bounded history | Pagination and attachment/ownership tests |
| G-022 | P1 | Accessibility | Code-level shell, heading, focus, dialog, notification-row, status, motion and reflow hardening is complete; authenticated certification is still blocked | Preserve WCAG 2.2 AA interaction and status semantics and collect real-route evidence | Component tests pass; axe, keyboard, SR spot checks, contrast and zoom/reflow remain release gates |
| G-023 | P1 | Styling | Account-scoped Tactile Minimal tokens replace the broad legacy profile remapping; authenticated visual evidence remains | Preserve account ownership without changing checkout/global behavior | Static audit 0 high / 8 heuristic medium / 2 intentional low; visual regression pending |
| G-024 | P1 | Test signal | Full suites exceed 10–15 minute local bounds | Deterministic shards with reportable exits | CI timing budget and no orphan children |
| G-025 | P2 | Performance | Secondary module splitting is implemented and Profile is 16.91 kB gzip; authenticated runtime behavior is unmeasured | Preserve module-level splitting/error isolation and validate request/render behavior | Bundle budget PASS; interaction trace and request budget remain staging gates |
| G-026 | P2 | Offline UX | No deliberate stale/offline states | Read-only cached state with clear retry and mutation blocking | Offline browser test |
| G-027 | P2 | Localization | Stable ICU ownership and 21-catalog structural coverage are implemented; 19 locale rows await native review | Preserve same-wave extraction, pseudo, compile, verify, QA and stable-text discovery | 4,891 messages / 0 critical issues / discovery guard PASS; representative browser locales and native review pending |
| G-028 | P1 | Database migration | Resolved on integration branch: Account Center schema versioning, owner-history indexes and resumable evidence tooling are additive and fail-closed | Preserve count-only audit, explicit apply authorization, bounded checkpoints, safe failure quarantine and redacted explain evidence | Four focused suites / 16 tests; staging snapshot audit, index build, backup/restore, repair-pass and query-plan rehearsal |
| G-029 | P0 | Observability/privacy | Resolved at code/static level: Account product events use strict schemas and bounded dimensions; generic diagnostics hash raw security identifiers and minimize URLs/user agents; server operations, privacy jobs and migrations expose bounded metrics | Preserve fail-open user behavior, client-untrusted semantics, no raw security identifiers and bounded metric cardinality | 7 backend suites / 23 tests; dashboard/alerts parse and asset validator PASS; live staging scrape, alert delivery, retention and SLO calibration pending |

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
