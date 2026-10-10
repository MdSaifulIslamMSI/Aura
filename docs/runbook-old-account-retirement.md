# Runbook — old AWS account (942679464475) retirement

**Status: replication and cutover COMPLETE (2026-10-10). Drain pending.**

The new account (517353742644) now serves production static + `/api` through
CloudFront `EZZ7ARQ9QFQ71` (`https://dip82eloip5zb.cloudfront.net`) backed by
S3 `aura-frontend-517353742644-ap-south-1`. All seven storefront lanes proxy
`/api` at the new edge via the single-sourced routing contract.

The old account retains three resources, still enabled and rollback-capable:
CloudFront `E34Z9POGIQYOCS`, S3 `aura-frontend-942679464475-ap-south-1`
(25,619 objects / ~6 GB, including `_aura-rollback/` snapshots), OAC
`E88GSUA02J7JC`, plus the `aura-cloudtrail-logs-*` audit bucket.

## Timeline

| Date | Event |
| --- | --- |
| 2026-09-18 | Old-account zombies drained: staging distro + both EC2s terminated, 52 GB EBS auto-deleted, 4 stale buckets deleted |
| 2026-09-19 | Edge config exported + committed; new-account OAC `E1IPOYOIPU8DVP` created |
| 2026-09-22 → 10-02 | CloudFront creation denied by AWS account verification (support case `178895182300548`, "minimal usage and no billing history") |
| **2026-10-10** | **Verification gate lifted.** Distribution `EZZ7ARQ9QFQ71` created and enabled |
| 2026-10-10 | Bucket policy → OAC + full public-access-block; bucket seeded; deploy role fixed; frontend vars flipped; deploy run `38028629353` green |

## What the block-clearing actually required

Three defects in `infra/aws/cloudfront-edge-replica.json` would have produced a
broken replica if applied verbatim:

1. Backend origin pointed at `13.127.230.58.sslip.io` — **dead since
   2026-09-25** when the EIP was pinned. Corrected to `13.205.7.2.sslip.io`.
2. `FunctionARN` referenced `arn:aws:cloudfront::942679464475:function/…` — a
   CloudFront Function ARN is account-scoped. The new account already had a
   logically identical `aura-frontend-spa-rewrite` (created 2026-09-08, differing
   only in CRLF vs LF); the ARN was repointed.
3. `CallerReference` reused the abandoned 2026-09-19 value.

One non-obvious blocker: `.github/workflows/production-cicd.yml` reads
`${{ secrets.AWS_FRONTEND_DEPLOY_ROLE_ARN }}` **directly** at lines 1264, 1368
and 1857 rather than through the `vars. || secrets.` fallback used elsewhere.
Flipping the repo variable alone leaves CI assuming the **old-account** role.

## Divergences from the original plan

- **No manual 6 GB copy.** The plan's `aws s3 sync` round-trip was unnecessary:
  once `AWS_FRONTEND_BUCKET` / `AWS_FRONTEND_DEPLOY_ROLE_ARN` point at the new
  account, the existing deploy lane seeds the bucket as part of a normal
  release and invalidates the new distribution.
- **New-account role needed `cloudfront:CreateInvalidation`.** The bootstrap role
  only carried S3 permissions, so the deploy would have synced successfully and
  then failed at the invalidation step.
- **Bucket policy hardening.** The pre-existing `PublicReadStaticWebsite`
  policy was replaced with the OAC statement, after which full
  public-access-block was enabled (matching the old bucket's posture).

## Remaining: drain the old account

Do not start until the new edge has served production cleanly for ~2 weeks.

1. Confirm no lane still references `dbtrhsolhec1s`:
   `git grep dbtrhsolhec1s` (only inert test fixtures and this runbook should
   remain).
2. Disable `E34Z9POGIQYOCS` — **keep it disabled, do not delete**, so rollback
   stays possible.
3. Empty + delete `aura-frontend-942679464475-ap-south-1` (contains
   `_aura-rollback/` snapshots; confirm nothing references them first).
4. Delete OAC `E88GSUA02J7JC` and the CloudFront Function
   `aura-frontend-spa-rewrite`.
5. Export/keep `aura-cloudtrail-logs-942679464475-ap-south-1` if audit history
   is wanted before closing the account.

Old-account cost while draining is ~$0–1/month (CloudFront free tier + a few
GB of S3).