# ADR 0005: DPoP sender-constraint rollout sequence

Status: accepted

## Context

Server sessions support DPoP binding today: presenting a proof at session
creation binds the client JWK (`dpopJwk`), and `protect` verifies proofs on
bound sessions (missing/mismatched/replayed/expired proofs and HTM/HTU
mismatches are all rejected — see `dpopSessionBinding.test.js` cases 1–7).
Unbound sessions remain bearer tokens by necessity: the shipped storefront,
desktop, and mobile clients do not generate DPoP proofs yet, so flipping
`AUTH_DPOP_REQUIRED=true` globally would outage production.

## Decision

Roll out sender constraint in stages, tracked by the production contract:

1. **Verify-if-bound everywhere (done).** No route may bypass `protect`;
   the sensitive-route scanner enforces this.
2. **Client proof support (open).** Frontend generates an EC key per
   session, attaches DPoP proofs, rotates on the existing session rotation
   path. Until then, `validateAuthEnvironment` warns (not fails) in
   production when `AUTH_DPOP_REQUIRED` is unset.
3. **Staged require (later).** Per-route `AUTH_DPOP_REQUIRED` for payment
   and admin mutations behind a client-capability flag, then global.
4. **Enforce + monitor (later).** Bound-session rate in telemetry hits the
   SLO review before any global flip.

## Consequences

- Token theft via XSS remains possible for unbound sessions; mitigation
  today is CSP, httpOnly cookies, short idle TTLs, and session caps — not
  sender constraint. This ADR keeps that residual risk explicit instead of
  claiming DPoP coverage that clients cannot honor.
- The production warning fires until step 3; treat it as the rollout
  reminder, not noise to suppress.
