---
name: "aws-release-rollout"
description: "AWS backend release rollout for this repo's EC2 runtime. Use when reviewing or changing `infra/aws/deploy-release.sh`, validating the S3 artifact plus SSM command flow, checking compose startup behavior, or debugging readiness failures after deployment."
---

# AWS Release Rollout

Use this skill for the actual release execution path on the EC2 host.

## Do First

1. Read `references/release-rollout.md`
2. Inspect `infra/aws/deploy-release.sh`
3. Inspect `infra/aws/docker-compose.ec2.yml`
4. Inspect `.github/workflows/deploy-backend-aws.yml`

## Rules

- Preserve the release artifact flow: S3 upload, SSM command, EC2 extraction, Docker load, and health probe
- Treat trusted-device contract checks as release blockers, not optional warnings
- Prioritize rollout regressions and readiness failures over stylistic changes
