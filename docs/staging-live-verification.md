# Staging Live Verification

> **Historical snapshot — not current state.** This record was generated on
> 2026-05-26 against AWS account `942679464475`, which was retired on
> 2026-10-21. Every resource named below (the EC2 instance, the S3 bucket, the
> CloudFront distribution) was deleted with that account.
>
> Staging is currently **paused**: `vars.STAGING_INFRA_PAUSED=true` and the
> `STAGING_*` endpoint variables are unset, so the staging lanes skip instead of
> probing a dead hostname. The staging bucket for the current account
> (`517353742644`) is `aura-staging-uploads-517353742644-ap-south-1`, and it is
> deliberately **not created** while staging stays off; it is provisioned by
> `scripts/staging/02-create-s3-bucket.sh` when staging is deliberately
> re-enabled. See `docs/runbook-old-account-retirement.md` for the retirement
> record.

Final status at the time of generation: Code is staging-safe, and live staging infrastructure was present.

Generated: 2026-05-26T17:06:02Z

| Check | Value |
| --- | --- |
| EC2 instance id | i-0af0bd44f6463b11b |
| EC2 public DNS | ec2-13-201-55-118.ap-south-1.compute.amazonaws.com |
| Staging API base URL | http://ec2-13-201-55-118.ap-south-1.compute.amazonaws.com |
| Staging health URL | http://ec2-13-201-55-118.ap-south-1.compute.amazonaws.com/health |
| Frontend staging URL | http://ec2-13-201-55-118.ap-south-1.compute.amazonaws.com |
| Frontend staging mode | Docker static frontend on AWS staging |
| Frontend staging smoke | PASS |
| S3 bucket | aura-staging-uploads-942679464475-ap-south-1-v2 (deleted with account `942679464475`; retargeted name for account `517353742644`: `aura-staging-uploads-517353742644-ap-south-1`, not created while staging is paused) |
| SSM prefix | /aura/staging |
| GitHub staging vars configured | yes |
| Vercel vars configured | no |
| Route smoke | PASS |

Docker Compose status:

```text
backend running healthy
mongo running
postgres running
redis running
scanner running healthy
```
