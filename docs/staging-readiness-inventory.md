# Staging Readiness Inventory

Current status: Code is staging-safe, but live staging infrastructure is not present yet.

| Source | Classification | Safe? | Production fallback? | Required change |
| --- | --- | --- | --- | --- |
| `package.json` | Repo command contract | Safe | No | Keep `env:validate`, `smoke:preflight`, `staging:readiness`, and `scan:prod-fallbacks` as the canonical local/CI entrypoints. |
| `scripts/env-contract-lib.mjs` | Canonical environment policy | Safe | No | Keep all smoke, scanner, and workflow guards aligned to this policy. |
| `scripts/validate-env-contract.mjs` | Repo-wide contract validator | Safe | No | Run in PRs and before smoke. |
| `scripts/smoke-preflight.mjs` | Network-before preflight | Safe | No | Require target classification before live requests. |
| `scripts/scan-prod-fallbacks.mjs` | Regression scanner | Safe | No | Keep in CI to block staging-to-production fallback patterns. |
| `vercel.json` | Production-backed frontend routing | Safe for production, unsafe as staging | Yes for `/api`, `/health`, `/uploads`, `/socket.io` | Preview must be treated as frontend-only unless isolated staging backend routes are configured. |
| `netlify.toml` | Production-backed frontend routing | Safe for production, unsafe as staging | Yes for `/api`, `/health`, `/uploads`, `/socket.io` | Do not use Netlify preview as backend staging while redirects target production CloudFront. |
| `app/config/vercelRoutingContract.mjs` | Hosted frontend routing generator | Safe for production and preview frontend | Yes when preview uses production backend origin | Comments and preflight make this frontend-preview only unless `STAGING_API_BASE_URL` is isolated. |
| `gateway/vercel.json` | Static gateway deployment | Production/preview gateway only | No backend staging contract | Do not use gateway preview as backend staging. |
| `.github/workflows/ci.yml` | PR quality gate | Safe after env contract checks run | No live smoke by default | Run `env:validate`, `smoke:preflight`, and `scan:prod-fallbacks` on PRs. |
| `.github/workflows/security.yml` | Security gate with optional ZAP | Safe after preflight patch | Was guarded only by `STAGING_URL` | Run preflight and fallback scan before scanners; require staging contract before ZAP. |
| `.github/workflows/security-gates.yml` | Security and DAST gate | Safe after guarded target resolution | Local preview fallback only for ZAP | Validate staging vars before external staging scans. |
| `.github/workflows/free-security-scanners.yml` | Scheduled/manual free scanners | Safe after preflight env wiring | Was guarded only by `STAGING_URL` | Pass staging contract vars into scanner script. |
| `.github/workflows/production-cicd.yml` | Production deployment | Production-only | Intended production URLs | Keep production smoke read-only and guarded by `ALLOW_PRODUCTION_SMOKE=true`. |
| `.github/workflows/deploy-backend-aws.yml` | Backend production deploy | Production | Uses production backend vars and health | Staging deploy must be a separate environment using `/aura/staging`, not this production job. |
| `.github/workflows/deploy-frontend-aws.yml` | Frontend production deploy | Production | Uses production backend origin for `/api` | Staging frontend deploy must pass isolated staging backend origin. |
| `.github/workflows/deploy-netlify.yml` | Netlify production deploy | Production plus hosted preview artifact | Uses production backend origin when configured | Do not label Netlify preview as backend staging. |
| `.github/workflows/deploy-gateway-vercel.yml` | Gateway deploy | Production gateway | No staging backend | Gateway preview remains frontend/gateway review only. |
| `.github/workflows/rollback-*.yml` | Production rollback | Production | Intended production rollback vars | Add staging rollback workflow only when staging infra exists. |
| `.github/workflows/desktop-release.yml` | Desktop release | Production backend origin | Uses production backend origin | Desktop preview/release is not backend staging. |
| `server/scripts/staging_smoke.js` | Live smoke runner | Safe only behind preflight | No explicit production fallback | Require `scripts/smoke-preflight.mjs` through package workflow before live requests. |
| `server/scripts/assert_staging_smoke_safety.js` | Existing staging safety preflight | Safe after alignment | Blocks known production signals | Align with root environment contract and require `/aura/staging` for staging. |
| `scripts/post-merge-security-smoke.mjs` | Post-merge security checks | Safe | Skips live staging without `SMOKE_BASE_URL` | Keep live staging optional and preflighted. |
| `scripts/security-free-scanners.mjs` | Scheduled scanner orchestrator | Safe after preflight patch | Previously only compared explicit production URL vars | Validate full staging contract before ZAP. |
| `scripts/security/run-docker-tool.mjs` and `scripts/security/zap-baseline.sh` | Docker scanner wrappers | Safe behind callers | Caller supplies target | Keep ZAP target validation in workflow/script callers. |
| `scripts/smoke-production-login.mjs` | Production smoke | Production-only | Intended production URL | Keep separate from staging and require production smoke allow flag through preflight. |
| `scripts/smoke-origin-protection.mjs` | Production/origin protection smoke | Production-only | Intended production edge/direct origins | Do not reuse for staging without separate staging variables. |
| `infra/aws/docker-compose.ec2.yml` | Production EC2 runtime | Production | Uses production runtime path | Add staging equivalent only when staging infra is provisioned. |
| `infra/aws/bootstrap-free-tier.ps1` | AWS production bootstrap | Production default | Defaults to `/aura/prod` | Do not run for staging without explicit staging prefix and isolated resources. |
| `infra/aws/bootstrap-instance-user-data.sh` | EC2 bootstrap user data | Production default | Uses `/aura/prod` | Needs staging-specific user data before staging EC2 exists. |
| `infra/aws/github-oidc.env` | Production OIDC bootstrap example | Production | Uses `/aura/prod` | Create a staging OIDC/env contract separately. |
| `infra/aws/sync-parameter-store-env.ps1` | SSM sync helper | Ambiguous by caller | Caller-controlled prefix | Staging use must pass `/aura/staging`; production docs keep `/aura/prod`. |
| `infra/aws/deploy-release.sh` and rollback scripts | Production EC2 release/rollback | Production | Uses production runtime env | Add staging release wrapper only after staging compute exists. |
| `infra/aws/bootstrap-frontend-cloudfront.ps1` | CloudFront frontend bootstrap | Production by current vars | Proxies `/api`, `/health`, `/uploads`, `/socket.io` to configured backend | Staging CloudFront must target staging backend origin. |
| `infra/aws/waf-login-security-cloudfront.yml` | Edge WAF | Production/staging-capable template | No URL fallback | Tune and attach separately per environment. |
| `infra/edge/**` | Local/staging edge templates | Local/staging candidate | No production fallback | Safe for isolated staging tests, not a staging target by itself. |
| `docker-compose.split-runtime.yml` | Local split runtime | Local | No production fallback | Keep local scanner/runtime wiring; not a staging target. |
| `docker-compose.yml` | Local/dev runtime | Local with ClamAV profile | No production fallback | Safe local runtime contract for upload malware scanning. |
| `desktop/runtimeServer.cjs` | Desktop proxy | Local/desktop production backend | Uses configured backend origin | Desktop proxy is not a staging backend and must not be a staging smoke target. |
| `docs/aws-backend-deployment.md` | Production AWS docs | Production | `/aura/prod` expected | Add separate staging bootstrap contract instead of reusing production. |
| `docs/aws-frontend-deployment.md` | Production frontend docs | Production | Uses production frontend/backend vars | Keep production-only; staging docs are separate. |
| `docs/login-staging-production-activation.md` and login staging docs | Historical staging guidance | Staging guidance | No live staging target present | Keep guidance subordinate to `docs/environment-contract.md`. |
| `docs/auth-free-security-inventory-2026-05-24.md` | Security inventory | Mixed local/staging/production notes | No smoke fallback | Current status points staging URL as missing. |
| `docs/upload-security-operations.md` | Upload malware runtime docs | Local/staging-ready | No production fallback | ClamAV/YARA runtime documented without secrets. |
| `config/environments/staging.example.json` | Staging contract example | Safe | `allowProductionFallback=false` | Replace example URLs with real staging values when staging exists. |
| GitHub repository variables | External config | Not fully configured for staging | Current known variables are production-focused | Add `STAGING_BASE_URL`, `STAGING_API_BASE_URL`, `STAGING_HEALTH_URL`, `STAGING_SSM_PREFIX=/aura/staging` before live staging smoke. |
| Vercel Preview deployments | External preview evidence | Frontend-only | Backend paths proxy to production CloudFront | Must fail backend staging smoke until isolated backend routing exists. |
| AWS SSM Parameter Store | External runtime config | Production prefix exists; staging missing | `/aura/prod` exists, `/aura/staging` absent | Provision `/aura/staging` before staging deploy/smoke. |

## Discovered Preview Reality

Recent GitHub deployment records include Vercel Preview URLs, but the checked-in Vercel routing sends backend paths to production CloudFront. Those URLs are frontend preview only and must fail backend staging smoke preflight.

## Current Status

Code is staging-safe, but live staging infrastructure is not present yet.
