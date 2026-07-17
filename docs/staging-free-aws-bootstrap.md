# Staging Free AWS Bootstrap

Current status: Code is staging-safe, and live staging infrastructure is present.

This bootstrap provisions a small isolated staging backend on AWS using the AWS CLI and the lowest-cost shape this repository can safely support:

- One EC2 instance running Docker Compose.
- Docker Postgres, Redis, MongoDB, and ClamAV on the private Compose network. Postgres is provisioned for the staging contract; MongoDB is included because the current backend runtime still requires `MONGO_URI`.
- Host Nginx proxying HTTP/HTTPS traffic to the backend on localhost and, when enabled, the Docker-hosted staging frontend.
- A private S3 bucket for staging uploads.
- SSM Parameter Store values under `/aura/staging`.
- GitHub staging environment variables.
- Optional Vercel staging frontend deployment that points to the isolated staging backend through `npm run staging:vercel:autopilot`.
- Docker-hosted staging frontend fallback through `npm run staging:frontend:docker` when Vercel custom staging or Preview env writes are blocked.
- A monthly AWS Budget guardrail.
- Optional staging operations: `npm run staging:deploy`, `npm run staging:backup`, `npm run staging:observability`, `npm run staging:cost-watch`, and fail-closed `npm run staging:https`.

It intentionally avoids NAT Gateway, ALB, RDS, ElastiCache, CloudFront, and Route53 unless explicitly enabled later. It never uses production DB, cache, storage, API, CloudFront, or SSM values as staging.

## Required Environment

Start from `config/environments/staging.example.env` and set real non-secret identifiers in your shell or CI environment. Do not commit real secrets.

Required:

```sh
AWS_REGION=ap-south-1
AWS_ACCOUNT_ID=123456789012
PROJECT_NAME=aura
STAGING_NAME=staging
STAGING_SSM_PREFIX=/aura/staging
STAGING_BUCKET_NAME=aura-staging-uploads-your-unique-suffix
STAGING_KEY_NAME=aura-staging-key
STAGING_ALLOWED_SSH_CIDR=YOUR_IP/32
STAGING_INSTANCE_TYPE=t3.micro
STAGING_ROOT_VOLUME_GB=20
STAGING_BUDGET_EMAIL=security@example.com
STAGING_MONTHLY_BUDGET_USD=30
GH_REPO=owner/repo
VERCEL_PROJECT_DIR=.
PROD_BASE_URL=https://production.example.com
PROD_API_BASE_URL=https://api.production.example.com
PROD_SSM_PREFIX=/aura/prod
```

Optional:

```sh
AWS_PROFILE=staging-admin
STAGING_API_HOST=staging-api.example.com
STAGING_FRONTEND_HOST=staging.example.com
STAGING_BASE_URL=https://staging.example.com
STAGING_API_BASE_URL=https://staging-api.example.com
STAGING_HEALTH_URL=https://staging-api.example.com/health
STAGING_BACKEND_IMAGE=ghcr.io/owner/aura-backend:staging
STAGING_CORS_ORIGIN=https://staging.example.com
STAGING_JWT_SECRET=generated-if-missing
STAGING_DATABASE_PASSWORD=generated-if-missing
STAGING_ADMIN_EMAIL=ops@example.com
ENABLE_CERTBOT=false
ENABLE_STAGING_HTTPS=false
ENABLE_EIP=false
ENABLE_ROUTE53=false
ENABLE_CLOUDWATCH_AGENT=false
STAGING_BACKUP_RETENTION_DAYS=14
STAGING_BACKUP_TRANSPORT=auto
ALLOW_NO_COST_WATCH=false
STAGING_DEPLOY_ENABLED=false
```

## Bootstrap

If the current AWS profile is an admin or bootstrap-admin profile, create the staging-only operator role and EC2 instance profile first:

```sh
npm run staging:iam:bootstrap
```

This creates or updates:

- `aura-staging-bootstrap-operator`: local operator role for staging bootstrap actions.
- `aura-staging-ec2-role`: EC2 runtime role for staging S3 and `/aura/staging` reads.
- `aura-staging-ec2-profile`: instance profile attached to the staging EC2 instance.
- local AWS profile `aura-staging-bootstrap`.

If the current AWS profile cannot manage IAM, this command fails before creating staging infrastructure. Use `STAGING_IAM_DRY_RUN=true npm run staging:iam:bootstrap` to render the policy documents under `.staging/` without changing AWS.

```sh
npm run staging:bootstrap
```

The script stops on the first hard failure. If the AWS Budgets API is denied, it fails unless `ALLOW_NO_BUDGET=true` is explicitly set. This prevents a staging environment from being created without cost visibility by accident.

## Verify

```sh
npm run staging:verify
```

Verification checks the fail-closed staging contract, live health route, route isolation for `/api`, `/uploads`, and `/socket.io`, S3 public access block, SSM `/aura/staging`, Docker Compose status, GitHub staging variables, and Vercel staging variables when the CLIs are available.

Successful live verification prints:

```text
PASS: live staging infrastructure is present
SUCCESS: Code is staging-safe, and live staging infrastructure is present.
```

If live staging is missing or unsafe, the expected status remains:

```text
Code is staging-safe, but live staging infrastructure is not present yet.
```

Latest run note: AWS staging infrastructure and GitHub staging variables are configured and `npm run staging:verify` passed. Vercel custom frontend staging is blocked by the current Vercel project capability, so the active live staging frontend is Docker-hosted on the AWS staging origin and verified with `npm run smoke:staging:frontend`.

## Operate

Use these commands after bootstrap:

```sh
npm run staging:deploy
npm run staging:backup
npm run staging:observability
npm run staging:cost-watch
```

If SSH is blocked or timing out during backups, force the AWS SSM control-plane path:

```sh
STAGING_BACKUP_TRANSPORT=ssm npm run staging:backup
```

HTTPS is intentionally separate. It runs only when a real staging host points at the staging EC2 public IP:

```sh
ENABLE_STAGING_HTTPS=true npm run staging:https
```

The operations layer is documented in `docs/staging-operations-upgrades.md`.

## Teardown

Teardown is guarded and only touches resources tagged `Environment=staging` and `ManagedBy=codex-staging-bootstrap`.

```sh
CONFIRM_DESTROY_STAGING=true npm run staging:teardown
```

Optional destructive cleanup:

```sh
CONFIRM_DESTROY_STAGING=true DELETE_STAGING_BUCKET=true DELETE_STAGING_SSM=true npm run staging:teardown
```

## Cost Warnings

- Use `t3.micro` or another Free Tier eligible instance type when available in the account.
- Use a 20 GB gp3 root volume unless you have a reason to increase it.
- Do not enable NAT Gateway, ALB, RDS, ElastiCache, CloudFront, Route53, Elastic IP, or Certbot/domain flows without understanding the cost and ownership model.
- The S3 bucket includes a lifecycle rule that expires objects under `uploads/` after 14 days.

## Safety Notes

- `/aura/prod` is rejected for staging.
- Production URLs are rejected for staging smoke.
- Vercel Preview is frontend-only unless its backend paths point to an isolated staging backend.
- `/api`, `/health`, `/uploads`, and `/socket.io` must not route to production.
- Secrets are stored in SSM as `SecureString` and are not printed by the scripts.

## Vercel Preview Rule

The committed `vercel.json` files may proxy production frontend backend paths to the production CloudFront origin for production deployment compatibility. That is not backend staging. The frontend staging autopilot generates deployment-specific Vercel routing that points backend paths at AWS staging, then `npm run smoke:staging:frontend` rejects any URL whose `/api`, `/health`, `/uploads`, or `/socket.io` paths resolve to production.

## Docker Frontend Rule

When Vercel cannot provide a usable staging target, `npm run staging:frontend:docker` builds `app/dist` with `VITE_API_URL=/api`, refuses to deploy if the bundle contains production hosts or `/aura/prod`, runs `nginx:alpine` on `127.0.0.1:8080`, and reloads host Nginx so the AWS staging origin serves the frontend at `/` while backend paths remain on the staging backend.
