---
name: "aws-github-oidc"
description: "GitHub Actions OIDC setup for this repo's AWS backend deploy flow. Use when creating or updating the deploy role, validating trust policy subjects, checking bucket and SSM permissions, or reasoning about `.github/workflows/deploy-backend-aws.yml` against `infra/aws/bootstrap-github-oidc.ps1`."
---

# AWS GitHub OIDC

Use this skill for the repo's GitHub-to-AWS trust path.

## Do First

1. Read `references/oidc-flow.md`
2. Inspect `infra/aws/bootstrap-github-oidc.ps1`
3. Inspect `.github/workflows/deploy-backend-aws.yml`

## Rules

- Preserve GitHub OIDC over long-lived AWS keys
- Keep trust policy subjects aligned with the real repo and branch
- Treat bucket and SSM permissions as least-privilege review points
