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
npm run staging:verify
```

This repackages the current commit, updates Docker Compose, reloads Nginx, and re-runs live route smoke.

Vercel note: `scripts/staging/09-set-vercel-vars.sh` creates or reuses a Vercel custom target named `staging`. If the Vercel API returns 403, do not use Preview as backend staging; grant project write permission or create the custom target in Vercel, then rerun the script.

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
- Confirm Vercel staging or preview public variables point to the staging backend only.

## Rollback

If a deployment fails but the instance is healthy:

1. Re-run `bash scripts/staging/07-deploy-compose.sh` from a known-good commit.
2. Run `npm run staging:verify`.
3. If verification still fails, stop the backend containers over SSH and leave Nginx returning failure rather than routing to production.

Never route staging traffic to production as a rollback.
