# Account and Profile Overhaul: Rollout and Rollback

## Release principle

This overhaul ships as additive, observable waves. Production remains unchanged until the exact target SHA passes staging, cost, observability, migration, rollback, security, and branch-protection gates and production mutation is explicitly authorized.

## Feature flags

Proposed server-owned flags:

| Flag | Scope |
|---|---|
| `ACCOUNT_CENTER_V2` | New shell and overview |
| `ACCOUNT_CENTER_V2_PROFILE` | Profile/address module |
| `ACCOUNT_CENTER_V2_COMMERCE` | Orders and marketplace modules |
| `ACCOUNT_CENTER_V2_SECURITY` | Separated credentials, sessions, activity |
| `ACCOUNT_CENTER_V2_PREFERENCES` | Durable notification preferences |
| `ACCOUNT_CENTER_V2_AVATAR_MEDIA` | Signed object-storage avatar writes |
| `ACCOUNT_CENTER_V2_PRIVACY` | Export/deactivation/deletion entry points |

Flags default off in production. Privacy remains off until policy approval and destructive workflow rehearsal.

The server decides availability. The client must handle absent/disabled contracts and may not infer authorization from its local flag.

`ACCOUNT_CENTER_V2_PRIVACY` alone cannot activate lifecycle mutations. The server also requires `ACCOUNT_PRIVACY_POLICY_APPROVED`, a policy version, jurisdictions, export retention, deletion grace, reactivation policy, export delivery mechanism, `AWS_S3_PRIVACY_BUCKET`, and `ACCOUNT_PRIVACY_EXPORT_KMS_KEY_ID`. Missing or invalid configuration produces a safe disabled capability response and a fail-closed mutation gate; it never falls back to synchronous deletion.

Avatar storage uses the existing `UPLOAD_STORAGE_DRIVER`. Local development defaults to `server/uploads/avatars`; S3 requires `AWS_REGION` and `AWS_S3_AVATAR_BUCKET` (or the existing review-media bucket fallback), with optional `AWS_S3_AVATAR_PREFIX`. Runtime credentials come from the existing AWS identity chain and are never exposed to the client. Staging must prove bucket access, denial outside the configured prefix, private quarantine, immutable final reads, cleanup dry-run, and cleanup execution before the avatar flag can advance.

## Wave plan

### Wave 0: source and harness

- Reconcile target branch with the observed release lineage.
- Restore local start/stop workflow.
- Establish authenticated deterministic test account/fixture.
- Make focused test shards terminal and bounded.
- Triage dependency audit findings.

Exit: clean scoped diff, reproducible local account route, release plan bound to one SHA.

### Wave 1: shell and read-only overview

- Add account routes, rail/mobile navigation, state primitives, and query layer.
- Add bounded account summary.
- Keep legacy `/profile` available.
- Internal/staff cohort only.

Exit: no security mutation changes, request budget met, rollback flag verified.

### Wave 2: profile, addresses, orders, notifications

- Migrate existing behavior to modules.
- Add cursor UI, durable errors, accessible forms/dialogs.
- Preserve legacy APIs and ownership.

Exit: parity matrix green, cross-user negatives green, responsive/a11y evidence captured.

### Wave 3: payments, rewards, marketplace, support

- Reuse server-authoritative value and ownership contracts.
- Split heavy sections and measure chunks/network.

Exit: payment step-up and abuse suites green; no pricing/ownership client authority.

### Wave 4: security center

- Keep passkey/TOTP/recovery/trusted-device behavior.
- Add bounded active-session inventory/revocation.
- Add redacted security activity.

Exit: session store failure behavior, cross-user aliases, final-factor rules, and admin assurance all pass.

### Wave 5: media and preferences

- Enable signed avatar intent/finalize for a small cohort.
- Enable versioned notification preferences.
- Run backfill shadow/read phases.

Exit: MIME/extension/magic-byte/size/dimension/decode/scan checks, token replay and owner binding, optimistic concurrency, orphan cleanup, S3 prefix policy, and rollback reads pass.

### Wave 6: privacy

Blocked until jurisdiction, retention, grace, reactivation, legal holds, and delivery are approved.

Exit: policy sign-off, fresh-auth and abuse suites, migration/worker rehearsal, audit evidence, customer/support runbooks.

### Wave 7: database schema version and query indexes

1. Run the Account Center V2 migration in audit mode against the protected staging snapshot.
2. Record backup and immutable rollback evidence before enabling apply.
3. Build named additive indexes and observe duration, replication lag, disk headroom and application latency.
4. Run bounded apply batches, stop at a checkpoint, then prove repair-pass resume.
5. Capture redacted query-plan evidence for owner listings, reviews, trade-ins and price alerts.
6. Re-run the audit and require `pendingAfter: 0`.

The apply command must remain disabled unless every CLI and environment authorization gate is present. A paused or failed run is not a pass. Production database execution is prohibited until the same exact-SHA sequence succeeds in staging and the rollback rehearsal is recorded.

## Cohort progression

Suggested progression per wave:

1. Automated/staging fixtures.
2. Internal operators with no privileged bypass.
3. 1% customer cohort.
4. 5%.
5. 25%.
6. 50%.
7. 100%.

Hold each step for enough traffic to evaluate error and task metrics. Never expand solely because no alert fired; verify actual cohort exposure and sample tasks.

## Observability

Per-module:

- request count, latency, error and timeout rate;
- validation/conflict/rate-limit codes;
- summary partial-response rate and unavailable source;
- session list/revoke success/failure and store-unavailable rate;
- avatar intent/finalize/scan/orphan counts;
- privacy job state duration/failure/cancellation;
- client route error boundary and retry rate;
- task completion and abandonment without collecting sensitive form values;
- bundle/version/release identifiers.

Logs contain request IDs, authenticated opaque subject IDs where policy allows, action codes, result, latency, and safe reason codes. Never log passwords, OTPs, recovery codes, tokens, cookies, raw session IDs, full addresses, payment data, uploaded content, or export artifacts.

## Release gates

All must be terminal green or explicitly accepted by the authorized owner:

- scoped diff and secret scan;
- package audit triage;
- focused frontend/backend tests;
- sensitive route and auth/security suites;
- build and account bundle budgets;
- authenticated Playwright scenarios and screenshots;
- axe/keyboard/zoom checks;
- migration dry-run and rollback/read fallback;
- observability asset validation and live staging telemetry;
- cost guard;
- rollback target capture;
- branch protection and exact-SHA CI;
- staging health and account smoke.

## Automatic stop/rollback triggers

Stop expansion immediately for:

- authentication/session error increase;
- cross-user data or authorization failure;
- payment/price/ownership inconsistency;
- privacy job scope or retention error;
- elevated 5xx/timeout rate beyond the approved SLO;
- session store pressure or unbounded reads;
- avatar malware/scan bypass or public object exposure;
- account task completion regression;
- accessibility blocker on a core task;
- inability to attribute traffic to the intended release SHA.

Security/data-integrity incidents trigger flag disable plus provider rollback as appropriate. Preserve evidence; do not wipe records during incident response.

## Rollback sequence

1. Freeze cohort expansion.
2. Disable the narrowest affected server flag.
3. Confirm legacy route/API compatibility.
4. If required, run the existing provider-specific rollback workflow to the captured immutable target.
5. Verify frontend/backend release markers and health.
6. Run login and account smoke against the restored SHA.
7. Stop migration workers at checkpoints; retain additive data.
8. Record incident timeline, affected cohort, and residual actions.

Do not run deployment or rollback from this document. Existing GitHub workflows remain the execution authority.

## Current readiness

**Foundation verified; complete program not ready for rollout.**

Blockers:

- Waves K through N are not yet complete on the umbrella branch;
- the strict native-language final gate has a pre-existing human-review backlog for 19 locale rows;
- full umbrella-branch CI and required reviews are pending;
- authenticated staging browser, accessibility, performance, migration, load, and rollback evidence is absent;
- dependency audit findings still require current evidence and disposition;
- privacy policy decisions are unresolved;
- production release identity, immutable rollback targets, dashboards, and alerts are not yet recorded.
