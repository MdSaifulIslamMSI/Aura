# Security Hardening: Derived Route-Security Matrix + Auth Token Blast Radius

## TL;DR

Three security changes with one shared motivation — the 2026-06-01 `SECURITY_ARCHITECTURE_REVIEW.md` found the auth *code* unusually strong (8/10) but its *coverage unprovable* and its *token blast radius too wide*:

1. **`test(security)`** — a new derived route-security matrix that proves, on every CI run, that all ~165 state-changing routes carry their declared security posture. A new unguarded route can no longer merge silently.
2. **`fix(security)`** — the matrix's first catch, fixed: `POST /api/recommendation-events` accepted anonymous write ingestion with no route-level rate limit.
3. **`fix(auth)`** — Firebase tokens no longer persist in browser localStorage on web (audit finding #10, the last open top-10 auth item).

Plus a docs commit recording verified secret-hygiene status and expanding the outstanding key-rotation runbook for the owner.

**No rewrite of auth.** The incremental strategy deliberately preserves the audited Firebase + HttpOnly-session architecture (120 auth/security test suites, 437-check security runner) and closes provable gaps instead.

---

## Context

| Source | Finding | Status before this PR | Resolution |
|---|---|---|---|
| `SECURITY_ARCHITECTURE_REVIEW.md` §9 "Fix this month" | "Build a central route security matrix and test that every state-changing route has expected auth, CSRF, validation, and rate-limit controls" | Missing | ✅ New matrix suite |
| Same review, finding #10 (Medium) | "Firebase tokens use browser local persistence" — XSS blast radius | Open (only remaining auth item in top-10 after the June hardening) | ✅ Session-scoped on web |
| `ROTATE_SECRETS_REQUIRED.md` | Historically committed Firebase/GCP API key; owner checklist blank | Open (owner-only) | 📋 Working-tree status verified + concrete runbook; console rotation remains owner action |
| *Discovered by the new matrix during this PR* | Anonymous recommendation-event ingestion had no route-level limiter (shared global budget only: 600 req / 15 min / IP) | Unknown | ✅ Dedicated limiter + regression proof |

## What changed

### 1. `test(security): enforce derived route-security matrix over all state-changing routes`

`server/tests/routeSecurityMatrix.security.test.js` — routes are **derived from source**, never hand-listed:

- **Derivation:** parses every `router.<method>(` literal in `server/routes/*.js` and resolves full paths through the `app.use('/api/...', router)` mounts in `server/index.js` (165 mutating routes across 44 files; nested mounts like `otpRoutes` under both `/api/otp` and `/api/auth/otp` included).
- **Coverage guarantee:** every derived route must be declared with a posture. Adding a state-changing route without a security decision **fails the suite** with the exact route list.
- **Behavior guarantee:** each declared route is probed unauthenticated via supertest and must match its posture:

| Posture | Unauthenticated probe must return | Used for |
|---|---|---|
| `auth` | 401 / 403 | user routes, orders, payments, checkout, listings… |
| `admin` | 401 / 403 | all 14 `admin*` route files |
| `preauth` | 4xx (validation + abuse controls fire pre-session) | OTP send/verify/reset, recovery-code verify, device bootstrap |
| `env-gated-public` | < 500 | AI chat/stream/voice (public only when `AI_PUBLIC_*_ACCESS_ENABLED`; production default off, proven by `productionGateRoutes.test.js`) |
| `signed-assertion` | 4xx | desktop owner-access token (cryptographic request verification) |
| `webhook` | 4xx, or 503 when receiver deliberately unconfigured (fail-closed) | Resend email webhooks, status webhooks |
| `public` | < 500 | catalog reads, status page, idempotent anonymous logout |

- **Mount-drift guarantee:** routers mounted in `index.js` must stay in sync with the matrix mount table (middleware-only mounts excluded), so a router can't escape the matrix by moving prefixes.
- **Maintenance mode:** `ROUTE_MATRIX_REPORT=<path> npx jest ...` dumps every derived route + observed unauthenticated status as JSON for inventory review.

### 2. `fix(security): rate-limit anonymous recommendation event ingestion`

`server/routes/recommendationEventRoutes.js` — adds a dedicated distributed limiter (60 req/min per user/IP in production, 120 in development, `securityCritical` fail-closed, keyed by authenticated user id before IP), matching the established telemetry-limiter pattern in `i18nRoutes.js`. Before this, anonymous event writes were bounded only by the shared global API budget — the same exposure class as the audit's Resend webhook flood finding.

### 3. `fix(auth): scope Firebase token persistence to the browser session on web`

`app/src/config/firebase.js`:

- **Web:** `browserLocalPersistence` → `browserSessionPersistence`. Tokens (incl. refresh token) no longer survive a full browser restart, so XSS/compromised-dependency access expires with the browsing session instead of persisting indefinitely.
- **Capacitor native:** keeps `browserLocalPersistence` — the WebView is OS-sandboxed and sessionStorage does not survive app cold start; native login longevity preserved.
- **Electron desktop:** unaffected by design — it authenticates through its own browser handoff (`desktop/browserAuthResult.cjs`) and never relied on web token persistence.

**Accepted tradeoff (reversible one-liner):** web users re-authenticate after fully closing the browser. Tab reloads and in-session navigation are unaffected. The server-side HttpOnly cookie session layer is untouched.

### 4. `docs(security): record verified working-tree secret hygiene, expand rotation runbook`

`ROTATE_SECRETS_REQUIRED.md` — records the verified 2026-09-06 working-tree status (`.env.production` removed; Android build injects `AURA_ANDROID_FIREBASE_API_KEY` via env with a non-secret placeholder default; `security:secrets` passes across 2,786 files) and expands the console checklist into concrete steps (locate key by fingerprint, delete + replace, Android package/SHA-1 + referrer + API-scope restrictions, post-rotation negative test). **Console-side rotation remains an owner action — still open.**

---

## Verification matrix

All commands run locally on this branch:

| Check | Command | Result |
|---|---|---|
| Route matrix (this PR) | `npx jest --runTestsByPath tests/routeSecurityMatrix.security.test.js` (server) | ✅ 165/165 probes + 2 structural tests |
| Limiter regression (this PR) | `npx jest --runTestsByPath tests/recommendationEventRateLimit.security.test.js` | ✅ 2/2 |
| Auth integration | `npm run security:auth` | ✅ 12 suites, 153/153 |
| Token security | `npm run security:tokens` | ✅ 4 suites, 52/52 |
| Targeted surfaces | `recommendationRoutes`, `rate-limit.bypass.security`, `config.headers.security`, `config.cors-csrf.security`, `adminRouteSurfaceSecurity` | ✅ 76/76 |
| Working-tree secrets | `npm run security:secrets` | ✅ 2/2 gates, 0 findings across 2,786 files |
| Frontend unit suite | `npm --prefix app test` | ✅ 183 files, 1,320/1,320 |
| Frontend build | `npm --prefix app run build` | ✅ (pre-existing chunk-size warning only) |
| Root regression tracer | `npm test` | ✅ 97 suites, 823/823 |
| History secret scan | `npm run security:gitleaks` | ⚠️ Requires Docker Desktop locally (was down); enforced in CI via `security.yml`, `security-gates.yml`, `ci.yml` |

## Regression proof (revert-the-fix)

With `server/routes/recommendationEventRoutes.js` reverted to `main`, the new limiter suite fails exactly as a guard should:

```
× caps anonymous ingestion per IP after the configured budget
  Expected: 429
  Received: 400
× spoofed IP headers do not reset the anonymous bucket
  Expected: 429
  Received: 400
Tests: 2 failed, 2 total
```

Re-applying the fix turns both green. The matrix suite additionally proves its coverage guarantee structurally: any route removed from the posture inventory, any new undeclared route, or any mount-table drift fails with an explicit message naming the route.

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Web users must re-login after a full browser restart (UX change) | Certain, by design | Native + desktop unaffected; in-session usage unaffected; single-line revert if product rejects the tradeoff |
| Matrix probes could be flaky (rate limiters, Turnstile) | Low | Distributed limiters self-disable under `NODE_ENV=test`; Turnstile/lockout surfaces classified `preauth` with 4xx expectations, not exact codes; suite runs in ~30 s standalone |
| Matrix becomes stale on new routers | Prevented | Mount-drift test + coverage test fail loudly instead of silently missing new routes |
| Session persistence breaks an untested consumer relying on cross-launch tokens | Low | All token access flows through Firebase SDK state (`onAuthStateChanged` / `getIdToken`); desktop + native verified independent; full app suite (1,320 tests) + build green |
| Line-ending churn | None | Commits normalized to LF matching repo blobs; diffs are surgical (26+3 / 82+1 / 39+3) |

## Out of scope / follow-ups

- **Owner action:** complete the Firebase/GCP key rotation checklist in `ROTATE_SECRETS_REQUIRED.md` (console steps provided). Until then the historically committed key must be treated as exposed.
- Deliberately **not** in this PR: splitting the 1,900–2,400-line auth middleware/controller/service files (maintainability-only churn), desktop release signing, Redis TLS, GitHub Action SHA-pinning — tracked in the audit roadmap.
- Future: extend the matrix with per-route CSRF/limiter-class assertions once route metadata is centralized (the posture inventory is the seam for it).
