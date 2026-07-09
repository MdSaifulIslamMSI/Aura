# Aura CI/CD

Aura has two production entrypoints. Start here; do not reason from the reusable lane workflows first.

## Production Entry Points

| Workflow | When it runs | Purpose |
|---|---|---|
| `Production Release Gate On Main Push` (`.github/workflows/production-on-push.yml`) | Every push to `main`, plus confirmed manual dispatch | Runs preflight/staging gates on push; production lanes require manual `confirm_production=PRODUCTION`. |
| `Manual Production Command Center` (`.github/workflows/production-cicd.yml`) | Manual `workflow_dispatch` only | Runs selected deploy, rollback, desktop, or mobile lanes after typing `PRODUCTION`. |

Everything else is a reusable lane workflow called by one of those two entrypoints.

`Status Watch` (`.github/workflows/status-watch.yml`) is an observability layer, not a third deployment entrypoint. It listens for completed production, release, CI, quality, and security workflows and sends a notification only when `STATUS_WEBHOOK_URL` and `STATUS_WEBHOOK_TOKEN` are configured.

## Main Push Gate Flow

Every merge to `main` runs the non-mutating gate path. Production deployment
lanes are available only when the workflow is manually dispatched with
`confirm_production=PRODUCTION`.

1. Preflight
   - `npm run ci:doctor`
   - `npm run auth:env:validate`
   - `npm run auth:smoke`
2. Same-commit staging promotion gate
   - Dispatches and watches `.github/workflows/staging-ops-watch.yml`
   - Blocks production dispatches unless the staging gate succeeds
3. Production summary
   - Records that production deploy/release lanes were skipped on push

Confirmed manual dispatch can run the backend, storefront, gateway, desktop,
and mobile production lanes through the reusable workflows.

## Manual Command Center

Use `Manual Production Command Center` only for controlled operations:

- rerun one lane without waiting for a new merge
- deploy a selected surface
- roll back backend, storefront, AWS frontend, or gateway
- publish signed desktop/mobile releases when signing secrets are configured

Manual production actions require typing `PRODUCTION` into the workflow input.
Select lanes with comma-separated target inputs so the workflow remains within
GitHub's 10-input `workflow_dispatch` limit:

- `deploy_targets=backend,frontend-netlify,gateway`
- `release_targets=desktop,mobile`
- `rollback_targets=backend,frontend-netlify,frontend-aws,gateway`

Leave target inputs blank for no-op validation runs. Use only the target names
you intend to run.

## Required GitHub Settings

Repository settings:

- Actions must be enabled.
- Workflow permissions must allow `Read and write permissions` so `GITHUB_TOKEN` can publish desktop releases.
- Pull request workflows need permission to write PR comments if preview comments are desired.

Required repository secrets:

- `VERCEL_TOKEN`
- `NETLIFY_AUTH_TOKEN`

Optional for trusted Windows desktop releases:

PFX/Authenticode option:

- `WINDOWS_CODE_SIGNING_CERTIFICATE_BASE64`
- `WINDOWS_CODE_SIGNING_CERTIFICATE_PASSWORD`

Microsoft Trusted Signing option:

- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TENANT_ID`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `WINDOWS_CODE_SIGNING_PUBLISHER_NAME`

The free GitHub release lane can publish unsigned Windows desktop artifacts without these secrets, but those artifacts are internal testing builds only and may show Windows trust warnings. Set `require_windows_signing=true` only when you want the workflow to fail unless a PFX or Microsoft Trusted Signing path is fully configured.

Required repository variables or secrets:

- `NETLIFY_SITE_ID`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Optional repository variables:

- `NETLIFY_SITE_NAME`, defaults to `aurapilot`
- `VERCEL_PROJECT_NAME`, defaults to `app`

AWS deployment is configured through OIDC in `.github/workflows/deploy-backend-aws.yml`:

- `AWS_REGION`
- `AWS_DEPLOY_ROLE_ARN`
- `AWS_DEPLOY_BUCKET`
- `AWS_INSTANCE_TAG_KEY`
- `AWS_INSTANCE_TAG_VALUE`
- `AWS_PARAMETER_STORE_PATH_PREFIX`
- `AWS_DOCKER_PLATFORM`
- `AURA_BACKEND_ORIGIN` or `AWS_BACKEND_BASE_URL`

The workflows intentionally do not carry account-specific AWS resource defaults.

The backend deploy lane uses a native `ubuntu-24.04-arm` runner for the default `linux/arm64` image build. Keep that guard in place; building the backend image through QEMU emulation can crash during `npm ci` with `Illegal instruction` and block the full production release train.

The same backend deploy role must allow `ssm:PutParameter` only for the configured runtime prefix, such as `/aura/prod/*`. Re-run `infra/aws/bootstrap-github-oidc.ps1` after this policy changes so manual production admin access can update the allowlist in Parameter Store. Until that IAM refresh is applied, the admin workflow uses the existing SSM command channel to patch the EC2 runtime env and restart the API without committing secrets.

## Local GitHub Auth

Local `gh auth login` is not required for automated releases.

The desktop release workflow uses GitHub Actions `GITHUB_TOKEN` with `contents: write` to create tags, publish release assets, and update the latest release channel. If a local machine is not logged into GitHub CLI, pushes/releases from that machine can fail, but CI/CD still works once the workflow files are pushed to GitHub.

Local `npm run mobile:doctor` is cross-platform aware. On Windows it still runs the Capacitor doctor and verifies Android, but it treats missing Xcode as an expected local limitation because iOS release validation runs on the `macos-latest` GitHub runner.

## Manual Runs

Use `Actions > Manual Production Command Center > Run workflow` to manually run selected production stages.

Manual inputs let you:

- Skip backend, frontend, gateway, or desktop release stages.
- Set a specific desktop version like `1.2.0`.
- Skip the backend health check only in explicitly reviewed recovery runs.

## Public Gateway Access

The pipeline can deploy and alias the gateway, but Vercel Deployment Protection is a project setting. Disable Deployment Protection for the gateway project if `https://aura-gateway.vercel.app/` should be visible to public users without Vercel login.
