# @aurasec/route-security-matrix

Derive every Express route from source, require an explicit security posture per state-changing route, and live-probe unauthenticated requests in CI. Core library has **zero dependencies** (Express + supertest are injected); Node ≥ 20.

```sh
npm install --save-dev @aurasec/route-security-matrix
```

## Why this exists

Route security middleware in Express apps is composed per route file — one `router.post` here, an `adminGuard` there. That makes coverage impossible to prove by reading code: nothing stops a new state-changing route from merging with no auth at all. Code review cannot scale to hundreds of routes; a machine check can.

This package turns "every mutating route has a decided, *working* security posture" into two hard CI guarantees:

1. **Coverage** — every derived state-changing route must be declared in a posture inventory. A new route cannot merge without an explicit security decision recorded in config.
2. **Behavior** — every declared guarded route must actually reject an unauthenticated request (probed live through the real app via supertest), and declared-public routes must never 5xx. A guard that exists in code but doesn't fire is a test failure.

Built for and running in production CI ([Aura](https://github.com/MdSaifulIslamMSI/Aura)) since 2026-06, gating ~300 routes.

## How it works

```
router files (*.js) ──derive──▶ routes + mount prefixes ──▶ posture inventory ──▶ probe (unauthenticated)
       ▲                            │                            │                        │
  routeSecurityMatrix config ───────┘                    override / file default        posture verdict
  (mounts, postures, overrides)                            resolves the posture          401/403 ✓  5xx ✗ …
```

**Posture vocabulary** — the declared unauthenticated behavior of a route:

| Posture | Unauthenticated probe must return |
|---|---|
| `auth` | 401 or 403 |
| `admin` | 401 or 403 |
| `public` | anything under 500 (never a 5xx) |
| `preauth` | 4xx (validation/abuse controls run before any session exists) |
| `env-gated-public` | anything under 500 |
| `signed-assertion` | 4xx (trust comes from a request signature, not a session) |
| `webhook` | 4xx, or 503 when the receiver is deliberately unconfigured (fail-closed) |
| `skip` | excluded from probing — requires a justification in config |

A **503 on any guarded posture is a pass**: it is the deliberate fail-closed answer when a guard's downstream dependency (Redis, signature verifier, internal-auth secret) is absent from the runtime — stricter than 401, never a pass-through.

**Fail-closed by construction**: a route with no posture resolves to `undeclared` and fails the coverage test; a config with a misspelled posture throws at construction instead of silently weakening probes.

## Usage (Jest)

```js
// test/routeSecurityMatrix.security.test.js
const path = require('path');
const { createRouteMatrixTests } = require('@aurasec/route-security-matrix');
const matrixConfig = require('../config/routeSecurityMatrix'); // your posture data

const app = require('../index'); // your real express app

createRouteMatrixTests(
    { describe, test, expect, afterAll, setTimeout: (ms) => jest.setTimeout(ms) },
    {
        app,
        request: require('supertest'),
        routesDir: path.join(__dirname, '..', 'routes'),
        indexFile: path.join(__dirname, '..', 'index.js'),
        declarationHint: 'server/config/routeSecurityMatrix.js',
        ...matrixConfig,
    },
);
```

The posture-data config:

```js
// config/routeSecurityMatrix.js
module.exports = {
    // Router variable name → the prefix(es) index.js mounts it at.
    mountPrefixes: {
        authRoutes: ['/api/auth'],
        webhookRoutes: ['/api/webhooks'],
    },
    // Routers mounted with variable or zero prefixes (exempt from drift checks).
    variableMountRouters: ['metricsRoute'],
    // File-level default posture for every state-changing route in the file.
    routePostures: {
        authRoutes: 'auth',
        webhookRoutes: 'webhook',
    },
    // Per-route overrides, keyed "METHOD <mounted-path>".
    routePostureOverrides: {
        'POST /api/auth/logout': 'public',
    },
};
```

Set `ROUTE_MATRIX_REPORT=<path>` to dump every derived route with its posture and observed unauthenticated status as JSON — a complete route-security inventory for review.

## API

The machinery is importable piece by piece (all pure functions, injectable I/O):

```js
const {
    deriveRoutes,          // ({ routesDir, mountPrefixes, fsImpl? }) → [{ file, method, routePath, path }]
    deriveRoutesFromSource, // (source) → [{ method, routePath }]
    mutatingRoutes,        // (routes) → state-changing subset
    resolvePosture,        // (route, { routePostures, routePostureOverrides }) → posture
    statusSatisfiesPosture,// (status, posture) → boolean
    checkMountDrift,       // ({ indexSource, mountPrefixes, variableMountRouters? }) → { untracked, stale }
    resolveProbePath,      // (routePath, pathParamId?) → :params substituted
    createSupertestProbe,  // (app, request, pathParamId?) → async (route) => status
    createRouteMatrixTests,// (testRuntime, config) → registers the suite
} = require('@aurasec/route-security-matrix');
```

Notes:

- Route derivation reads `router.get/post/put/patch/delete('<literal>')` declarations from `*.js` files in `routesDir` (skipping `index.js`), expanded by `mountPrefixes`. Template-literal paths are captured raw (expressions not evaluated) and typically probe as harmless 404s — posture them `skip` if a guard posture would trip on that.
- `checkMountDrift` parses `app.use('/api/…', xRoutes)` mounts from your index file and fails on both **untracked** mounts (new router, no prefixes declared) and **stale** entries (prefixes declared, router gone). Middleware mounts are ignored.
- Param segments (`:id`) are replaced with a plausible 24-hex id by default so probes reach a route's own guards instead of a router-level 404.
- Only `GET` probes omit a body; all state-changing probes send `{}`.

## Requirements

- Node ≥ 20; `express` ≥ 4 and `supertest` ≥ 7 available at test time (they are your app's own dependencies — nothing is installed by this package).

## Security

Report vulnerabilities privately via [GitHub security advisories](https://github.com/MdSaifulIslamMSI/Aura/security/advisories) rather than public issues. See the repo's `SECURITY.md`.

## License

[Apache-2.0](./LICENSE)
