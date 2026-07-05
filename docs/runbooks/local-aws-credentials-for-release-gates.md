# Local AWS Credentials For Release Gates

This runbook is for running Aura staging smoke, AWS cost, AWS observability, and rollback-readiness checks from a local workstation without long-lived AWS keys.

Use temporary credentials only. Do not create IAM users or permanent AWS access keys for release gates.

References:

- AWS CLI IAM Identity Center setup: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html
- Aura staging IAM guardrail update: `docs/runbooks/apply-staging-release-guard-iam.md`

## Required Model

Local operators use AWS IAM Identity Center / AWS SSO to receive short-lived credentials for a staging-only permission set. The local profile name is fixed for this project:

```sh
AWS_PROFILE=aura-staging-operator
```

The profile must point at a staging account or staging role with only the permissions required by the release gates. It must not point at a production administrator role.

## One-Time AWS SSO Setup

1. In AWS IAM Identity Center, create or reuse a permission set for Aura staging release gates.
2. Assign only the required user or group to the staging AWS account.
3. Grant least privilege for the local checks:
   - read staging inventory needed by `npm run aws:cost-guard`
   - read observability inventory needed by `npm run aws:observability:guard`
   - read staging EC2/S3/SSM metadata needed by staging state refresh
   - optional read access to rollback artifact metadata when running rollback readiness
4. Do not grant production mutation permissions to this local profile.
5. Configure the local AWS CLI profile:

```sh
aws configure sso --profile aura-staging-operator
```

6. Sign in before running release gates:

```sh
aws sso login --profile aura-staging-operator
export AWS_PROFILE=aura-staging-operator
```

PowerShell:

```powershell
aws sso login --profile aura-staging-operator
$env:AWS_PROFILE = "aura-staging-operator"
```

The AWS CLI stores SSO session cache under AWS-managed cache paths. Do not copy those cached files into the repo.

## Safe Identity Verification

These commands verify the active caller without reading SSM values, printing secrets, or mutating AWS:

```sh
aws sts get-caller-identity --profile aura-staging-operator --query "Arn" --output text
npm run credentials:check:local-release
```

PowerShell:

```powershell
aws sts get-caller-identity --profile aura-staging-operator --query "Arn" --output text
npm run credentials:check:local-release
```

Do not run `aws ssm get-parameter --with-decryption` as a credential check. Release-gate credential checks prove access shape; they do not print Parameter Store values.

## Required Local Environment

Set these variables before local staging smoke or release-gate checks. URL values below are non-secret when they are public staging or production origins.

| Variable | Required value | Secret? | Notes |
|---|---|---:|---|
| `AWS_PROFILE` | `aura-staging-operator` | No | Must use SSO / IAM Identity Center temporary credentials. |
| `AWS_REGION` | `ap-south-1` or the staging region | No | Must match the staging account region. |
| `SMOKE_TARGET_ENV` | `staging` | No | Prevents production smoke by default. |
| `SMOKE_BASE_URL` | staging frontend base URL | No | Must equal `STAGING_BASE_URL`. |
| `STAGING_BASE_URL` | staging frontend base URL | No | Non-secret URL. Must not be production. |
| `STAGING_FRONTEND_URL` | staging frontend URL | No | Non-secret URL. Use the Docker-hosted staging frontend after it is verified. |
| `STAGING_API_BASE_URL` | staging backend URL | No | Non-secret URL. Must not be production. |
| `STAGING_HEALTH_URL` | staging health URL | No | Non-secret URL. Usually `${STAGING_API_BASE_URL}/health`. |
| `STAGING_SSM_PREFIX` | `/aura/staging` | No | Required staging Parameter Store prefix. |
| `SMOKE_REQUIRE_BACKEND_STAGING` | `true` | No | Keeps smoke gates fail-closed. |
| `SMOKE_FORBID_PRODUCTION_ORIGINS` | `true` | No | Blocks staging-to-production fallback. |
| `PROD_BASE_URL` | production frontend URL | No | Non-secret comparison value only. Do not use as a staging target. |
| `PROD_API_BASE_URL` | production backend URL | No | Non-secret comparison value only. Do not use as a staging target. |
| `PROD_SSM_PREFIX` | `/aura/prod` | No | Comparison value only. |

For rollback readiness, also set the non-secret rollback artifact references expected by `npm run release:rollback-ready`, such as `AWS_DEPLOY_BUCKET`, `ROLLBACK_ARTIFACT_URI`, and `ROLLBACK_TARGET_SHA`, when that check needs live artifact proof. `ROLLBACK_TARGET_SHA` must point to a last-known artifact-backed release commit, not merely the latest PR or main commit. These values must refer to the expected staging or release artifact scope for the check being run.

## Example

Copy `.env.staging.local.example` to a local, untracked shell/session source if needed, then replace only the placeholder URLs.

```sh
export AWS_PROFILE=aura-staging-operator
export AWS_REGION=ap-south-1
npm run credentials:check:local-release
npm run smoke:staging
npm run smoke:staging:frontend
npm run aws:cost-guard
npm run aws:observability:guard
npm run release:rollback-ready
```

## Never Store Locally In This Repo

Never store these in `.env.staging.local`, docs, tests, screenshots, PR comments, or shell history snippets:

- AWS access key IDs, secret access keys, or manually copied session tokens.
- `STAGING_SSH_PRIVATE_KEY`.
- SSM SecureString values from the staging or production Parameter Store prefix.
- Database URLs, Redis URLs, JWT secrets, OTP secrets, auth vault secrets, Duo secrets, Keycloak client secrets, payment provider secrets, webhook secrets, or API tokens.
- Production role ARNs or production admin profiles in local staging files.

Use GitHub Actions OIDC for CI and AWS SSO for local work. If a gate asks for a secret value, treat that as a bug in the gate and stop.
