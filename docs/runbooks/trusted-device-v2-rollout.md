# Trusted-device V2 rollout

## Safety contract

Legacy `User.trustedDevices` remains the sole authorization source in this release. V2 may be backfilled, dual-written, and shadow-compared, but it must not serve authentication decisions. The server rejects `v2_with_legacy_fallback` and `v2_only` at startup.

Do not run migration apply or change a deployed cohort until staging health, cost, observability, rollback, branch-protection, same-SHA, and canary gates are green. Never print the pseudonym key, Mongo URI, environment files, or credential material.

## Configuration

Safe defaults:

```text
AUTH_TRUSTED_DEVICE_V2_WRITE_MODE=off
AUTH_TRUSTED_DEVICE_V2_READ_MODE=legacy
AUTH_TRUSTED_DEVICE_V2_ADMIN_COHORT_PERCENT=0
AUTH_TRUSTED_DEVICE_V2_PUBLIC_COHORT_PERCENT=0
AUTH_TRUSTED_DEVICE_V2_ALLOWLIST=
AUTH_TRUSTED_DEVICE_V2_COHORT_SEED=trusted-device-v2-default
```

Allowlist entries and cohort hashing use the normalized Mongo user ID. Cohorts are separated for `admin` and `public` audiences.

## Audit and apply

Set `TRUSTED_DEVICE_V2_MIGRATION_PSEUDONYM_KEY` through the runtime secret manager. It must contain at least 32 characters and is never included in evidence.

Audit first:

```powershell
npm --prefix server run migrate:trusted-device-v2 -- --mode=audit --run-id=<audit-id> --audience=all --requested-by=<operator>
```

Do not approve unless evidence reports `completed`, zero failed records, zero skipped records, a source digest, and an approval hash. Apply uses a distinct run ID and both mutation gates:

```powershell
$env:TRUSTED_DEVICE_V2_MIGRATION_APPLY_ENABLED='true'
npm --prefix server run migrate:trusted-device-v2 -- --mode=apply --execute --run-id=<apply-id> --audit-run-id=<audit-id> --approval-hash=<hash> --approved-by=<approver> --requested-by=<operator> --audience=all
```

Apply performs a full fingerprint comparison before the first V2 credential write. It checks again at completion to detect a source change during the run. Any source drift fails the run and requires a new audit. Read evidence without mutation:

```powershell
npm --prefix server run migrate:trusted-device-v2 -- --evidence-run-id=<run-id>
```

## Staging sequence

1. Deploy the exact candidate SHA with writes off, legacy reads, and zero cohorts.
2. Run the audit, inspect bounded error samples, and store evidence with the release record.
3. Apply in staging only after approval and confirm migrated count, source digest, and rollback-plan count.
4. Enable `dual_write` and `shadow_compare` for an explicit public test allowlist; leave percentages at zero.
5. Exercise enrollment, assertion, rename, revoke, revoke-others, current-device sign-out, password reset, synced passkey, and admin UV passkey flows.
6. Add the admin owner to the allowlist only after the public path has zero V2 write failures and zero shadow mismatches.
7. Widen public and admin cohorts independently. Never widen both in one change.

Required staging evidence is zero `trusted_device_v2_*` failure outcomes, no admin trusted-device alert, successful public/admin negative tests, healthy latency/error rates, and a tested rollback. Use the Grafana panels `Trusted Device Verification Success Ratio` and `Trusted Device Lifecycle And V2 Drift` plus the Prometheus V2 alerts.

## Stop and rollback

Immediately stop widening on any V2 write failure, V2 shadow failure, credential/key/session mismatch, backup-eligibility mismatch, unexpected admin step-up denial, recovery revocation failure, or elevated public failure ratio.

Rollback configuration:

```text
AUTH_TRUSTED_DEVICE_V2_WRITE_MODE=off
AUTH_TRUSTED_DEVICE_V2_READ_MODE=legacy
AUTH_TRUSTED_DEVICE_V2_ADMIN_COHORT_PERCENT=0
AUTH_TRUSTED_DEVICE_V2_PUBLIC_COHORT_PERCENT=0
AUTH_TRUSTED_DEVICE_V2_ALLOWLIST=
```

Restart and verify legacy enrollment, assertion, revoke, password reset, and admin step-up. Legacy documents are not deleted by migration, so this rollback does not depend on V2.

Do not delete V2 records casually. The migration evidence rollback plan requires an export digest, the exact migration-run selector, and an exact count match before deletion. Treat any mismatch as an incident and preserve both stores for investigation.

## Production gate

Production may receive this code with V2 off. A V2 production cohort requires the same candidate SHA already proven in staging, green required checks and branch protection, current cost headroom, deployed dashboards/alerts, a named rollback owner, and read-only post-deploy probes. Authoritative V2 reads remain prohibited until a separate atomic-cutover change is reviewed and proven.
