# Account and Profile Overhaul: Test Matrix

## Current foundation evidence

| Verification | Result |
|---|---|
| Account shell, profile orchestration, Security UI, active-session confirmations, auth API | **PASS**: 5 Vitest files, 58 tests |
| Browser-session inventory/service/controller/validators | **PASS**: 4 Jest suites, 30 tests |
| Secure avatar intent/upload/finalize, media normalization/storage/cleanup, policy and signatures | **PASS**: 7 Jest suites, 35 tests; 2 legacy profile suites, 12 tests |
| Avatar Account Center workflow and API client | **PASS**: 3 Vitest files, 45 tests |
| Marketplace Account Center hub and API client | **PASS**: 5 backend suites, 13 tests; 4 frontend files, 47 tests |
| Policy-gated privacy lifecycle framework | **PASS**: 6 backend suites, 18 tests; 3 frontend files, 47 tests; activation remains blocked |
| Account Center V2 additive migration and index contract | **PASS**: 4 Jest suites, 16 tests; no live database mutation performed |
| High-cardinality revoke-others | **PASS**: public list capped at 20; all 101 other sessions revoked; current and other-user sessions preserved |
| Sensitive-route enforcement | **PASS**: standard scanner and strict coverage for 98 route entries |
| Targeted frontend lint | **PASS with one pre-existing warning**: no errors; existing `currentUser.uid` dependency warning |
| Frontend accessibility/design hardening | **PASS at component/static level**: 5 focused Profile files / 11 tests; interface audit 0 high / 8 inspected heuristic medium / 2 intentional low |
| Frontend build and bundle budget | **PASS**: initial JS 175.97 kB gzip, total CSS 65.88 kB, initial payload 243.82 kB; Profile 16.91 kB gzip; all Account feature chunks <= 11.82 kB gzip |
| Account observability and analytics | **PASS at code/static level**: 7 backend suites / 23 tests; 5 frontend files / 13 tests; 10-panel dashboard and 8-alert contract parse and validate; live scrape/alert evidence pending |
| Account localization structure | **PASS**: extraction, pseudo-locale, compile, structural verify and QA across 21 catalogs / 4,891 messages / 0 critical issues; stable-text discovery guard PASS |
| Authenticated browser/E2E, real Redis failure/concurrency, full suites | **NOT VERIFIED** |

## Test levels

| Level | Purpose | Required tools |
|---|---|---|
| Unit | Validators, serializers, reducers/query helpers, policy decisions | Vitest/Jest |
| Component | Forms, lists, dialogs, state language, keyboard behavior | Vitest + Testing Library |
| API integration | Auth, ownership, concurrency, pagination, abuse cases | Jest/Supertest with MongoDB/Redis test services |
| Contract | Legacy and additive response compatibility | Schema fixtures and consumer tests |
| Browser | Real protected routes, responsive behavior, network/console, accessibility | Playwright/browser tooling |
| Migration | Mixed documents, dry-run, resume, rollback/read fallback | Migration harness |
| Release | Same-SHA health, smoke, metrics and rollback gates | Existing CI/CD workflows |

## Identity and authorization matrix

Every protected account read/mutation must cover:

| Actor | Expected |
|---|---|
| Unauthenticated | 401 without account discovery |
| Valid owner | Allowed subject to state/step-up |
| Different authenticated user | 404/403, no cross-user data or mutation |
| Suspended/deactivated user | Policy-specific denial; no sensitive mutation |
| Stale/expired session | Re-auth required |
| Malformed/expired bearer token | Fail closed |
| Cookie session without valid CSRF on mutation | Denied |
| Admin without required physical/fresh factor | Denied |
| Tampered resource ID/cursor | Denied without enumeration |

## Feature matrix

| Feature | Success | Validation/failure | Abuse/concurrency |
|---|---|---|---|
| Account summary | Full and partial response | Optional source failure; identity source failure | Include allowlist, payload bound, no secret fields |
| Profile | Read and allowed update | Bio/name/phone/DOB boundaries | Unknown fields rejected; phone proof; stale version |
| Avatar | Intent, upload, finalize, replacement | MIME, size, checksum, dimensions, scan failure | Arbitrary key/bucket/ACL, cross-user finalize, replay, orphan cleanup |
| Addresses | Add/edit/default/delete | Required fields, max count, duplicate/default repair | Cross-user ID, concurrent default updates |
| Orders | Search/filter/cursor/detail | Empty, stale cursor, upstream failure | Cross-user order, cursor tamper, action ineligible |
| Returns/refunds | Eligible lifecycle | Window closed, invalid reason | Price/amount tamper, duplicate command, race |
| Payments | List/add/default/remove | Provider challenge/failure | Cross-user method, OTP/step-up missing, replay |
| Notifications | Page/read/read-all | Empty, page failure | Cross-user IDs, oversized ID list |
| Preferences | Read/update | Unknown topic/channel | Mandatory notice disable, stale version conflict |
| Trusted devices | List/rename/revoke | Missing/current/final required factor | Cross-user ID, admin policy bypass |
| Active sessions | List/revoke one/others/all | Store unavailable, stale alias | Raw ID leakage, cross-user alias, preserve-current guarantee |
| Security activity | Cursor history | Empty/partial source | Redaction, event allowlist, other-user leakage |
| Listings/trade-ins/alerts/reviews | List/filter/actions | Empty/invalid state | Ownership, value/eligibility tamper |
| Support | Create/list/detail/message | Attachment/limit/provider failure | Cross-user ticket, file abuse, rate limits |
| Export | Request/status/download | Duplicate, expired, delivery failure | Fresh-auth, cross-user job, artifact URL expiry |
| Deactivation | Request/reactivate | Policy ineligible | Fresh-auth, session revocation, race |
| Deletion | Request/cancel/complete | Grace/hold conflicts | Re-auth, cross-user, retained-evidence policy, duplicate worker |

## UI state matrix

Each module must render and test:

- initial loading;
- refetch with prior data preserved;
- empty;
- local error and retry;
- validation error;
- mutation pending;
- mutation success adjacent to changed content;
- partial data;
- offline cached read;
- offline mutation blocked;
- session expired/re-auth;
- permission/policy denied;
- rate limited with safe retry timing.

## Accessibility matrix

- Semantic heading order and landmark names.
- Rail/mobile navigation with `aria-current`.
- Keyboard-only completion of every task.
- Visible focus and focus restoration.
- Dialog focus trap, escape policy, and return focus.
- Persistent labels, descriptions, required state, and field errors.
- Live-region behavior without duplicate announcements.
- Status not conveyed by color alone.
- Table/list alternatives on narrow widths.
- 200% zoom and 400% reflow.
- Reduced motion.
- Screen-reader spot checks in at least NVDA/Chrome on Windows.
- Automated axe checks with zero serious/critical violations.

## Responsive browser matrix

| Width | Required scenarios |
|---:|---|
| 320/375/390 | Account index, forms, address actions, filters, dialog, session rows |
| 768 | Tablet navigation and two-column collapse |
| 1024 | Rail/content balance and order rows |
| 1280/1440 | Primary desktop |
| 1920/2560 | Content max width, no stretched forms or sparse task controls |

Test touch/pointer and keyboard variants. Capture screenshots for default, loading, empty, error, destructive confirm, and at least one successful mutation.

## Performance matrix

- One account-summary request for first overview paint.
- No inactive-module requests.
- Aborted searches/navigation do not update stale UI.
- Cursor pages append without rerendering unrelated modules.
- Security reads do not trigger commerce reads.
- Bundle budgets record initial, account-shell, and per-module chunks separately.
- Long-list tests use realistic 20/50/100-row pages.
- React profiler verifies stable row renders during unrelated mutations.

## Migration matrix

- Old-only, new-only, and mixed user documents.
- Over-limit addresses without destructive normalization.
- Malformed avatar data.
- Repeat dry-run and repeat write run.
- Stop/resume from checkpoint.
- Quarantine path.
- Read fallback after flag rollback.

## Baseline evidence

Current focused tests:

- Wave F frontend security/settings/API: 60 passed.
- Wave F backend security activity/session validators/controllers: 13 passed.
- Wave G backend avatar pipeline, upload security, storage cleanup, signatures and traffic policy: 35 passed.
- Wave G backend legacy profile/avatar security compatibility: 12 passed.
- Wave G frontend profile, shell and API workflow: 45 passed.
- Wave G sensitive-route scanners: 98 route entries passed.
- Wave G localization: 21 catalogs, 4,838 ICU messages, zero critical structural issues; native review remains pending.
- Wave H owner-scoped marketplace hub, traffic policy, existing listing/review security, profile integration, wishlist context and API client: 13 backend and 47 frontend tests passed.
- Wave H localization: 21 catalogs, 4,860 ICU messages and zero critical structural issues; native review remains pending.
- Wave I policy activation, idempotency, owner scope, grace, cancellation, safe projection, worker lease/recovery, UI disabled/enabled states and API client: 18 backend and 47 frontend tests passed.
- Wave I localization/build: 21 catalogs, 4,883 ICU messages, zero critical structural issues, and a 2.46 kB gzip lazy privacy chunk; native review remains pending.
- Wave J additive migration audit/apply authorization, schema default, named indexes, bounded pause/resume/repair, failure quarantine, CLI parsing and redacted query-plan evidence: 4 backend suites and 16 tests passed.
- Wave J live database snapshot audit, index build, query explain, backup restore and apply rehearsal are not verified locally and remain staging gates.
- Waves K-L-M shell/offline/avatar dimensions, address-dialog focus lifecycle, notification semantics/actions/preferences and Profile integration: 5 frontend suites / 11 tests passed; lint passed.
- Waves K-L-M production build and bundle budget: 175.97 kB initial JS gzip, 65.88 kB total CSS, 60.44 kB initial CSS and 243.82 kB initial payload; Profile 16.91 kB gzip; largest Account feature chunk 11.82 kB gzip.
- Waves K-L-M localization: 21 catalogs, 4,883 ICU messages, zero critical issues and stable-text discovery guard passed; authenticated locale visual/accessibility QA and native review remain pending.
- Wave N typed client events, Web Vitals, strict server schemas, privacy-safe persistence/logging, bounded Prometheus metrics, migration progress, dashboard and alert contracts: 7 backend suites / 23 tests and 5 frontend files / 13 tests passed.
- Wave N operational static gates: both route scanners passed at 98 routes, observability assets validated, dashboard JSON and alert YAML parsed, 2,665-file secret scan passed, frontend lint passed, localization remained 21 catalogs / 4,883 messages / 0 critical issues, and the production bundle budget passed.
- PR gate repair refreshed the stable, reviewed, pseudo, compiled and legacy runtime catalogs to 4,891 ICU messages across 21 catalogs with zero critical mechanical issues and 100% structural coverage; all 19 non-source locales remain explicitly queued for native review.
- Wave N live Prometheus scrape, Grafana query rendering, Alertmanager delivery/resolution, log aggregation, cardinality, retention and real SLO calibration are not verified locally and remain staging gates.

Current broad local suites timed out and are not accepted as passes. Before merge, new focused shards must pass and the relevant CI suites must return terminal green statuses on the exact SHA.
