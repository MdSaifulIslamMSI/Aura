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

Frontend staging note: Vercel custom staging is attempted first with `npm run staging:vercel:autopilot`. On this project, Vercel custom environments and branch-scoped Preview env writes are blocked, so the operational staging frontend is the Docker-hosted static frontend on the AWS staging instance.

```sh
npm run staging:frontend:docker
STAGING_FRONTEND_URL=$STAGING_API_BASE_URL npm run smoke:staging:frontend
```

The Docker frontend serves `/` from `nginx:alpine` on localhost and keeps `/api`, `/health`, `/uploads`, and `/socket.io` routed to the isolated AWS staging backend. A generated Vercel Preview URL is staging only after `npm run smoke:staging:frontend` proves those backend paths route to AWS staging instead of production.

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
