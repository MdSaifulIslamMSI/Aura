# Disaster Recovery Runbook

This runbook is intentionally non-destructive by default. Do not run production restore commands from a laptop or CI job unless an incident commander approves the exact target and scope.

## Safe Verifier

Run:

```sh
npm run security:backup-restore-check
npm run security:backup-restore-drill
```

The verifier checks that backup command, restore command, and backup storage configuration are present. A successful dry run is configuration-only evidence: it does not execute a backup or restore and does not prove a restore drill. The JSON output records those limits explicitly. It does not print secrets, database URIs, backup bucket names, tokens, or command contents.

The isolated restore drill performs a real backup and restore cycle on a disposable local fixture under the OS temporary directory. It verifies collection counts and SHA-256 digests, removes the temporary work directory, does not run external commands, does not use the network, and does not connect to MongoDB. This is stronger than configuration-only evidence, but it still does not prove managed backup availability or provider retention.

Production restore is blocked unless all are true:

- `RESTORE_TARGET_ENV=production`
- `DRY_RUN=false`
- `APPROVE_PRODUCTION_RESTORE=yes`

## Restore Drill Checklist

1. Assign incident commander, database owner, and communications owner.
2. Run `npm run security:backup-restore-drill` locally to confirm the restore harness still works.
3. Restore into isolated staging or a disposable private environment first.
4. Verify MongoDB collections, indexes, and application health.
5. Verify Redis/session assumptions; do not resurrect expired OTP, recovery, or session material.
6. Validate payment data boundaries; provider records may remain authoritative outside Aura.
7. Rotate credentials if backup compromise is suspected.
8. Capture RTO, RPO, command versions, backup object IDs, and evidence links.
9. Run security regression checks before any production cutover.

## Verification

```sh
npm --prefix server test -- --runTestsByPath tests/disasterRecoveryRunbook.test.js --forceExit
```

## Remaining Work

- Store signed managed-backup restore drill evidence per release.
- Add managed-backup API checks once production backup provider ownership is finalized.
- Add immutable backup retention monitoring.
