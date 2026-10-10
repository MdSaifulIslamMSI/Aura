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

## Host-side headers do not follow a repo change

Regenerating config proves the *committed files* agree. It does not prove a host
serves them. Two lanes failed that way on 2026-10-10 while every in-repo gate
stayed green:

- **Cloudflare Pages** merges every matching `_headers` block by appending
  values rather than letting the most specific block win. Emitting the full
  security set on `/*`, `/`, and `/index.html` concatenated the ~3 KB CSP past
  Cloudflare's header limit and Cloudflare dropped `Content-Security-Policy`
  entirely, so the lane silently fell back to the weaker meta CSP. The
  generator now emits disjoint blocks (security headers on `/*` only, cache
  tiers only on their own paths), guarded by a test that asserts every security
  header appears exactly once.
- **Render** only re-applies `render.yaml` `headers:` when its Blueprint is
  re-applied, which CI never triggers — the deploy job only PUTs env vars and
  starts a build. After an origin swap the served CSP header stays pinned to the
  previous origin until someone re-applies the Blueprint in the Render
  dashboard. The effective policy is then the intersection of a stale header
  and the current meta tag, which is stricter than intended.

`scripts/smoke/assert-served-security-headers.mjs` probes every production
lane and fails when a CSP header is present but does not name the current
origin, or still names a retired one. It runs **blocking** in the production
smoke job (promoted from advisory on 2026-10-10 once every lane was verified
serving the current origin), and retries a failing lane before recording the
finding so a storefront still propagating a just-finished deploy cannot fail a
release. A lane with no CSP header at all (GitHub Pages cannot set headers) is
reported, not failed — those lanes rely on the meta CSP, which the drift gate
keeps in sync.

Render's routes and headers are pushed from the same committed `render.yaml`
by `scripts/render/sync-render-edge-config.mjs`, driven by the
`Render Edge Config Sync` workflow. That workflow is check-only unless
`apply` is set, and it backs up the live rules before replacing them. Run it
after any origin change that lands in `render.yaml`, otherwise the Render lane
keeps serving the previous edge even though every committed file is correct.

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
