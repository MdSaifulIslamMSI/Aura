# Backend-Origin Swap Runbook

One variable controls where every storefront finds the API. This runbook is the
entire procedure for changing it — for example on domain day
(`api.teamaura.tech`), when moving the backend edge, or when swapping CDN
providers.

## The single source of truth

`app/config/vercelRoutingContract.mjs` — `DEFAULT_HOSTED_BACKEND_ORIGIN`.

Everything else is generated from it by `app/scripts/sync_vercel_configs.mjs`
(`npm run configs:sync`), and CI enforces regeneration with `npm run
configs:sync-check` (frontend-quality job). Deploy-time builds and smoke tests
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
| `config/generated/backend-origin.json` | generated — consumed by `server/index.js` (backend CSP) and `desktop/runtimeServer.cjs` (desktop proxy default) |
| `scripts/env-contract-lib.mjs` `KNOWN_PRODUCTION_HOSTS` | imports the contract directly |
| CI builds, Vercel prebuilt config, Render parity env, Railway env push | repo variable `AURA_BACKEND_ORIGIN` |

## Swap procedure

1. Set the repo variable:
   `gh variable set AURA_BACKEND_ORIGIN --body "https://<new-origin>"`
2. Regenerate and commit:
   `AURA_BACKEND_ORIGIN=https://<new-origin> npm run configs:sync` → one commit
   containing every generated file (CI's `configs:sync-check` fails if any copy
   was missed).
3. AWS S3/CloudFront lane (infra, not rebuild): re-run
   `infra/aws/bootstrap-frontend-cloudfront.ps1` with
   `-BackendOrigin https://<new-origin>` so the distro's `/api`, `/socket.io`,
   `/health`, and `/uploads` behaviors target the new edge.
4. Deploy: command center → `deploy_targets=frontend-multihost` (and `backend`
   if the edge itself moved). The byte-coherence gate verifies all seven lanes
   serve identical bundles; auto-rollback protects the release.
5. Verify: `curl https://dbtrhsolhec1s.cloudfront.net/health/live` (or the new
   router), plus the production smoke tests in the deploy run.

## Guards that keep this honest

- `npm run configs:sync-check` — fails any PR whose committed generated files
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
