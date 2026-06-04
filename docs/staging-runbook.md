# Staging Runbook

Current status: Code is staging-safe, and live staging infrastructure is present.

## Bootstrap

1. Export the environment variables from `config/environments/staging.example.env`.
2. Confirm `STAGING_ALLOWED_SSH_CIDR` is a narrow CIDR such as `203.0.113.10/32`.
3. If the AWS profile can manage IAM, create the staging-only operator role and EC2 instance profile:

```sh
npm run staging:iam:bootstrap
```

4. Use the generated operator profile:

```sh
export AWS_PROFILE=aura-staging-bootstrap
```

5. Run:

```sh
npm run staging:bootstrap
```

The bootstrap creates or reuses staging-only resources. It does not fall back to production resources.

## Verify Health

```sh
node scripts/run-bash.mjs scripts/staging/07-deploy-compose.sh
npm run staging:verify
```

Expected live health fingerprint:

```json
{
  "ok": true,
  "env": "staging",
  "ssmPrefix": "/aura/staging",
  "database": "staging",
  "cache": "staging",
  "storage": "staging",
  "scanner": "ready"
}
```

If any field reports production, `/aura/prod`, a production host, or a not-ready scanner, staging smoke must fail.

## Deploy Updates

After the first bootstrap, re-run:

```sh
npm run staging:deploy
```

This repackages the current commit, updates Docker Compose, deploys the Docker-hosted staging frontend, reloads Nginx, and re-runs live route smoke. Use `npm run staging:verify` when you only want to verify the already deployed staging instance.

Frontend staging note: `npm run staging:deploy` bypasses Vercel and uses the Docker-hosted static frontend on the AWS staging instance. Run `npm run staging:vercel:autopilot` separately only after the Vercel project can safely write staging or branch-scoped Preview env values; otherwise the autopilot stops before creating a Preview URL.

```sh
npm run staging:frontend:docker
STAGING_FRONTEND_URL=$STAGING_API_BASE_URL npm run smoke:staging:frontend
```

The Docker frontend serves `/` from `nginx:alpine` on localhost and keeps `/api`, `/health`, `/uploads`, and `/socket.io` routed to the isolated AWS staging backend. A generated Vercel Preview URL is staging only after the autopilot proves the required env wiring and `npm run smoke:staging:frontend` proves those backend paths route to AWS staging instead of production.

## Aura MFA Staging Activation

Aura MFA is staged behind staging-only SSM parameters. Before running `scripts/staging/03-put-ssm-params.sh` with MFA enabled, confirm `/aura/staging/MFA_SECRET_ENCRYPTION_KEY` exists as a SecureString without printing its value:

```sh
aws ssm get-parameter --region ap-south-1 --name /aura/staging/MFA_SECRET_ENCRYPTION_KEY --query "Parameter.{Name:Name,Type:Type,Version:Version,LastModifiedDate:LastModifiedDate}" --output json
```

Generate a key with `npm run security:mfa-secret` and store it only in staging SSM if the parameter is missing. The staging SSM bootstrap writes `MFA_ENABLED=true`, TOTP, passkeys, and recovery codes on for staging while keeping `MFA_REQUIRED_FOR_ADMINS=false` for the first test pass.

See `docs/security/aura-mfa-staging-activation.md` for the Microsoft Authenticator checklist, admin step-up follow-up, and rollback command.

## Operations

Run a staging backup:

```sh
npm run staging:backup
```

The backup path uses Docker on the staging EC2 instance and uploads directly from EC2 to the staging S3 bucket. If port 22 is blocked or timing out, force the SSM path:

```sh
STAGING_BACKUP_TRANSPORT=ssm npm run staging:backup
```

Install or refresh the local EC2 health monitor:

```sh
npm run staging:observability
```

Check tagged staging spend against the monthly budget guard:

```sh
npm run staging:cost-watch
```

If an existing staging operator role predates cost watch, re-run `npm run staging:iam:bootstrap` so it receives the narrow `ce:GetCostAndUsage` read permission.

Activate HTTPS only after a real staging hostname resolves to the staging EC2 public IP:

```sh
ENABLE_STAGING_HTTPS=true npm run staging:https
```

See `docs/staging-operations-upgrades.md` for the fail-closed details.

## Teardown

```sh
CONFIRM_DESTROY_STAGING=true npm run staging:teardown
```

Use bucket and SSM deletion flags only when the staging data can be destroyed:

```sh
CONFIRM_DESTROY_STAGING=true DELETE_STAGING_BUCKET=true DELETE_STAGING_SSM=true npm run staging:teardown
```

## Incident Checks

- Confirm the EC2 instance has tags `Environment=staging` and `ManagedBy=codex-staging-bootstrap`.
- Confirm the security group exposes only ports 22, 80, and 443.
- Confirm S3 public access block is enabled.
- Confirm GitHub environment `staging` variables point to staging URLs only.
- Confirm Vercel staging or preview public variables point to the staging backend only, or confirm Docker frontend staging is the active frontend mode.
- Confirm `STAGING_FRONTEND_URL` is set only after frontend smoke passes.

## Rollback

If a deployment fails but the instance is healthy:

1. Re-run `bash scripts/staging/07-deploy-compose.sh` from a known-good commit.
2. Run `npm run staging:verify`.
3. If verification still fails, stop the backend containers over SSH and leave Nginx returning failure rather than routing to production.

Never route staging traffic to production as a rollback.
