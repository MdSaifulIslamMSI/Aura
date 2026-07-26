# Account and Profile Overhaul: Test Matrix

## Current foundation evidence

| Verification | Result |
|---|---|
| Account shell, profile orchestration, Security UI, active-session confirmations, auth API | **PASS**: 5 Vitest files, 58 tests |
| Browser-session inventory/service/controller/validators | **PASS**: 4 Jest suites, 30 tests |
| Secure avatar intent/upload/finalize, media normalization/storage/cleanup, policy and signatures | **PASS**: 7 Jest suites, 35 tests; 2 legacy profile suites, 12 tests |
| Avatar Account Center workflow and API client | **PASS**: 3 Vitest files, 45 tests |
| High-cardinality revoke-others | **PASS**: public list capped at 20; all 101 other sessions revoked; current and other-user sessions preserved |
| Sensitive-route enforcement | **PASS**: standard scanner and strict coverage for 98 route entries |
| Targeted frontend lint | **PASS with one pre-existing warning**: no errors; existing `currentUser.uid` dependency warning |
| Frontend build and bundle budget | **PASS**: initial JS 175.72 kB gzip, total CSS 65.73 kB, initial payload 243.42 kB |
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

Current broad local suites timed out and are not accepted as passes. Before merge, new focused shards must pass and the relevant CI suites must return terminal green statuses on the exact SHA.
