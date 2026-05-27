# Staging Operations Upgrades

Current status: Code is staging-safe, and live staging infrastructure is present.

This layer adds the remaining safe staging operations around the AWS Free Tier staging instance. It keeps Vercel custom staging out of the critical path because the current project is on the free Vercel plan; the active staging frontend is the Docker-hosted frontend on the AWS staging origin.

## What Is Active

| Capability | Command | Status |
| --- | --- | --- |
| Backend + frontend redeploy | `npm run staging:deploy` | Runs Compose deploy, Docker frontend deploy, and live staging smoke. |
| Staging backup | `npm run staging:backup` | Writes Postgres/Mongo/Redis staging backup artifacts to the private staging S3 bucket under `backups/`. It uses Docker on EC2 and falls back to SSM Run Command when SSH port 22 is unavailable. |
| Local observability | `npm run staging:observability` | Installs a systemd timer on the staging EC2 instance and writes JSONL health evidence to `/opt/aura-staging/logs/staging-health.jsonl`. |
| Cost watch | `npm run staging:cost-watch` | Reads Cost Explorer for tagged staging spend and compares it with `STAGING_MONTHLY_BUDGET_USD`. |
| HTTPS/domain | `npm run staging:https` | Skips unless `ENABLE_STAGING_HTTPS=true` and a real `STAGING_API_HOST` resolves to the staging EC2 public IP. |

## Fail-Closed Rules

- `STAGING_SSM_PREFIX` must be `/aura/staging`.
- `PROD_SSM_PREFIX` must be `/aura/prod`.
- The backup script refuses buckets that are not tagged `Environment=staging` and `ManagedBy=codex-staging-bootstrap`.
- The backup script does not stream backup archives through the laptop. It starts the Docker backup on EC2 and uploads from EC2 directly to S3. Set `STAGING_BACKUP_TRANSPORT=ssm` to bypass SSH entirely.
- HTTPS activation refuses to run unless DNS resolves to the staging EC2 public IP.
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
