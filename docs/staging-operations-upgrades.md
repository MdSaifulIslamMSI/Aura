# Staging Operations Upgrades

Current status: Code is staging-safe, and live staging infrastructure is present.

This layer adds the remaining safe staging operations around the AWS Free Tier staging instance. It keeps Vercel custom staging out of the critical path because the current project is on the free Vercel plan; the active staging frontend is the Docker-hosted frontend on the AWS staging origin.

## What Is Active

| Capability | Command | Status |
| --- | --- | --- |
| Backend + frontend redeploy | `npm run staging:deploy` | Runs Compose deploy, Docker frontend deploy, and live staging smoke. |
| Staging backup | `npm run staging:backup` | Writes Postgres/Mongo/Redis staging backup artifacts to the private staging S3 bucket under `backups/`. It uses Docker on EC2 and falls back to SSM Run Command when SSH port 22 is unavailable. |
| Local observability | `npm run staging:observability` | Installs a systemd timer on the staging EC2 instance and writes JSONL health evidence to `/opt/aura-staging/logs/staging-health.jsonl`. |
| Live staging DAST | `staging-ops-watch.yml` | Runs `npm run security:free-scanners -- --only=zap-baseline` against explicit `STAGING_URL` after staging smoke passes, fails if the target is missing, and uploads the ZAP artifacts. |
| Cost watch | `npm run staging:cost-watch` | Reads Cost Explorer for tagged staging spend and compares it with `STAGING_MONTHLY_BUDGET_USD`. |
| Direct HTTPS/domain | `npm run staging:https` | Uses Certbot when `STAGING_HTTPS_MODE=direct` and the hostname resolves to staging EC2. |
| Free CloudFront HTTPS edge | `npm run staging:https:cloudfront` | One-time bootstrap for a dedicated AWS-managed `cloudfront.net` hostname, free TLS origin, disabled caching, and staging-only origin verification. |

## Fail-Closed Rules

- `STAGING_SSM_PREFIX` must be `/aura/staging`.
- `PROD_SSM_PREFIX` must be `/aura/prod`.
- The backup script refuses buckets that are not tagged `Environment=staging` and `ManagedBy=codex-staging-bootstrap`.
- The backup script does not stream backup archives through the laptop. It starts the Docker backup on EC2 and uploads from EC2 directly to S3. Set `STAGING_BACKUP_TRANSPORT=ssm` to bypass SSH entirely.
- HTTPS activation refuses to run unless DNS resolves to the staging EC2 public IP.
- CloudFront bootstrap creates or reuses only the distribution tagged `Environment=staging` and `ManagedBy=codex-staging-bootstrap`; it never reuses the production distribution.
- CloudFront mode requires an HTTPS-only origin, the AWS-managed default viewer certificate, no aliases, and exact matching origin secrets in CloudFront and `/aura/staging`.
- `ENABLE_CLOUDWATCH_AGENT=true` is intentionally blocked until a retention and cost plan exists.
- GitHub staging deployment requires both the workflow input and the staging environment variable `STAGING_DEPLOY_ENABLED=true`.
- `npm run staging:deploy` keeps Vercel out of the deploy path and uses the Docker-hosted AWS frontend plus smoke checks. `npm run staging:vercel:autopilot` is separate and stops before creating a Preview URL if staging or branch-scoped Preview env writes fail.
- The staging operator role grants Cost Explorer only the `ce:GetCostAndUsage` read needed by `npm run staging:cost-watch`.

## GitHub Workflows

- `staging-aws-deploy.yml` is manual-only and deploys only after explicit staging enablement, an AWS staging deploy role, and a staging SSH key are present.
- `staging-ops-watch.yml` runs staging contract validation, production fallback scanning, backend smoke, frontend smoke, and optional cost watch.

## Domain And HTTPS

The free staging system remains valid over the EC2 HTTP origin. To turn on HTTPS, first point a real staging hostname at the EC2 public IP, then set:

```sh
ENABLE_STAGING_HTTPS=true
STAGING_API_HOST=staging.example.com
STAGING_ADMIN_EMAIL=ops@example.com
```

Then run:

```sh
npm run staging:https
npm run staging:verify
```

If DNS points anywhere else, the script exits before calling Certbot.

For the no-domain-cost path, use a dedicated CloudFront default hostname. The bootstrap derives a free TLS origin hostname from the isolated staging IP, installs an auto-renewed certificate on EC2, creates a separate uncached distribution, and stores a create-once origin-verification secret without printing it:

```sh
AWS_PROFILE=staging-admin STAGING_HTTPS_MODE=cloudfront npm run staging:https:cloudfront
```

Record the returned distribution ID, CloudFront hostname, and origin hostname as the GitHub `staging` environment variables `STAGING_CLOUDFRONT_DISTRIBUTION_ID`, `STAGING_API_HOST`, and `STAGING_ORIGIN_HOST`. Set `STAGING_HTTPS_MODE=cloudfront`, `ENABLE_STAGING_HTTPS=true`, and make every staging URL use the returned HTTPS CloudFront origin. CloudFront pricing and AWS free-plan terms can change; the script minimizes cost but does not claim the EC2 backend is free forever.

## Admin Security Qualification Phases

Admin security qualification is opt-in. `STAGING_ADMIN_SECURITY_PHASE=legacy` preserves the existing HTTP staging behavior and remains the default.

| Phase | Backend V2 | Frontend V2 | Purpose |
| --- | --- | --- | --- |
| `legacy` | Off | Off | Existing HTTP-compatible staging behavior. |
| `baseline` | Off | Off | HTTPS, passkey, allowlist, Redis, and secret prerequisites are present before V2 activation. |
| `backend` | On | Off | Exercise the authoritative backend state, recovery, challenge, and audit surfaces before exposing the V2 UI. |
| `frontend` | On | On | Exercise the complete checkpoint flow after backend evidence and rollback are approved. |

Every non-legacy phase requires:

```sh
ENABLE_STAGING_HTTPS=true
STAGING_API_HOST=admin-staging.example.com
STAGING_BASE_URL=https://admin-staging.example.com
STAGING_FRONTEND_URL=https://admin-staging.example.com
STAGING_API_BASE_URL=https://admin-staging.example.com
STAGING_HEALTH_URL=https://admin-staging.example.com/health
STAGING_ADMIN_EMAIL=ops@example.com
STAGING_ADMIN_ALLOWLIST_EMAILS=owner-one@example.com,owner-two@example.com
STAGING_ADMIN_DUO_PROVIDER=false
STAGING_ADMIN_RECOVERY_TWO_PERSON_REQUIRED=false
```

The hostname must be dedicated to staging, resolve to the tagged staging EC2 public IP, and differ from every production hostname. The email values should be provided as staging-environment secrets in GitHub. The Duo and two-person values must be explicit `true` or `false`; the scripts never infer them from repository ownership.

During a non-legacy deploy, `scripts/staging/16-deploy-all.sh` establishes HTTPS first, writes the reviewed admin-security Parameter Store names, deploys the backend and frontend, and then runs staging verification. Dedicated admin-security and trusted-device hashing secrets are generated only when their secure parameters do not already exist. Existing secure parameters are retained and no secret value is printed.

The `baseline` phase must precede `backend`, and `backend` evidence must precede `frontend`. A phase change is a staging mutation and does not authorize migration, recovery-grant issuance, Redis interruption, provider outage simulation, or production activation.
