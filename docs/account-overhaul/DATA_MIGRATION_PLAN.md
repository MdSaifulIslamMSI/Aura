# Account and Profile Overhaul: Data Migration Plan

## Safety model

All data changes are additive, restartable, observable, and reversible at the application-read layer. No migration may delete customer records, truncate embedded arrays, rewrite payment/tax evidence, or activate production automatically.

Every migration needs:

- a dry-run mode that emits counts only;
- a deterministic version identifier;
- bounded batches and checkpoints;
- idempotent writes;
- pre/post invariants;
- error quarantine rather than skip-and-forget;
- application compatibility with old and new shapes;
- an explicit rollback or forward-fix plan.

## Proposed schema changes

### User profile

Add:

```text
avatarMedia:
  objectKey
  version
  contentType
  byteSize
  width
  height
  checksum
  scanStatus
  updatedAt
```

Keep legacy `avatar` readable during migration. New writes use `avatarMedia` only after the feature flag is enabled. The public serializer prefers finalized media and falls back to a validated legacy avatar.

Resolve the current bio constraint mismatch before backfill. The safer default is the existing database maximum of 200 characters unless product explicitly approves a schema expansion. Do not silently truncate existing values.

### Notification preferences

Prefer a dedicated `AccountPreference` model if preference history/versioning grows independently:

```text
user (unique)
version
notificationTopics
consent
createdAt
updatedAt
```

Mandatory security/transactional notices are represented as policy, not mutable customer preferences.

Indexes:

```text
{ user: 1 } unique
```

### Privacy jobs

Add dedicated records:

```text
AccountExportJob
  user
  status
  scopeVersion
  requestedAt
  completedAt
  expiresAt
  delivery
  artifactKey
  failureCode

AccountDeletionRequest
  user
  status
  requestedAt
  graceEndsAt
  cancelledAt
  legalHolds
  completedAt
  policyVersion

AccountLifecycleAudit
  user
  event
  actorType
  policyVersion
  timestamp
  metadata (allowlisted)
```

Indexes must cover user/status/time operations and TTL only for disposable delivery artifacts or completed outbox work. TTL must never drive legal erasure of durable evidence.

### Security activity

Do not migrate raw internal events into a customer collection unless measurement shows projection cost is unacceptable. Start with an allowlisted serializer over existing event sources. If a read model is later required, populate it from outbox events and keep it rebuildable.

### Addresses

Introduce a server-side maximum for new writes only after inventorying current array sizes.

- Do not delete or hide existing addresses above the limit.
- Users above the limit may edit/delete existing entries but cannot add another until below the maximum.
- Normalize default-address invariants in an idempotent repair job.
- Quarantine invalid historical records for support review rather than guessing missing fields.

## Migration phases

### Phase 1: inventory

Dry-run counts:

- users with legacy avatar data URIs by MIME and byte size;
- invalid or externally hosted avatar values;
- address count distribution and multiple/no-default anomalies;
- bio lengths above each proposed limit;
- trusted-device array size distribution;
- wishlist and loyalty ledger document-growth distribution;
- notification preference candidates;
- account-state values and soft-deletion combinations.

Do not print personal values. Emit aggregate counts and opaque record IDs only to restricted evidence.

### Phase 2: additive schema and indexes

1. Deploy serializers that tolerate absent new fields.
2. Create indexes using the repository's safe migration mechanism.
3. Verify index build duration, replication lag, disk headroom, and query plans.
4. Keep all new writes disabled.

### Phase 3: shadow writes

- New avatar finalize writes the new media field and preserves legacy read fallback.
- Notification preference writes use the new record while the old UI remains read-only or dual-read.
- Lifecycle job models remain unreachable until policy approval.
- Compare new and legacy serializers in non-user-visible telemetry without logging personal values.

### Phase 4: bounded backfill

- Process stable `_id` ranges in small batches.
- Record `lastProcessedId`, counts, failures, and duration.
- Stop automatically on elevated error rate, replication lag, or disk pressure.
- Never embed raw avatar bytes into migration logs.
- Object-store migration uploads only after content revalidation and scan.

### Phase 5: read cutover

- Enable new reads for an internal cohort.
- Verify fallback rate and mutation/read consistency.
- Expand progressively.
- Keep legacy fields for at least one rollback window and until every supported client version can read the new response.

### Phase 6: cleanup

Cleanup is a separate reviewed migration after:

- 100% read cutover;
- rollback window expiration;
- verified object/media retention;
- export/deletion policy approval;
- no legacy client dependency;
- backup restore rehearsal.

Legacy field removal is not part of the initial overhaul rollout.

## Rollback

- Disable feature flags.
- Revert serializers to legacy-preferred reads.
- Stop backfill workers at a checkpoint.
- Preserve additive fields and records; do not attempt mass rollback deletes.
- Restore previous application SHA through the existing provider-specific rollback lane.
- If an index causes load, hide/drop it only through an approved database change with query-plan evidence.

## Required verification

- Migration unit tests for idempotency and malformed historical records.
- Integration test over mixed old/new documents.
- Dry-run in a production-like snapshot with personal data protected.
- Batch pause/resume and duplicate-run test.
- Object checksum and scan verification for avatar migration.
- Query plans before/after each index.
- Backup restore and forward-fix rehearsal.
- Metrics for processed, skipped, quarantined, failed, lag, latency, and storage growth.

## Blocked policy decisions

The export retention period, deletion grace period, reactivation behavior, legal-hold categories, and export-delivery method are unresolved. Privacy job schemas may be developed additively, but lifecycle activation and destructive processing remain blocked.
