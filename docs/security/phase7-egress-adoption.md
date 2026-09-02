# Phase 7 — Egress Adoption (operator-configured outbound fetch)

Follow-up to phase 6 (`phase6-egress-defense.md`): migrate operator-configured
outbound calls onto the safe egress path so credential-bearing integrations
cannot be redirected into internal space and every connection is subject to
connect-time private-IP pinning.

## Why

After phase 6, user-influenced egress (the public image proxy, Gemini remote
media validation) went through `remoteFetchGuardService`, but provider calls
(Resend, Twilio, Razorpay, Turnstile, AI provider registry) still used plain
`fetch`. Their hosts come from configuration rather than user input, so they
are not classic SSRF — but a compromised provider, hijacked DNS, or a
redirecting endpoint would still pivot a credential-bearing request into
internal space, and the credential headers would ride along on the redirect.

## What this adds

1. **Operator mode in `guardedFetch`** (`validateDns: false`)
   - Per-hop checks stay fully enforced for scheme, hostname allowlist, and
     the metadata/deny host list (new exported `assertRemoteFetchPolicy`).
   - The validation-time DNS lookup is skipped for fixed, configured hosts;
     the safe egress agent's **connect-time** lookup remains the authoritative
     private-IP/metadata enforcement for every real connection, including
     redirect hops.
   - Credential headers are stripped before following any redirect, and the
     redirect hop cap applies. An optional caller `signal` is honored.
   - `validateRemoteFetchUrl` keeps its exact previous behavior (DNS
     validation + resolved addresses) for user-influenced surfaces.
2. **Migrated call sites** (all global-`fetch` egress):
   - `services/email/providers/resendProvider.js` → `api.resend.com`
   - `services/sms/providers/twilioProvider.js` → `api.twilio.com`
   - `services/payments/providers/razorpayProvider.js` → `api.razorpay.com`
   - `middleware/turnstileMiddleware.js` → configured siteverify host
   - `services/ai/providerRegistry.js` → per-call provider host
3. **Regression suite** — `server/tests/security/operatorEgress.test.js`
   (added to the regression tier): operator-mode redirect policy, credential
   stripping, policy-only validation semantics, and source-contract checks
   that the migrated files keep routing through `guardedFetch`.

## Failure semantics

- A redirect to a non-allowlisted or denied host, or a connection the egress
  agent refuses at connect time, fails the provider call; existing provider
  error normalization maps it to the provider's standard retryable/network
  error envelope.
- Twilio and Razorpay calls gain an explicit 15s cap they previously lacked
  (they had no timeout at all); Resend keeps its existing 15s.

## Residual risk

- The remaining node-fetch v2 egress (`duoOidcService`, `keycloakOidcService`,
  `oidcTokenVerifier`, `statusService`, `ollamaGatewayService`,
  `libreTranslateProvider`, `geminiGatewayService`,
  `studentPackSecurityHarnessService`) cannot use the undici-based agent
  without an implementation migration; moving them to global fetch is the
  follow-up. Their hosts are operator-configured and the OIDC/Duo surfaces
  already enforce https-only endpoints.
- `catalogSnapshotService` keeps its own remote-ref guard
  (`catalogSnapshotService.remoteRefSecurity.test.js`).

## Tests

`server/tests/security/operatorEgress.test.js` — policy-only validation
denials, operator-mode redirect blocking (off-allowlist and metadata targets,
without any DNS dependency so tests stay hermetic), allowlisted redirect
following with credential stripping, and provider source contracts.
