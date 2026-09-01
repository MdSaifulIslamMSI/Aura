# Phase 8 — Total Egress Closure (no unguarded outbound HTTP)

Completes the egress track (phase 6: `phase6-egress-defense.md`, phase 7:
`phase7-egress-adoption.md`). Every outbound HTTP call in production service
code now goes through `guardedFetch`, which enforces the remote-fetch policy
on every redirect hop, strips credential headers before following, caps hops,
and — for user-influenced destinations — refuses private/metadata targets at
validation and connect time.

## What this adds

1. **Operator internal-target allowance** — `guardedFetch(..., { allowPrivateTarget: true })`.
   Some operator-configured destinations are legitimately internal
   (self-hosted Ollama, LibreTranslate, LocalStack, allowlisted status
   monitors, enterprise Keycloak on a private network). For those the caller
   pins the host via `allowedHosts` (derived from operator configuration) and
   opts out of the private-target denial; the allowlist is still enforced on
   every hop and credentials are still stripped on redirects.
2. **Migrated call sites** (node-fetch v2 → global fetch + `guardedFetch`):
   - `services/ai/geminiGatewayService.js` — API requests (API-key bearing,
     host pinned to the configured base URL) and user-influenced remote
     inline media (full user-mode validation happens in
     `validateRemoteMediaUrl`; the fetch itself now runs through the safe
     egress agent, replacing the old `redirect: 'error'` with an explicit
     `maxRedirects: 0` policy rejection).
   - `services/auth/keycloakOidcService.js`, `services/auth/oidcTokenVerifier.js`,
     `services/duoOidcService.js` — OIDC discovery/token/JWKS fetches
     (identity-critical; https-only enforcement stays in each service).
   - `services/ai/ollamaGatewayService.js`,
     `services/translation/providers/libreTranslateProvider.js` —
     self-hosted AI/translation endpoints.
   - `services/statusService.js` — status monitor HTTP checks (the existing
     `assertAllowedMonitorUrl` allowlist/private policy decides reachability;
     the guard adds redirect policy).
   - `services/payments/foundation/billingProvider.js`,
     `services/payments/foundation/hyperswitchProvider.js` — default
     `fetchImpl` now wraps `guardedFetch` (injected `fetchImpl` in tests is
     untouched).
   - `services/studentPackSecurityHarnessService.js` — LocalStack health probe.
3. **Source contracts extended** — `operatorEgress.test.js` pins all 15
   migrated files to `guardedFetch` with no remaining raw `await fetch(`.

## Failure semantics

- Redirect to a host outside the configured allowlist, refusal at connect
  time, or an exhausted hop cap fails the call; existing per-service error
  normalization maps that to the service's standard network/retryable error.
- Test suites that previously mocked the `node-fetch` module now stub
  `globalThis.fetch`; one inflight-dedup assertion gained a microtask flush
  because the guard validates the URL before invoking fetch.

## Residual risk

- `services/payments/fxRateService.js` keeps a `node-fetch` fallback behind a
  `global.fetch` feature check; the fallback is unreachable on Node >= 18.
- `billingProvider`/`hyperswitchProvider` accept an injected `fetchImpl`;
  callers injecting a raw fetch bypass the guard (tests only).
- Denial of private targets applies to user-influenced surfaces only; an
  operator who configures an internal host has, by definition, authorized it.
