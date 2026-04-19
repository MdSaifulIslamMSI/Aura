# Deploy Flow

## Current Shape

- Frontend stays on Vercel
- Backend runs on a low-cost EC2 host
- API and worker containers share one image
- Redis runs on the EC2 host
- Secrets live in Parameter Store
- GitHub Actions deploys through GitHub OIDC and SSM Run Command

## Bootstrap Steps

1. `infra/aws/bootstrap-free-tier.ps1`
2. `infra/aws/bootstrap-cost-guardrails.ps1`
3. `infra/aws/bootstrap-github-oidc.ps1`
4. `infra/aws/sync-parameter-store-env.ps1`

## Key Files

- `docs/aws-backend-deployment.md`
- `infra/aws/docker-compose.ec2.yml`
- `infra/aws/deploy-release.sh`
- `.github/workflows/deploy-backend-aws.yml`

## Repo Defaults Worth Preserving

- `t4g.small`
- arm64 image target
- `gp3` root volume
- `ap-south-1`
- GitHub OIDC instead of SSH

## Review Checklist

- Is the release path still using the checked-in bootstrap and deploy scripts?
- Do GitHub variables and secrets still match the documented deploy contract?
- Does the rollout preserve trusted-device and auth-vault requirements?
- Are cost guardrails still aligned with the current instance and storage shape?
