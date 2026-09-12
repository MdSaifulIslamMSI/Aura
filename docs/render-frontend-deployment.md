# Render Storefront Deployment

Fourth static storefront lane (Vercel, Netlify, AWS CloudFront, Render).
Same `app/dist` artifact, same backend proxy rewrites, same security
headers — all generated from `app/config/vercelRoutingContract.mjs`.
Render is a full member of the coordinated multi-host release: the
`Deploy Frontend To Netlify, Vercel, AWS, And Render` workflow triggers a
Render deploy pinned to the release commit, verifies release coherence
against the other three lanes, and can auto-roll back on failure.

## Live service

- URL: `https://aura-storefront.onrender.com`
- Service: `aura-storefront` (static site, branch `main`, PR previews
  automatic).
- Routes/headers are managed to match `render.yaml`; after any routing
  change, regenerate the blueprint, then re-apply rules to the live service
  (Render API `PUT /services/{id}/headers`, `POST /services/{id}/routes`)
  or reconnect the Blueprint in the dashboard.

## Connect (one-time, dashboard)

1. Render Dashboard > New > Blueprint > select this repo.
2. Render detects `render.yaml` at the root and proposes service
   `aura-storefront` (static, free plan by default).
3. Apply. First deploy builds `npm run build --prefix app` and publishes
   `app/dist` on the `.onrender.com` subdomain; add a custom domain after.
4. Turn the service's branch **auto-deploy off** (Settings > Build & Deploy).
   CI now drives production deploys; the multi-host workflow fails closed
   if auto-deploy is still enabled, because a native auto-deploy rebuilds
   `main` without release metadata and would race the coordinated release.
   PR previews stay automatic.

## GitHub configuration (one-time)

- Secret `RENDER_API_KEY` — Render API key (Account Settings > API Keys).
- Variable (or secret) `RENDER_SERVICE_ID` — the `srv-…` id of
  `aura-storefront`.
- Optional variable `RENDER_PRODUCTION_URL` — defaults to
  `https://aura-storefront.onrender.com`.

## How the multi-host release deploys Render

Render builds from source instead of receiving the shared artifact, so the
deploy job (`deploy-render-production` in `deploy-netlify.yml`):

1. Captures the currently live deploy id **before** mutating (rollback
   target), alongside the Netlify/Vercel rollback refs.
2. Verifies `autoDeploy` is `no` on the service (fail-closed otherwise).
3. Temporarily sets service env vars `VITE_RELEASE_ID`, `VITE_RELEASE_TIME`,
   `VITE_DEPLOY_TARGET`, `VITE_RELEASE_CHANNEL` to the shared build's
   values, then triggers `POST /v1/services/{id}/deploys` with the release
   `commitId`. Without these, Render's build would stamp its own
   `builtAt`/`git-<sha>` release metadata and the production coherence gate
   would fail on every release.
4. Polls the deploy until `live` (build failures, cancels, and timeouts all
   fail the release), then restores the previous env var values.

The production coherence check then treats
`https://aura-storefront.onrender.com` as the fourth host, requiring the
same release id, commit, target, channel, and built-at timestamp as the
Netlify/Vercel/AWS lanes.

## Rollback

- Auto: when `auto_rollback_on_failure` (or the command center's
  `auto_rollback_on_smoke_failure`) is enabled, a failed multi-host
  release/smoke run calls `rollback-render.yml`, which runs
  `scripts/rollback-render.sh`.
- Manual: dispatch `production-cicd.yml` with
  `rollback_targets=frontend-multihost` and `rollback_refs_json.render`
  set to the deploy id that was live before the bad release.
- Mechanics: `POST /v1/services/{id}/rollback` re-serves the captured
  deploy's stored build artifact (fast, no rebuild); if artifact retention
  has expired, the hook falls back to a pinned rebuild of that deploy's
  commit. Render keeps the service's current redirects/rewrites/headers
  during rollback — those match `render.yaml`, so nothing else moves.

## What the blueprint wires

- Build: `npm run build --prefix app` → publishes `app/dist`.
- Rewrites (proxy, top-down): `/socket.io`, `/socket.io/*`, `/api/*`,
  `/health*`, `/uploads/*` → the CloudFront backend edge; `/*` →
  `/index.html` SPA fallback. Existing files always win over rules.
- Headers on `/*`: full CSP + deny/nosniff/referrer/COOP/CORP/
  Permissions-Policy set, identical to Vercel/Netlify (drift-gated).
- `previews.generation: automatic` — PR previews like the other lanes.
- `buildFilter: app/**, render.yaml` — backend-only changes skip rebuilds.

## Regenerate after routing changes

`render.yaml` is generated — never hand-edit:

```sh
npm run vercel:routing:sync
node scripts/security/check-csp-drift.mjs
```

The drift gate treats `render.yaml` as the fifth CSP copy.
