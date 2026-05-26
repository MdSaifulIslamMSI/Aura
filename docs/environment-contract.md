# Environment Contract

This repo fails closed when an environment is ambiguous. Preview is not staging unless it has an isolated backend, database/cache/storage, and SSM prefix.

## Production

- `PROD_BASE_URL`: production storefront URL.
- `PROD_API_BASE_URL`: production API/backend URL.
- `PROD_SSM_PREFIX=/aura/prod`.
- Production may use production CloudFront/backend URLs only in production deploy and explicitly guarded production smoke paths.

## Staging

- `STAGING_BASE_URL`: staging storefront or full-stack URL.
- `STAGING_API_BASE_URL`: isolated staging backend URL.
- `STAGING_HEALTH_URL`: staging backend health URL, normally `${STAGING_API_BASE_URL}/health`.
- `STAGING_SSM_PREFIX=/aura/staging`.
- `SMOKE_TARGET_ENV=staging`.
- `SMOKE_BASE_URL` must equal the staging URL and must never equal a known production URL.
- Staging must never proxy `/api`, `/health`, `/uploads`, or `/socket.io` to production.

## Preview

- Preview may exist for frontend review.
- Preview is not staging unless `STAGING_API_BASE_URL` points at an isolated backend and the preflight confirms backend routes do not proxy to production.
- Vercel Preview URLs are blocked for backend staging smoke when their backend paths route to production CloudFront.
- Vercel frontend staging may use a custom environment named `staging` or a Preview deployment generated from the `staging` branch. In both modes, `/api`, `/health`, `/uploads`, and `/socket.io` must route to the AWS staging backend and frontend smoke must pass before the URL is treated as staging.
- If Vercel cannot provide an unambiguous staging frontend, staging may use the Docker-hosted frontend on the AWS staging origin. In that mode `STAGING_FRONTEND_URL` may equal `STAGING_API_BASE_URL` only because `/` serves the static frontend and backend paths are same-origin staging routes.

## Local

- Local smoke may use only localhost, `127.0.0.1`, or `::1`.
- Local must never silently switch to production.

## Current Status

Code is staging-safe, and live staging infrastructure is present.

The Free Tier bootstrap contract is documented in `docs/staging-free-aws-bootstrap.md` and `docs/staging-runbook.md`. The latest live verification is recorded in `docs/staging-live-verification.md`. The active frontend staging mode is Docker-hosted on the AWS staging origin. Vercel frontend staging remains guarded by `npm run staging:vercel:autopilot`; generic Preview remains frontend-only unless `npm run smoke:staging:frontend` proves the URL routes backend paths to AWS staging.

Staging operations are documented in `docs/staging-operations-upgrades.md`. The operations scripts inherit this same contract: backups use the staging S3 bucket, cost watch reads staging-tagged resources, observability writes only on the staging EC2 instance, and HTTPS activation refuses to run unless staging DNS resolves to the staging EC2 public IP.
