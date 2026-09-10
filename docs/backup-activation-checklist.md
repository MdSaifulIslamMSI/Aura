# Backup And Uptime Activation Checklist

The backup automation, freshness check, and uptime probe are all wired, but
they stay red until the live-cloud steps below are done. Run them in order;
each command is copy-paste safe (fill the `<...>` placeholders first).

## 0. Prerequisites

- AWS CLI authenticated against the production account
  (account `517353742644`), region `ap-south-1` unless overridden.
- `gh` CLI authenticated with access to the repo settings.
- The prod EC2 host's SSM instance tag value (`AWS_INSTANCE_TAG_VALUE`).

```sh
AWS_REGION=ap-south-1
BACKUP_BUCKET=aura-prod-mongo-backups-517353742644
```

## 1. Create the backup bucket (once)

```sh
aws s3api create-bucket \
  --bucket "${BACKUP_BUCKET}" \
  --region "${AWS_REGION}" \
  --create-bucket-configuration LocationConstraint="${AWS_REGION}"

# Block all public access (do this before any object lands).
aws s3api put-public-access-block \
  --bucket "${BACKUP_BUCKET}" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Default at-rest encryption (the backup script also sets --sse aws per object).
aws s3api put-bucket-encryption \
  --bucket "${BACKUP_BUCKET}" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'

# Enforce TLS-only access.
aws s3api put-bucket-policy --bucket "${BACKUP_BUCKET}" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"DenyInsecureTransport\",
    \"Effect\": \"Deny\",
    \"Principal\": \"*\",
    \"Action\": \"s3:*\",
    \"Resource\": [
      \"arn:aws:s3:::${BACKUP_BUCKET}\",
      \"arn:aws:s3:::${BACKUP_BUCKET}/*\"
    ],
    \"Condition\": {\"Bool\": {\"aws:SecureTransport\": \"false\"}}
  }]
}"
```

Versioning and the 35-day lifecycle rule are ensured automatically by the
workflow on every run; no manual step needed.

## 2. Point the workflow at the bucket

```sh
gh variable set AURA_BACKUP_BUCKET --body "${BACKUP_BUCKET}"
```

The role used by the workflow (`AWS_DEPLOY_ROLE_ARN`) needs `s3:PutObject`,
`s3:ListBucket`, `s3:GetBucketVersioning`,
`s3:PutBucketVersioning`, `s3:GetLifecycleConfiguration`,
`s3:PutLifecycleConfiguration` on this bucket. Note: the archive upload itself
runs on the EC2 host, so the instance profile also needs `s3:PutObject` /
`s3:PutObjectAcl`-free write access to `arn:aws:s3:::${BACKUP_BUCKET}/production/mongo/*`.

## 3. Configure the uptime probe

```sh
gh variable set AURA_UPTIME_BACKEND_URL --body "https://<prod-api-origin>"
```

Until this is set, the probe fails on purpose (it is the alert for "production
liveness is unmonitored").

## 4. Run the first backup

```sh
gh workflow run production-db-backup.yml
gh run watch # select the newest Production DB Backup run
```

Expect: job `backup` succeeds and prints `Verified
s3://${BACKUP_BUCKET}/production/mongo/<id>/mongo.archive.gz`, and job
`freshness` turns green.

## 5. Run the first restore drill (proves restorability)

Copy `scripts/production/restore-production-mongo.sh` to the prod host
(`scp`, or paste it over an SSM Run Command), then run it in drill mode —
it never touches live data:

```sh
RESTORE_DRILL=true \
AURA_BACKUP_BUCKET="${BACKUP_BUCKET}" \
AWS_REGION="${AWS_REGION}" \
RESTORE_S3_KEY=production/mongo/<backup-id>/mongo.archive.gz \
bash restore-production-mongo.sh
```

Expect `Archive integrity verified` then `RESTORE_DRILL_PASS`. Record the
RTO and the evidence link in the incident log (see
`docs/security/disaster-recovery-runbook.md`).

## 6. Alertmanager activation (optional but recommended)

On the host running the observability compose stack:

```sh
# In /opt/aura/shared/base.env (or the compose env source):
ALERTMANAGER_STATUS_WEBHOOK_TOKEN=<same value as the API's STATUS_WEBHOOK_TOKEN>
```

Then `docker compose -f infra/observability/docker-compose.ec2.yml up -d alertmanager`.
Verify: `curl -s 127.0.0.1:9093/-/ready` and a test alert arriving as a status
webhook event in the admin status system.

## Done When — COMPLETED 2026-09-09 (run 34402092815)

- [ ] Bucket exists with public access blocked, encryption + TLS-only policy.
- [x] `AURA_BACKUP_BUCKET` and `AURA_UPTIME_BACKEND_URL` repo variables set (uptime probe green since 2026-09-09 06:30 UTC).
- [x] First workflow-driven backup green: `production/mongo/20260909-203715/mongo.archive.gz` verified in S3 (run 34402092815, ~42 min dump+upload).
- [x] Restore drill `RESTORE_DRILL_PASS`: checksum verified on host, mongorestore into isolated mongo:7 container, 62 collections with index counts intact (products 50k docs/29 indexes, statuschecks 208,892 docs). Archive→verified-restore in ~1 minute on-host.
- [ ] Alertmanager reachable and token configured (deferred: `ALERTMANAGER_STATUS_WEBHOOK_TOKEN` must be set on the observability host; config is merged and waiting).
