# Runbook — old AWS account (942679464475) retirement

**Status: COMPLETE. The account is empty and awaiting console closure (2026-10-21).**

The old account `942679464475` ("MD SAIFUL ISLAM", created 2026-03-09) served the
Aura storefront until the 2026-09/10 migration to `517353742644` ("esmat"). It has
now been drained: every resource is deleted and the audit evidence is preserved in
the new account.

**Last remaining step: close the account in the AWS console.** It cannot be
scripted — AWS CLI 2.34.3 has no `account close-account` operation
(`Found invalid choice 'close-account'`) and the account has no Premium Support,
so the `support` API is unavailable. See "Closing the account" below.

## Timeline

| Date | Event |
| --- | --- |
| 2026-09-18 | Old-account zombies drained: staging distro + both EC2s terminated, 52 GB EBS auto-deleted, 4 stale buckets deleted |
| 2026-09-19 | Edge config exported + committed; new-account OAC `E1IPOYOIPU8DVP` created |
| 2026-09-22 → 10-02 | CloudFront creation denied by AWS account verification (support case `178895182300548`, "minimal usage and no billing history") |
| **2026-10-10** | **Verification gate lifted.** Distribution `EZZ7ARQ9QFQ71` created and enabled; bucket policy → OAC + full public-access-block; deploy run `38028629353` green |
| 2026-10-21 | **Old account fully drained** (this document) |

## What was deleted from the old account

Every line below was verified empty by a 49-group sweep (`verify-empty` style
probes) after the teardown.

| Area | Deleted |
| --- | --- |
| CloudFront | distribution `E34Z9POGIQYOCS`, OAC `E88GSUA02J7JC`, function `aura-frontend-spa-rewrite` (both stages) |
| S3 | `aura-cloudtrail-logs-942679464475-ap-south-1` (108,568 objects / 213,921,303 bytes + 217,144 noncurrent versions and delete markers — the bucket was versioned) |
| EC2 / VPC | AMI `ami-0190a0d8273891dd1`, snapshot `snap-0af3bc32abc9b5b53` (32 GB), key pair `aura-staging-key`, 3 security groups, 3 subnets, internet gateway, route tables, VPC `vpc-0285b12b9face02d2`, VPC flow log `fl-0cd57bd032bdea126` |
| Logging | CloudTrail trail `aura-account-trail` (stopped, then deleted), log groups `/aws/cloudtrail/aura-account-trail` and `/aws/vpc/aura-backend-flow-logs` |
| Config | recorder `aura-config-recorder`, delivery channel `aura-config-delivery` |
| App | SNS topic `aura-backend-guardrails`, 4 CloudWatch alarms, 2 budgets, all 166 SSM parameters, SES templates |
| IAM | user `aura-admin-cli` (access key `AKIA5W7ATDIN66M7HCPO` revoked), 16 roles, 2 instance profiles, account password policy |

**5 service-linked roles remain** (`AWSServiceRoleForCloudFrontLogger`,
`...ForRDS`, `...ForResourceExplorer`, `...ForSupport`, `...ForTrustedAdvisor`).
These live under `/aws-service-role/` and cannot be deleted by hand — AWS removes
them when the account closes.

## What was preserved first

Nothing was deleted before it was secured. Archive root:
`~/.aws/archive/aura-old-account-942679464475/`

| Preserved | Where |
| --- | --- |
| 90 `/aura/prod/*` SSM parameters | already in the new account — values diffed, **0 mismatches** |
| 76 `/aura/staging/*` SSM parameters | **existed only in the old account** — restored into the new account's `/aura/staging/` |
| 108,568 CloudTrail objects (213,921,303 bytes) | `s3://aura-archived-cloudtrail-942679464475-ap-south-1` in the new account (SSE-AES256, full public-access-block, IA lifecycle after 30 days) |
| SSM parameter metadata (names, types, versions, timestamps) | `ssm-parameter-metadata.json` — no secret values on disk |
| IAM credential report | `iam-credential-report.csv` |
| CloudFront distribution config | `cloudfront-E34Z9POGIQYOCS.json` |
| Full resource inventory | `resource-inventory.json` |
| The old `/aura/prod/SENTRY_DSN` value | `reviewed-differences-old-values.json` — see below |

### The one value difference, and why it was not "fixed"

`/aura/prod/SENTRY_DSN` differed between the accounts. The old account held a real
Sentry DSN (org `o4511422841421824`, project `4511428819877888`); the new account
holds Sentry's no-op placeholder `o0.ingest.us.sentry.io/0`.

The running production EC2 is in the **new** account, so the placeholder is what
production actually resolves — the old value is a stale leftover, not the live
config. Overwriting the live value would be a production behaviour change
dressed up as cleanup, so the old value was archived for recovery and the live
value was left alone.

**Open follow-up:** backend Sentry reporting is therefore effectively disabled
today. The frontend is unaffected — it reads the `VITE_SENTRY_DSN` GitHub secret,
not SSM. Pointing the SSM value at the archived DSN is a deliberate production
change, not part of the teardown.

## Closing the account

1. Sign in to the console as the **root user** of `942679464475`:
   <https://console.aws.amazon.com/console/home?region=ap-south-1>
2. **Account & Billing → Account → Account closure → Close account**.
3. AWS disables the root user and all credentials, deletes anything left, and
   marks the account closed.

Pre-conditions, all verified:

- Standalone account — `describe-account` returns `AWSOrganizationsNotInUseException`
- Root MFA enabled — `get-account-summary` → `AccountMFAEnabled: 1`
- Root has no access keys — `AccountAccessKeysPresent: 0`
- Contact information present — `RISHRA, West Bengal, IN 712248`
- No resources remain — 49-group sweep returns empty
- Budgets deleted (so no cost alerts fire into a closed account)

**The account can be reactivated within 90 days of closure.** After that the
account ID is gone for good.

## After closure

- Remove the local `[default]` profile that `aws login` created in `~/.aws/config`
  (`login_session = arn:aws:iam::942679464475:root`) and the cached token under
  `~/.aws/login/cache/`.
- The archived CloudTrail evidence stays in the new account and does not depend on
  the old one existing.

## Traps hit during this teardown (read before repeating it)

- **`aws s3 sync` silently skips zero-byte keys ending in `/`** (folder markers).
  Two markers were missing from the copy and had to be copied with `s3 cp` for the
  archive to be byte-complete.
- **The CloudTrail trail keeps writing while you copy.** The count check must run
  *after* `stop-logging`, or the source grows past the destination and the copy
  looks incomplete forever.
- **The bucket was versioned.** `s3 rb --force` empties the visible objects but
  leaves noncurrent versions and delete markers, so `delete-bucket` still fails
  with `BucketNotEmpty`. Those need `DeleteObjects` with explicit `VersionId`s.
- **AWS CLI v2 `s3api delete-objects` cannot take the object list** in this build
  (`Unknown parameter in input: 'Objects'`), the `--delete` boolean shorthand
  collides with `--cli-input-json`, and a 1000-key inline payload overflows the
  Windows command-line limit (`ENAMETOOLONG`). Use the SDK's `DeleteObjectsCommand`
  with a payload file instead.
- **`aws cloudfront get-function` requires `--outfile`** (it downloads the code).
  Use `describe-function` to read the ETag.
- **`delete-function` and `delete-origin-access-control` reject `--if-match '*'`** —
  they need the real ETag.
- **A distribution cannot be deleted while its config update is in flight**
  (`DistributionNotDisabled`). Re-read the ETag and retry.
