# Railway Storefront Deployment

Fifth static storefront lane (Vercel, Netlify, AWS CloudFront, Render, Railway).
Same `app/dist` build, same backend proxy routes, same security headers — all
generated from `app/config/vercelRoutingContract.mjs`.

Railway builds from source (like Render) instead of receiving the shared CI
artifact, so byte identity is achieved by build-env parity and enforced by the
production coherence gate, not assumed.

## Live service (one-time, dashboard)

1. Railway Dashboard > New Project > Deploy from GitHub repo > select this repo.
2. Add a service for the storefront with:
   - Root Directory `app`
   - Config File `/app/railway.toml`
   - Dockerfile Path `Dockerfile.railway`
   - Watch Paths `/app/**`
3. `railway.toml` (generated, do not hand-edit) pins:
   `builder = "DOCKERFILE"`, `dockerfilePath = "Dockerfile.railway"`,
   `healthcheckPath = "/"`, `healthcheckTimeout = 300`,
   `restartPolicyType = "ALWAYS"`, `restartPolicyMaxRetries = 5`.
4. Generate a public domain (service Networking > Generate Domain), e.g.
   `https://<service>.up.railway.app`. The platform healthcheck hits `/`
   (the SPA shell) so frontend liveness stays decoupled from backend health.
5. Turn GitHub auto-deploy scoping to the `app/**` watch path only, so
   backend-only changes do not rebuild the storefront. Production releases
   stay CI-driven; native auto-rebuilds without release metadata would fail
   the coherence gate.

## GitHub configuration (required for production releases)

- Secret `RAILWAY_API_TOKEN` — account/workspace token
  (`Authorization: Bearer` to `https://backboard.railway.com/graphql/v2`).
- Variable (or secret) `RAILWAY_SERVICE_ID` — the storefront service.
- Variable (or secret) `RAILWAY_PROJECT_ID` — project id used to link the CLI.
- Variable (or secret) `RAILWAY_ENVIRONMENT_ID` — the production environment.
- Optional variable `RAILWAY_PRODUCTION_URL` — e.g.
  `https://aura-storefront.up.railway.app`; used for the post-deploy probe and
  the coherence-gate URL list.
- Backend `CORS_ORIGIN` / `RAILWAY_FRONTEND_URL` must include the Railway URL
  (see `server/config/corsFlags.js`); Duo/auth redirects already fall back
  through `RAILWAY_FRONTEND_URL` (see `resolveFrontendBaseUrl`).

## How the multi-host release deploys Railway

`deploy-railway-production` in `deploy-netlify.yml` mirrors Render's
parity-then-pinned-deploy discipline through `scripts/deploy-railway.sh`:

1. `build-frontend` captures the currently live Railway commit as the rollback
   ref (`railway_rollback_commit`; falls back to the release SHA when Railway is
   unreachable or nothing is live yet).
2. `scripts/railway-vars.cjs push` writes CI's exact VITE_* build contract
   onto the service with `--skip-deploys` and empty strings preserved via
   `--stdin`, snapshotting prior values first. The contract itself lives in
   `scripts/railway-release-env.cjs` (shared with the rollback lane).
3. `railway up ./app --path-as-root --ci --detach` uploads `app/` as the
   archive root (so `railway.toml`, `Dockerfile.railway`, and `Caddyfile`
   travel with it), then polls `railway deployment list --json` until
   `SUCCESS`; `FAILED` / `CRASHED` / `REMOVED` fail the release.
4. Prior service variables are restored on success *and* on failure.
5. `verify-production-coherence` includes the Railway URL, so all five hosts
   must serve the same release id, commit, target, channel, built-at, and
   SHA-256 entry bundle.
6. A failed coherence check triggers `rollback-railway.yml`
   (`scripts/rollback-railway.sh`), which overwrites `app/` with the captured
   commit, re-applies the same build env, re-uploads, polls, and restores vars.

The command center's `frontend-multihost` lane therefore already covers
Railway for both deploy and automatic post-failure rollback. A provider-keyed
manual `rollback_targets=frontend-multihost` rollback of Railway alone is still
done from the Railway dashboard (Deployments > last good > Rollback) or the
CLI; wiring a dedicated `rollback-frontend-railway` command-center job is an
optional follow-up.

## What the generated files wire

- `app/Dockerfile.railway` — multi-stage: `node:24-alpine` (same major as
  CI `NODE_VERSION`) runs `npm ci && npm run build`, then `caddy:2-alpine`
  serves `dist/` on `:{$PORT:3000}`. The `caddy fmt` step fails the build
  early on malformed Caddy syntax. Digest-pinning the base images is an
  optional hardening follow-up.
- `app/Caddyfile` (generated) — `auto_https off` (Railway terminates TLS),
  `trusted_proxies static private_ranges 100.0.0.0/8`, `encode gzip`,
  full security headers identical to Vercel/Netlify/Render, proxy handles
  `/socket.io`, `/socket.io/*`, `/api/*`, `/health*`, `/uploads/*` to the
  CloudFront backend edge, `try_files {path} /index.html` SPA fallback.
  `file_server` is always paired with `try_files` so real assets win.
- `app/railway.toml` (generated) — config-as-code for the service above.

## Byte-identical guarantee (same discipline as Render)

1. **Full build-env parity.** Before triggering a pinned deploy, write CI's
   entire VITE_* build env onto the Railway service
   (`railway variable set KEY=VALUE --service <svc> --environment <env>`),
   including empty strings (`railway variable set OPTIONAL_TOKEN=` keeps the
   key defined; `railway variable delete` removes it). Railway allows empty
   values, so follow the Netlify/Vercel parity rule, not the Render
   remove-empty-keys rule. Restore prior values once the deploy goes live.
2. **Byte gate.** `verify_deployed_release_coherence.mjs` requires the same
   release id, commit, target, channel, built-at, and SHA-256 entry bundle
   across all hosts (one CDN-propagation retry).

## Rollback

- Dashboard: Deployments > last good deployment > three dots > Rollback
  (only deployments with `canRollback: true`).
- CLI: `railway redeploy --service <svc> --yes` rebuilds the same source;
  `railway restart --service <svc> --yes` reuses the image without rebuilding.
- CI (follow-up): `scripts/rollback-railway.sh` + `rollback-railway.yml`
  mirroring `rollback-render.sh`, using `serviceInstanceDeployV2` /
  `deploymentRollback` via `https://backboard.railway.com/graphql/v2`.

## Regenerate after routing changes

`app/Caddyfile` and `app/railway.toml` are generated — never hand-edit:

```sh
npm run vercel:routing:sync
node scripts/security/check-csp-drift.mjs
```

The drift gate treats `app/Caddyfile` as the sixth CSP copy.
