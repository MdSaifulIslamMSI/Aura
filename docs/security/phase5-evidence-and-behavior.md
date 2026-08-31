# Phase 5B — Evidence Integrity & Behavioral Baseline

Phase 5A made brute force painful. Phase 5B closes the attacker's two
remaining advantages: **erasing their own evidence** and **staying invisible
across requests**.

## 1. Tamper-evident security event ledger

`writeSecurityEvent` now (optionally) streams every security event into a
durable Mongo ledger: `server/models/SecurityEventLedger.js` +
`server/services/securityEventLedgerService.js`.

- Each record carries `seq`, `prevHash`, `hash`, `signature`. The chain head
  (`seq` + `lastHash`) lives in one counter document updated atomically
  (`findOneAndUpdate`), so concurrent writers can never fork the chain.
- `hash` and `signature` are HMAC-SHA256 (`SECURITY_EVENT_LEDGER_SECRET`)
  over `seq|prevHash|canonicalPayload` and `...|hash` respectively.
- Editing, deleting, or reordering records in the database breaks the chain;
  `server/scripts/verify-security-event-ledger.mjs` replays and validates it
  (exit 1 on tampering, gap, or misconfiguration).
- Flag: `SECURITY_EVENT_LEDGER_ENABLED=true` + `SECURITY_EVENT_LEDGER_SECRET`.
  Off by default; append is fire-and-forget and never changes request outcomes.
- Limitation, stated honestly: an attacker who compromises the *app runtime*
  (and therefore the env secret) can re-sign records. The ledger defeats
  database-only tampering and log-pipeline loss; full external-key anchoring
  (KMS/WORM sink) is the documented next step.

## 2. Signed device fingerprint attestation

`server/services/deviceFingerprintAttestationService.js`.

- At session establishment (`establishSessionCookie`), the server signs the
  observed `x-device-fingerprint` + session id + expiry (30 days) into an
  httpOnly cookie (`aura_dfa`), HMAC'd with `DEVICE_FP_ATTEST_SECRET`
  (falls back to `AUTH_RISK_SIGNAL_SECRET`).
- The lockout gate's identity resolution prefers the attested fingerprint and
  only falls back to the raw header when no valid attestation exists. A client
  rotating its fingerprint header mid-session no longer fragments limiter or
  lockout keys, and cannot poison device-trust decisions with forged values.
- Flag: `SIGNED_DEVICE_FINGERPRINT_ENABLED=true` (off by default).

## 3. Cross-request behavioral baseline

`server/services/authBehaviorBaselineService.js`.

- Every login-risk evaluation records an observation per account in Redis:
  distinct source IPs over a 1-hour window (SADD+PEXPIRE) and attempt velocity
  over 15 minutes (INCR+PEXPIRE).
- The evaluation then feeds `distinctIpCount` into `evaluateLoginRisk`, which
  adds an `ip_diversity` signal (20 points at ≥3 distinct IPs in the window) —
  so multi-IP stuffing campaigns surface in the risk score even when each
  individual request looks clean.
- Flag: `AUTH_BEHAVIOR_BASELINE_ENABLED=true` (off by default). Redis failures
  fail open exactly like the lockout evaluation.

## 4. CSP drift guard

The CSP is hand-maintained in four places (`app/index.html`, `vercel.json`,
`netlify.toml`, Helmet config in `server/index.js`). They had already drifted
(`frame-ancestors` was header-only — correct per spec, since meta tags ignore
it). `scripts/security/check-csp-drift.mjs` now parses all four copies and
compares them directive-by-directive as sorted source sets (spec-aware:
`frame-ancestors` is stripped from the meta copy before comparison). Wired
into CI as `npm run security:csp-drift` in the Repo hygiene job.

Note: `img-src https:` (beaconing channel) is intentionally **not** tightened
in this phase — `User.avatar` accepts arbitrary durable URLs, so host
allowlisting requires a production asset audit first. Follow-up: audit live
asset hosts, allowlist them in all four copies, and rely on this new drift
gate to keep the policy pinned.

## Rollout

All three behavior flags default to off; each can be enabled independently and
reverted instantly by unsetting. The CSP drift guard is a pure CI check and
active immediately.

## Tests

`server/tests/securityEventLedger.test.js` — 15 tests: ledger chain build and
tamper detection (payload edit → `integrity_mismatch` at the edited seq),
canonicalization, attestation sign/verify (rotation, session binding, forged
signature, disabled flag), baseline IP diversity and flag-off inertness, and
wiring contracts including a live CSP drift run.
