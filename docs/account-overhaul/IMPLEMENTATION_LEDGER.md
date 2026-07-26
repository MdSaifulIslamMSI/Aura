# Account Center Complete Program: Implementation Ledger

This is the live evidence ledger for the unified Account Center program. A wave is complete only when its implementation, focused tests, localization checks, migration evidence where applicable, and rollback boundary are recorded here.

## Program identity

| Item | Value |
|---|---|
| Integration branch | `codex/account-center-complete` |
| Foundation base | `4c7cd5549aaf689cd987570d4a1daa4de879680d` |
| Foundation PR | `#368` (merged) |
| Umbrella PR | Pending |
| Production authorization | Conditionally granted for the final gated rollout only |
| User-owned no-go path | `tmp/` |

Production authorization does not waive staging, security, accessibility, performance, migration, observability, rollback, branch-protection, or exact-SHA gates.

## Foundation revalidation

Revalidated on 2026-07-26 from the exact merged foundation:

| Verification | Result |
|---|---|
| PR #368 check rollup | PASS: 79 terminal checks, 0 pending, 0 failed |
| Main merge-triggered workflows | PASS: 18 terminal workflows, 0 failed |
| Account Center frontend tests | PASS: 5 files, 58 tests |
| Browser-session backend tests | PASS: 4 suites, 30 tests |
| Strict sensitive-route coverage | PASS: 97 routes |
| Repository secret scan | PASS: 2,594 files |
| Development environment contract | PASS; live staging URLs are not configured locally |
| Auth environment contract | PASS |
| Production frontend build and bundle budget | PASS: 175.73 kB initial JS gzip, 65.73 kB total CSS, 243.43 kB initial payload gzip |
| Frontend lint | PASS |
| Localization backend policy tests | PASS: 18 tests |
| Localization frontend tests | PASS: 37 tests |
| Localization structural coverage | PASS: 21 catalogs, 4,733 ICU messages, 100% key coverage, 0 structural blockers |
| Native-language final review | BLOCKED: 19 locale rows have a pre-existing human-review backlog |

The active-session response is an exact allowlist containing only opaque alias, current flag, client family, OS family, and timestamps. Regression coverage rejects raw session IDs, identity fields, user agents, IP addresses, cookies, device fingerprints, Redis key material, and authentication details.

## Wave ledger

| Wave | Product domain | Status | Commit | Verification |
|---|---|---|---|---|
| Foundation | Shell, scoped loading, active sessions, security separation | Complete | `5c9f92b9` | Baseline evidence above; documentation reconciled and the seven-field safe session projection is regression-locked |
| A | Account overview and profile | Complete | `account: add profile and account overview domain` | Backend: 9 focused suites / 33 tests; frontend: 5 focused files / 51 tests; lint PASS; strict route inventory PASS (97); i18n policy 55 tests PASS; 21 catalogs / 4,742 ICU messages / 0 mechanical blockers; native review remains separately blocked |
| B | Address management | Complete | `account: add address management` | Backend: 3 focused suites / 20 tests including cross-user IDOR; frontend: 2 files / 3 tests; lint PASS; 21-catalog extraction, pseudo-locale, compile, structural verify and QA PASS at 4,746 ICU messages |
| C | Preferences and notifications | Complete | `account: add preferences and notifications` | Backend: 2 suites / 6 tests; frontend: 2 files / 15 tests; lint and strict route coverage PASS; 21-catalog extraction, pseudo-locale, compile, structural verify and QA PASS at 4,764 ICU messages |
| D | Orders and post-purchase | Complete | `account: modernize orders returns and buy-again` | Owner-scoped 20-row cursor pages; strict order/payment ID, status, and date filters; stable loaded/empty/error/load-more states; owner-scoped no-store receipt. Backend: 4 new tests plus 17 existing order route/security/IDOR tests PASS; frontend: 3 tests PASS; lint PASS |
| E | Returns, exchanges, refunds, receipts, buy-again | Complete in current legal scope | `account: modernize orders returns and buy-again` | Existing server-authoritative cancellation/refund/replacement/support/warranty flows preserved; Buy Again reconstructs product IDs and quantities only from owned order rows, requires CSRF and idempotency, and never accepts client price. Strict route matrix PASS at 98 entries; 21-catalog structural localization PASS at 4,788 ICU messages. Legal tax-invoice issuance remains outside the configured policy scope; the implemented artifact is explicitly a receipt |
| F | Complete Security Center | Pending | Pending | Pending |
| G | Avatar media pipeline | Pending | Pending | Pending |
| H | Saved items, reviews, marketplace activity | Pending | Pending | Pending |
| I | Privacy and account lifecycle | Policy-gated | Pending | Jurisdiction, retention, legal-hold, grace, reactivation, and delivery policy still require authoritative approval |
| J | Database modernization and migrations | Pending | Pending | Pending |
| K | Frontend design completion | Pending | Pending | Pending |
| L | WCAG 2.2 AA completion | Pending | Pending | Pending |
| M | Performance and scalability | Pending | Pending | Pending |
| N | Observability and analytics | Pending | Pending | Pending |
| Release | Full CI, staging, rollback, production rollout and live proof | Pending | Pending | Pending |

## Commit ledger

Each completed wave receives an independently reviewable commit with its own test evidence:

1. `account: preserve and verify foundation`
2. `account: add profile and account overview domain`
3. `account: add address management`
4. `account: add preferences and notifications`
5. `account: modernize order history and order details`
6. `account: add returns refunds invoices and buy-again`
7. `account: add security activity and session controls`
8. `account: add secure avatar media pipeline`
9. `account: add saved items reviews and marketplace activity`
10. `account: add privacy export and account lifecycle`
11. `account: add database migrations and indexes`
12. `account: complete accessibility and performance hardening`
13. `account: complete observability and analytics`
14. `account: complete staging and release preparation`
15. `account: complete production rollout and verification`

## Localization rule

Every user-visible Account Center string is introduced through the stable ICU message layer in the same wave commit. Each wave must pass extraction, pseudo-locale generation, structural verification, locale QA, stable-text discovery, and focused localized UI tests. Human/native review status is recorded separately and is never inferred from generated translation coverage.
