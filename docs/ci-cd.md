# Aura CI/CD

Aura production delivery is coordinated by `.github/workflows/production-cicd.yml`.

## Flow

On every push to `main`, GitHub Actions now runs:

1. `CI`
   - Backend regression tests
   - AWS runtime contract audit
   - Backend container build smoke test
   - Frontend lint, tests, build, and bundle budget
   - Frontend E2E tests on `main`
   - Gateway static download-link guard
   - Desktop packaging smoke test
2. `Deploy Backend To AWS`
   - Builds the backend container
   - Uploads release artifacts to S3
   - Deploys through SSM to the tagged EC2 instance
   - Verifies backend readiness
3. `Deploy Frontend To Netlify And Vercel`
   - Builds the storefront once
   - Publishes production Netlify
   - Publishes production Vercel
4. `Deploy Gateway To Vercel`
   - Publishes the static gateway
   - Re-points `aura-gateway.vercel.app`
5. `Desktop Release`
   - Builds Windows, macOS, and Linux packages on native GitHub runners
   - Publishes a GitHub Release
   - Marks it as latest so desktop auto-update and gateway download buttons resolve automatically
   - Runs only after CI and the selected production deploy jobs succeed

The old deploy workflows are still available for manual runs and pull-request previews, but production push delivery is owned by `Production CI/CD`.

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

The free GitHub release lane can publish unsigned Windows desktop artifacts without these secrets. Set `require_windows_signing=true` only when you want the workflow to fail unless a PFX or Microsoft Trusted Signing path is fully configured.

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

## Local GitHub Auth

Local `gh auth login` is not required for automated releases.

The desktop release workflow uses GitHub Actions `GITHUB_TOKEN` with `contents: write` to create tags, publish release assets, and update the latest release channel. If a local machine is not logged into GitHub CLI, pushes/releases from that machine can fail, but CI/CD still works once the workflow files are pushed to GitHub.

## Manual Runs

Use `Actions > Production CI/CD > Run workflow` to manually run all or selected production stages.

Manual inputs let you:

- Skip backend, frontend, gateway, or desktop release stages.
- Set a specific desktop version like `1.2.0`.
- Skip the backend health check only in explicitly reviewed recovery runs.

## Public Gateway Access

The pipeline can deploy and alias the gateway, but Vercel Deployment Protection is a project setting. Disable Deployment Protection for the gateway project if `https://aura-gateway.vercel.app/` should be visible to public users without Vercel login.
