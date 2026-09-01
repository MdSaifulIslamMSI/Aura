# Phase 6 — Egress Defense (SSRF redirect closure + connect-time IP pinning)

## Why

The public product-image proxy (`GET /api/products/image-proxy`) validated the
first URL but issued the upstream request with `redirect: 'follow'`. Any
allowlisted CDN could answer `302 Location: http://169.254.169.254/...` (or any
internal address) and the proxy would fetch and relay the response — the
classic redirect-to-private SSRF bypass tracked as R-012 in the risk register.

Two adjacent gaps compounded it:

- **DNS-rebinding window.** Validation resolved DNS once and `fetch` resolved
  it again at request time; a rebinding resolver could answer public on the
  first lookup and private on the second.
- **Incomplete deny ranges in the shared guard.** `remoteFetchGuardService`
  denied private IPv4/IPv6 prefixes but accepted IPv4-mapped IPv6 forms
  (`::ffff:169.254.169.254` — the AWS metadata address through a mapped
  address), NAT64/6to4 embeddings of private space, bracketed IPv6 literals,
  and the documentation/benchmark/multicast/reserved IPv4 ranges
  (192.0.0.0/24, 192.0.2.0/24, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24,
  224.0.0.0/4, 240.0.0.0/4).

## What this adds

1. **Range closure** — `server/security/remoteFetchGuardService.js`
   - IPv4 denylist extended to the IETF protocol, documentation, benchmarking,
     multicast, reserved, and broadcast ranges.
   - IPv6 handling rewritten around a full group expansion so every textual
     form is checked: compressed, fully expanded, mixed dotted-quad, and
     bracketed literals. IPv4-embedded families (`::ffff:*/96`, `64:ff9b::/96`
     NAT64, `2002::/16` 6to4) are decoded and re-checked against the IPv4
     denylist.
2. **Connect-time IP pinning** — `safeConnectLookup` + a shared undici `Agent`.
   Every connection opened through the agent re-resolves DNS and refuses
   private/metadata targets at connect time, closing the rebinding window and
   covering redirect hops that open new connections.
3. **`guardedFetch`** — validate the URL, fetch with `redirect: 'manual'`,
   re-validate every `Location` hop against the same policy (allowlist,
   denylist, resolved addresses), strip credential headers
   (`authorization`, `cookie`, `proxy-authorization`, `x-api-key`,
   `x-goog-api-key`, `x-auth-token`, `x-csrf-token`) before following a
   redirect, cap hops (`maxRedirects`, default 3), and emit `ssrf.blocked`
   security events with per-hop reason codes
   (`remote_host_not_allowlisted`, `remote_host_denied`,
   `remote_resolved_private_ip`, `redirect_limit_exceeded`, ...).
4. **Image proxy wiring** — `server/controllers/productController.js` routes
   the public proxy's upstream fetch through `guardedFetch` with the proxy
   hostname allowlist. A trusted CDN can no longer pivot the fetch to internal
   or metadata targets, and credential headers cannot leak to redirect targets.
5. **Regression suite** — `server/tests/security/egressGuard.security.test.js`
   covers the denied ranges (including the previously accepted
   `::ffff:169.254.169.254`), validation-time rebinding, every redirect
   policy branch, connect-time denial, header stripping, and source-contract
   checks that the image proxy keeps using `guardedFetch`.

## Failure semantics

- Denied egress throws the guard's standard `400 Remote URL is not allowed.`
  internally; the image proxy maps upstream failures to a generic
  `502 Product image unavailable` so reason codes reach the security event
  stream, not the HTTP response.
- The safe egress agent only changes connection establishment. Existing
  callers of `validateRemoteFetchUrl` (Gemini remote media) keep their
  behavior; the previously denied ranges they relied on only grow stricter.

## Residual risk

- Operator-configured egress (email, SMS, payments, OIDC, status probes,
  translation) still uses plain `fetch` against hosts from environment
  configuration rather than user input. Migrating them onto `guardedFetch` is
  follow-up work tracked in the risk register.
- Teredo (`2001::/32`) embedding is not yet decoded; it is not a cloud
  metadata path but is noted for completeness.

## Tests

`server/tests/security/egressGuard.security.test.js` — range closure
(including IPv4-mapped metadata), bracketed literals, validation-time rebinding
rejection, redirect-to-metadata/redirect-to-allowlist-violation/
redirect-to-private-resolution blocking, allowlisted redirect following with
credential stripping, hop-limit enforcement, connect-time private resolution
denial, header-stripping case-insensitivity, and image-proxy source-contract
checks.
