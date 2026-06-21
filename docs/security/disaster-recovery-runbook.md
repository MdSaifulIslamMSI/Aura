# Disaster Recovery Runbook

This runbook is intentionally non-destructive by default. Do not run production restore commands from a laptop or CI job unless an incident commander approves the exact target and scope.

## Safe Verifier

Run:

```sh
npm run security:backup-restore-check
```

The verifier checks that backup command, restore command, and backup storage configuration are present. A successful dry run is configuration-only evidence: it does not execute a backup or restore and does not prove a restore drill. The JSON output records those limits explicitly. It does not print secrets, database URIs, backup bucket names, tokens, or command contents.

Production restore is blocked unless all are true:

- `RESTORE_TARGET_ENV=production`
- `DRY_RUN=false`
- `APPROVE_PRODUCTION_RESTORE=yes`

## Restore Drill Checklist

1. Assign incident commander, database owner, and communications owner.
2. Restore into isolated staging or a disposable private environment first.
3. Verify MongoDB collections, indexes, and application health.
4. Verify Redis/session assumptions; do not resurrect expired OTP, recovery, or session material.
5. Validate payment data boundaries; provider records may remain authoritative outside Aura.
6. Rotate credentials if backup compromise is suspected.
7. Capture RTO, RPO, command versions, backup object IDs, and evidence links.
8. Run security regression checks before any production cutover.

## Verification

```sh
npm --prefix server test -- --runTestsByPath tests/disasterRecoveryRunbook.test.js --forceExit
```

## Remaining Work

- Store signed restore drill evidence per release.
- Add managed-backup API checks once production backup provider ownership is finalized.
- Add immutable backup retention monitoring.
