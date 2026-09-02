# Phase 5A — Brute-Force Defense (distributed login lockout)

## Why

Login is Firebase-verified, so server-side brute force targets one-time proofs:
OTP verification, MFA/TOTP verification, passkey proofs, recovery codes, and
session sync. Those surfaces previously relied on per-instance rate limiters
and the login risk engine (which only scored, never blocked). A credential-
stuffing or proof-guessing pattern spread across IPs below the global IP
ceiling was never locked out.

## What this adds

1. **Distributed per-account lockout** — `server/services/loginLockoutService.js`
   - Redis-backed failure counters keyed by identity hash (email/phone + uid + IP),
     15-minute window (`AUTH_LOCKOUT_WINDOW_MS`).
   - Escalating lock steps: 5 failures → 5 min, 8 → 15 min, 12 → 60 min
     (`server/services/loginLockoutService.js` `LOCKOUT_STEPS`).
   - Success clears counters, so one typo never accumulates toward a lock.
2. **Gate + recorder middleware** — `server/middleware/loginLockoutGate.js`
   - `loginLockoutGate({ surface })`: pre-route check; in enforce mode a locked
     account gets `429 ACCOUNT_TEMPORARILY_LOCKED` with `Retry-After`.
   - `authFailureRecorder({ surface })`: Express error middleware at the end of
     the auth/OTP routers that records 401-class responses as failures.
   - Mounted on `/api/auth` (incl. the `/otp` sub-router) and `/api/otp`.
3. **Adaptive escalation mounted** — `adaptiveRateLimit` (previously dead code)
   is now mounted on auth (60/5min), OTP (20/5min), and customer-facing payment
   routes (60/5min): slow_down → challenge → contain. Webhook routes are
   deliberately excluded (server-to-server).
4. **Body-limit tightening** — global JSON body limit drops from 12 MB to
   256 KB (`JSON_BODY_LIMIT`); `/api/uploads`, `/api/listings`, `/api/ai` get a
   scoped 10 MB parser (`LARGE_JSON_BODY_LIMIT`) because those are the only
   routes with legitimate large base64 data-URI payloads.
5. **Turnstile fail-closed startup assert** — production startup now throws if
   `TURNSTILE_ENABLED`/`TURNSTILE_SECRET_KEY` is missing instead of silently
   degrading OTP/auth bot checks to rate limits only. Staging/development log
   a loud warning.

## Rollout

`AUTH_LOCKOUT_MODE=off` (default) → `monitor` (observe + log, never block) →
`enforce` (locked accounts blocked). Flipping back to `off` restores the exact
previous behavior instantly. Set via the environment contract; defaults are in
`server/.env.example`.

## Failure semantics

- Lockout evaluation **fails open** on store errors: a Redis blip must not
  brick every login. The distributed rate limiters (fail-closed) remain the
  hard volume cap.
- Failure recording never throws; it degrades to a log entry.

## Tests

`server/tests/loginLockoutSecurity.test.js` — mode parsing, key derivation,
escalation steps, lock/unlock lifecycle, gate enforce/monitor/off behavior,
401 recording, Turnstile assert, and source-contract checks for the wiring.
