# Cloudflare Pages Storefront Deployment

Sixth storefront lane (Netlify, Vercel, AWS CloudFront, Render, Railway,
Cloudflare Pages). Unlike the source-building lanes, Cloudflare Pages receives
the shared CI artifact directly (`npx wrangler pages deploy`), so its bytes
are identical to the other artifact hosts **by construction** — and the
release byte gate verifies it anyway.

## Live service

- URL: `https://aura-storefront.pages.dev` (set `CLOUDFLARE_PAGES_PRODUCTION_URL`
  to override).
- Project: `aura-storefront` (`CLOUDFLARE_PAGES_PROJECT`), direct-upload mode
  with production branch `main` (set at project creation; direct-upload
  projects cannot switch to git integration later).
- Headers: the generated `cloudflare/_headers` file (CSP + security headers
  from `app/config/vercelRoutingContract.mjs`) is staged into the uploaded
  directory by the deploy job and checked as the seventh CSP copy by
  `scripts/security/check-csp-drift.mjs`.
- Routing: no `_redirects` file is generated. The bundle calls the hosted
  backend origin directly (same as Netlify/Vercel) and Pages' default SPA
  behavior routes unknown paths to `/index.html` (no `404.html` is deployed).
- Previews: none from CI. Cloudflare's native preview deployments would need
  git integration, which direct-upload mode does not offer.

## GitHub configuration (one-time)

- Secret `CLOUDFLARE_API_TOKEN` — API token with **Cloudflare Pages Edit**
  (plus the existing zone permissions if this token is shared with the WAF
  and cache scripts).
- Variable or secret `CLOUDFLARE_ACCOUNT_ID`.
- Optional variables `CLOUDFLARE_PAGES_PROJECT` and
  `CLOUDFLARE_PAGES_PRODUCTION_URL`.

Project creation is one-time: `npx wrangler pages project create
aura-storefront --production-branch=main` (or the deploy job's first run with
the same env).

## Rollback

- Auto: `rollback-cloudflare-storefront-on-production-failure` in the
  multi-host workflow and `rollback-frontend-cloudflare` in the command
  center run `scripts/rollback-cloudflare.sh`, which calls the Pages REST API
  `POST .../deployments/{id}/rollback` with the pre-mutation deployment id.
- Manual: dispatch `production-cicd.yml` with
  `rollback_targets=frontend-multihost` and
  `rollback_refs_json.cloudflare` set to the deployment id that was live
  before the bad release.

## What the byte gate checks

`verify_deployed_release_coherence.mjs` fetches
`https://aura-storefront.pages.dev` directly (no auth wall) and requires the
same release metadata and entry-bundle SHA-256 as the other six hosts. Pages
serves uploaded bytes as-is — the deprecated zone Auto Minify never applies
to Pages assets — so any mismatch means the uploaded directory drifted.
