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

## Production Backup Mechanism

`.github/workflows/production-db-backup.yml` runs daily (21:13 UTC) and on
manual dispatch. It resolves the backend instance by tag, dispatches
`scripts/production/backup-production-mongo.sh` over SSM Run Command, and the
script performs a hot logical `mongodump --archive --gzip` against the live
database, uploads the archive plus SHA-256 checksums and a manifest to the
`AURA_BACKUP_BUCKET` S3 bucket under `production/mongo/<UTC-timestamp>/`
(SSE-S3 encrypted), and removes local artifacts. The workflow ensures bucket
versioning and a merged lifecycle expiry rule (default 35 days,
`AURA_BACKUP_RETENTION_DAYS`), and verifies the uploaded object before
reporting success.

There is no `--oplog`: the database is an Atlas shared-tier cluster that does
not expose the oplog. The backup is a hot snapshot, so application-level
cross-collection consistency within the dump is not guaranteed the way an
application-quiesced backup is.

Backup failure alerting: the backup job posts to the Aura status webhook
(`STATUS_WEBHOOK_URL`) on failure, and a `freshness` job in the same workflow
fails if the newest `production/mongo/` archive is older than 26 hours (or
absent). Scheduled-workflow failure emails remain the secondary alert path.

## Production Restore And Drill

`scripts/production/restore-production-mongo.sh` runs on the backend EC2 host
(dispatched via SSM or SSH). It downloads the archive, verifies the SHA-256
checksum and the production manifest, then either:

- **Drill mode (`RESTORE_DRILL=true`)** — restores into a disposable,
  network-isolated `mongo:7` container, prints restored collection/index
  stats, and cleans up. This never touches a live database and is the
  expected mode for the periodic restore drill.
- **Live restore mode** — restores with `--drop` into `AURA_RESTORE_URI` and
  requires `AURA_RESTORE_CONFIRM=YES`. Destructive: incident-commander
  approval of the exact target URI is mandatory before dispatch.

Example drill (safe, no live data touched):

```sh
# Dispatched on the prod host (SSM):
RESTORE_DRILL=true \
AURA_BACKUP_BUCKET=<bucket> \
AWS_REGION=<region> \
RESTORE_S3_KEY=production/mongo/<backup-id>/mongo.archive.gz \
bash restore-production-mongo.sh
# Expect: "Archive integrity verified..." then "RESTORE_DRILL_PASS ..."
```

Capture RTO per drill: time from decision to `RESTORE_DRILL_PASS` (drill) and
to application-verified cutover (live restore). Record the backup object key,
drill date, and evidence in the incident log.

## Remaining Work

- Run the backup workflow once end to end (see
  `docs/backup-activation-checklist.md` for the activation steps) and store
  the first restore-drill evidence.
- Add immutable backup retention (S3 Object Lock in compliance mode) and
  monitoring that the lifecycle rule stays active.
- Add backup-failure paging beyond the status webhook and GitHub failure
  emails once a paging vendor is chosen.
