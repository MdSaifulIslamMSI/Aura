# Backend-Origin Swap Runbook

One variable controls where every storefront finds the API. This runbook is the
entire procedure for changing it — for example on domain day
(`api.teamaura.tech`), when moving the backend edge, or when swapping CDN
providers.

## The single source of truth

`app/config/vercelRoutingContract.mjs` — `DEFAULT_HOSTED_BACKEND_ORIGIN`.

Everything else is generated from it by `app/scripts/sync_vercel_configs.mjs`
(`npm run vercel:routing:sync`), and CI enforces regeneration with `npm run
vercel:routing:check` (repo-hygiene job). Deploy-time builds and smoke tests
override the committed default with the GitHub repo variable
`AURA_BACKEND_ORIGIN` (fallback `AWS_BACKEND_BASE_URL`).

## Auto-derived consumers (no hand edits anywhere)

| Consumer | Reads |
| --- | --- |
| `vercel.json`, `app/vercel.json` (rewrites + CSP headers) | generated |
| `netlify.toml`, `app/netlify.toml` (redirects + headers) | generated |
| `render.yaml` (routes + headers) | generated |
| `app/Caddyfile`, `app/railway.toml` (Railway lane) | generated |
| `cloudflare/_headers` (CSP) | generated |
| `app/index.html` + committed mobile copies (meta CSP) | generated |
| `gateway/index.html` (portal links) | generated |
| `app/capacitor.config.ts` (allowNavigation) | generated |
| `config/backend-origin.json` | generated — consumed by `server/index.js` (backend CSP) and `desktop/runtimeServer.cjs` (desktop proxy default) |
| `scripts/env-contract-lib.mjs` `KNOWN_PRODUCTION_HOSTS` | imports the contract directly |
| CI builds, Vercel prebuilt config, Render parity env, Railway env push | repo variable `AURA_BACKEND_ORIGIN` |

## Swap procedure

**Order matters.** The generator rewrites the hand-maintained files
(`gateway/index.html`, `app/capacitor.config.ts`) by searching for the
*currently committed* `DEFAULT_HOSTED_BACKEND_ORIGIN`. Edit the constant first
and those two files silently keep the old origin, because there is nothing left
to match. So set the repo variable and regenerate **before** committing the new
constant.

1. Set the repo variable:
   `gh variable set AURA_BACKEND_ORIGIN --body "https://<new-origin>"`
2. Regenerate and commit:
   `AURA_BACKEND_ORIGIN=https://<new-origin> npm run vercel:routing:sync` → one commit
   containing every generated file (the existing `vercel:routing:check` gate fails if any copy
   was missed).
3. Update the committed constant `DEFAULT_HOSTED_BACKEND_ORIGIN` in
   `app/config/vercelRoutingContract.mjs` to the same value, then confirm
   `npm run vercel:routing:check` is a no-op.
4. AWS S3/CloudFront lane (infra, not rebuild): re-run
   `infra/aws/bootstrap-frontend-cloudfront.ps1` with
   `-BackendOrigin https://<new-origin>` so the distro's `/api`, `/socket.io`,
   `/health`, and `/uploads` behaviors target the new edge.
5. Deploy: command center → `deploy_targets=frontend-multihost` (and `backend`
   if the edge itself moved). The byte-coherence gate verifies all seven lanes
   serve identical bundles; auto-rollback protects the release.
6. Verify: `curl https://dip82eloip5zb.cloudfront.net/health/live` (or the new
   router), plus the production smoke tests in the deploy run.

## Guards that keep this honest

- `npm run vercel:routing:check` — fails any PR whose committed generated files
  drift from the contract (wired into the frontend-quality CI job).
- `scripts/security/check-csp-drift.mjs` — the seven CSP copies must stay
  byte-identical (app/index.html, vercel.json, netlify.toml, render.yaml,
  app/Caddyfile, cloudflare/_headers, server Helmet config).
- `app/config/vercelRoutingContract.mjs` — rejects non-HTTPS and `*.sslip.io`
  origins for hosted deployments (`assertDeployableHostedBackendOrigin`).

## Notes

- Hosted lanes (Vercel/Netlify/Render/Railway/AWS) call the API **same-origin**
  (`/api`) through their platform proxy; the app bundle carries the absolute
  origin only for the proxy-less lanes (Cloudflare Pages, GitHub Pages) — see
  `app/src/services/runtimeApiConfig.js`.
- The backend edge hostname must remain HTTPS and must not be an sslip.io
  address for production deployments (contract guard).
- Historical context: this replaced the pre-2026-09 practice of pasting the
  CloudFront domain into each lane by hand; see the 2026-09 encryption-campaign
  follow-ups.
