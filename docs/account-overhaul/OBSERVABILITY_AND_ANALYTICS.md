# Account Center Observability and Analytics

## Scope and trust model

Wave N adds a privacy-safe Account Center signal layer without making client
telemetry authoritative. Browser product events and Core Web Vitals are
directional signals: clients can omit, replay, delay, or fabricate them.
Server-side operation outcomes, HTTP metrics, privacy-worker transitions and
migration evidence remain the operational sources of truth.

No event grants authority, changes ownership, supplies a price, proves
authentication, or decides eligibility. Telemetry failures never block an
Account Center user action.

## Signal matrix

| Requirement | Signal | Source and status |
|---|---|---|
| Route/API latency and errors | `aura_http_request_duration_seconds`, `aura_http_requests_total`, `aura_http_errors_total` | Existing server middleware; dynamic IDs are normalized |
| Account mutation latency/outcome | `aura_account_operation_duration_seconds`, `aura_account_operations_total` | New bounded middleware on privacy, preference, avatar and session operations |
| Database latency | `db_query_duration_seconds` | Existing instrumented-call-site histogram; staging must confirm Account query coverage |
| Cache behavior | `cache_hits_total`, `cache_misses_total`, `cache_bypass_total`, `cache_errors_total` | Existing cache layer |
| Rate limits/backpressure | `aura_traffic_budget_denied_total` and existing structured traffic logs | Existing traffic policy |
| Upload failures | `aura_upload_security_events_total` plus Account avatar operation outcomes | Existing upload security telemetry plus new Account operation metrics |
| Session revocation failures | `aura_account_operations_total{operation=~"session_revoke_.*"}` | New server-authoritative result counter |
| Export/deletion/deactivation job state | `aura_account_privacy_job_transitions_total` | New controller and worker transition counter |
| Dependency failures | HTTP/error metrics, health/status signals and structured dependency logs | Existing system signals; staging correlation remains required |
| Core Web Vitals | `aura_account_web_vital_lcp_seconds`, `aura_account_web_vital_inp_seconds`, `aura_account_web_vital_cls_ratio` | New browser measurements, aggregated by bounded rating |
| JavaScript/network errors | `aura_client_diagnostics_total` and short-lived diagnostic records | New bounded counter over the existing diagnostic ingestion path |
| Queue failures | Privacy job failed transitions | New Account privacy-worker signal |
| Migration progress | `aura_account_migration_runs_total`, `aura_account_migration_pending_documents`, `aura_account_migration_modified_documents` | New signals emitted by the additive Account Center migration runner |
| Product behavior | `aura_account_product_events_total` | New typed, bounded, privacy-safe directional events |

The Account Center dashboard is
`infra/observability/grafana/dashboards/account-center-observability.json`.
Alert rules are
`infra/observability/prometheus/alerts/account-center.yml`. Prometheus already
loads the alert directory by wildcard and Grafana already provisions the
dashboard directory.

## Typed product events

| Event | Allowed context only |
|---|---|
| `account.section_viewed` | Bounded Account section |
| `account.profile_updated` | Allowlisted changed-field names |
| `account.address_added` | `home`, `work`, or `other` |
| `account.preference_changed` | Allowlisted topic, channel, and boolean state |
| `account.order_searched` | Query-present boolean, bounded status, date-range-present boolean |
| `account.return_started` | `refund` or `replacement` |
| `account.buy_again_selected` | Item-count bucket only |
| `account.passkey_added` | Empty context |
| `account.session_revoked` | Bounded scope only |
| `account.export_requested` | Empty context |
| `account.deactivation_initiated` | Empty context |
| `account.deletion_initiated` | Empty context |
| `account.web_vital` | Metric, bounded value, rating and navigation type |

Unknown Account event names, unknown context fields and invalid enum values are
rejected. The client also drops unknown fields before transport, but the server
schema is the enforcement boundary.

## Data minimization

Account product records deliberately omit event IDs, session IDs, request IDs,
URLs, methods, IP addresses, user agents and error payloads. Generic client
diagnostics retain only:

- normalized route and URL paths with queries and dynamic identifiers removed;
- HMAC references for browser-session and IP correlation;
- a coarse browser/platform family such as `chrome/windows`;
- bounded request correlation IDs, status, duration and redacted error context.

Passwords, OTPs, bearer tokens, cookies, recovery secrets, addresses, contact
details, payment data and raw security identifiers are not accepted as Account
product dimensions. The existing diagnostic collection TTL defaults to 14 days
through `CLIENT_DIAGNOSTIC_RETENTION_SEC`; a policy owner may shorten it.
`OBSERVABILITY_HASH_SECRET` may provide stable cross-process references, with
existing session-secret contracts as fallbacks. Secret values must never be
logged or committed.

## Dashboard and alert contract

The dashboard covers Account operation outcomes/latency, privacy jobs, product
events, browser diagnostics, p75 LCP/INP/CLS, migration progress and Account
HTTP latency. Initial static alerts cover:

- an Account operation failure burst;
- any session-revocation failure;
- any privacy-job failure;
- elevated bounded client diagnostics;
- p75 LCP above 2.5 seconds with at least 20 samples;
- p75 INP above 200 milliseconds with at least 20 samples;
- p75 CLS above 0.1 with at least 20 samples;
- any migration-run failure.

These rule files are implementation defaults, not evidence that production
alerts are active or correctly calibrated. Staging must prove scrape
authentication, metric presence, dashboard queries, synthetic firing and
resolution, notification routing, runbook access, cardinality and retention
before release. Threshold changes require observed evidence and review.

## Verification and rollback

Local verification:

- typed client normalization tests;
- server schema, privacy-normalization and persistence-boundary tests;
- Account operation/privacy/migration metric tests;
- route integration tests;
- dashboard JSON and alert YAML parsing;
- repository observability asset validation;
- route scanners, secret scan, localization guards and production bundle
  budget.

Rollback is the Wave N commit boundary. Reverting it removes Account product
instrumentation, dashboard and alerts while preserving the pre-existing HTTP,
security, cache, database and diagnostic infrastructure. Existing metric names
must not be repurposed after staging consumption begins.
