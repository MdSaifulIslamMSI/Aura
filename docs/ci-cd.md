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

Required repository variables or secrets:

- `NETLIFY_SITE_ID`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Optional repository variables:

- `NETLIFY_SITE_NAME`, defaults to `aurapilot`
- `VERCEL_PROJECT_NAME`, defaults to `app`

AWS deployment is configured through OIDC in `.github/workflows/deploy-backend-aws.yml`:

- AWS region: `ap-south-1`
- Deploy role: `arn:aws:iam::942679464475:role/aura-github-actions-deploy`
- Deploy bucket: `aura-backend-deployments-942679464475-ap-south-1`
- Instance tag selector: `Name=aura-backend`
- Parameter Store prefix: `/aura/prod`

## Local GitHub Auth

Local `gh auth login` is not required for automated releases.

The desktop release workflow uses GitHub Actions `GITHUB_TOKEN` with `contents: write` to create tags, publish release assets, and update the latest release channel. If a local machine is not logged into GitHub CLI, pushes/releases from that machine can fail, but CI/CD still works once the workflow files are pushed to GitHub.

## Manual Runs

Use `Actions > Production CI/CD > Run workflow` to manually run all or selected production stages.

Manual inputs let you:

- Skip backend, frontend, gateway, or desktop release stages.
- Set a specific desktop version like `1.2.0`.
- Skip the backend health check when recovering from infrastructure issues.

## Public Gateway Access

The pipeline can deploy and alias the gateway, but Vercel Deployment Protection is a project setting. Disable Deployment Protection for the gateway project if `https://aura-gateway.vercel.app/` should be visible to public users without Vercel login.
