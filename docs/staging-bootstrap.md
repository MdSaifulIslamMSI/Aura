# Staging Bootstrap

Current status: Code is staging-safe, but live staging infrastructure is not present yet.

## Required Resources

- Staging backend compute target with `Environment=staging` tags.
- Staging URL and health endpoint:
  - `STAGING_BASE_URL`
  - `STAGING_API_BASE_URL`
  - `STAGING_HEALTH_URL`
- AWS Systems Manager Parameter Store prefix: `/aura/staging`.
- Isolated staging database, cache, object storage, upload storage, and scanner runtime.
- Test payment/email/SMS/Firebase resources only; no live production keys.
- GitHub repository or environment variables:
  - `STAGING_BASE_URL`
  - `STAGING_API_BASE_URL`
  - `STAGING_HEALTH_URL`
  - `STAGING_SSM_PREFIX=/aura/staging`
  - `SMOKE_TARGET_ENV=staging`
  - `SMOKE_BASE_URL=${STAGING_BASE_URL}`
- Vercel preview may remain frontend-only. It must not be labeled backend staging while `/api`, `/health`, `/uploads`, or `/socket.io` route to production.

## Smoke Command

```sh
SMOKE_TARGET_ENV=staging \
SMOKE_BASE_URL="$STAGING_BASE_URL" \
STAGING_API_BASE_URL="$STAGING_API_BASE_URL" \
STAGING_HEALTH_URL="$STAGING_HEALTH_URL" \
STAGING_SSM_PREFIX=/aura/staging \
npm run staging:readiness
```

Only after preflight passes should a live staging smoke run:

```sh
npm --prefix server run smoke:staging
```

## Rollback

1. Stop staging deploy traffic at the staging edge or DNS record.
2. Roll back staging compute/image only; do not reuse production rollback scripts unless they explicitly target staging resources.
3. Preserve `/aura/staging` parameter history for diagnosis.
4. Rerun `npm run staging:readiness` before enabling staging smoke again.
