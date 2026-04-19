# Repo Runtime

This repository's tracked AWS runtime shape is:

- Frontend on Vercel
- Backend on a single EC2 host
- API container plus worker container from the same image
- Redis sidecar on the EC2 host
- Secrets in AWS Systems Manager Parameter Store
- Deploys from GitHub Actions through GitHub OIDC and SSM Run Command

## Primary Repo Files

- `docs/aws-backend-deployment.md`
- `infra/aws/bootstrap-free-tier.ps1`
- `infra/aws/bootstrap-github-oidc.ps1`
- `infra/aws/bootstrap-cost-guardrails.ps1`
- `infra/aws/sync-parameter-store-env.ps1`
- `infra/aws/deploy-release.sh`
- `.github/workflows/deploy-backend-aws.yml`

## Useful Commands

- Repo-level SSM sync:

```powershell
npm run aws:ssm:sync
```

- Example dry-run:

```powershell
cd server
npm run aws:ssm:sync:example
```

- Contract audit:

```powershell
cd server
npm run aws:ssm:audit
```

## Guardrails

- Never print values from `server/.env.aws-secrets`
- Prefer dry-run or audit before live secret writes
- Preserve trusted-device and auth-vault deployment checks
- Treat `ap-south-1` as repo context, not a global rule
