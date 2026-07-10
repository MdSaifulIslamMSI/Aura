# Login Architecture Security Report

## Executive Summary

Reviewed the login/session architecture for the React frontend and Express backend. I found and fixed high-confidence issues in cookie-session logout, production session persistence, recovery reset token binding, trusted-device challenge replay, server-side session revocation after password reset, pre-CSRF browser-session refresh, cross-site browser-session idle refresh, stale cookie supersession after bearer login, public challenge/device-verification/phone-factor rate limiting, OTP verification enumeration, signup/phone-factor account-state leakage, generic OTP discovery/check-user/recovery-code verification timing, browser trusted-device token persistence, auth request body sizing, vulnerable login-adjacent transitive dependencies, deprecated lockfile dependencies, backend production dependency audit findings, and legacy OTP verification masking gaps. I also verified that login OTP flow tokens are already single-use through the `OtpFlowGrant` consumption path, so no additional replay patch was needed there.

## High Severity

### SEC-1: Cookie-session logout was missing CSRF protection

Impact: A third-party site could force a logged-in browser session to POST `/auth/logout`, causing cross-site logout/session disruption.

Evidence: `server/routes/authRoutes.js:63` previously routed logout directly to the controller without auth/session-aware CSRF validation.

Fix: `server/routes/authRoutes.js:27` now requires CSRF only when the request is authenticated by the browser session cookie, while bearer-auth logout and no-session logout continue to work. `app/src/services/api/authApi.js:268` now obtains a fresh CSRF token for cookie-only logout calls.

Verification: Added CSRF route tests for cookie logout with and without `X-CSRF-Token`.

### SEC-2: Production browser sessions could silently fall back to process memory

Impact: If Redis write/read failed in production, sessions could continue in per-process memory, weakening revocation and horizontal consistency.

Evidence: `server/services/browserSessionService.js:394` now logs and fails closed when Redis persistence fails and explicit memory fallback is not enabled.

Fix: `server/services/browserSessionService.js:39` adds `AUTH_SESSION_ALLOW_MEMORY_FALLBACK`, defaulting to disabled in production and enabled outside production. Session creation now throws instead of silently issuing a non-distributed session when Redis is required.

Verification: Added a production-mode test proving Redis write failure rejects session creation.

### SEC-3: Recovery-code reset flow tokens were not device-bound

Impact: A stolen recovery-code reset flow token could be replayed from another browser during its short validity window.

Evidence: `server/controllers/authController.js:758` now issues recovery-code reset flow tokens with a device signal bond when the browser supplies trusted-device headers.

Fix: `server/controllers/authController.js:739` captures the request device id and trusted-device session token before minting the reset flow token, then includes `deviceId` and, when available, `deviceSessionHash` in the token `signalBond`.

Verification: Added `server/tests/authRoutes.integration.test.js:116` to prove a recovery-code reset token minted for one device is rejected from another device.

### SEC-16: Trusted-device challenge tokens were replayable during their TTL

Impact: If a trusted-device challenge token and signed proof were captured during the short challenge window, the same proof could be replayed to mint another trusted-device session.

Evidence: `server/services/trustedDeviceChallengeService.js:719` now adds a challenge id to issued trusted-device challenge tokens, and `server/services/trustedDeviceChallengeService.js:817` consumes that id before accepting a proof.

Fix: Added Redis-backed one-time challenge consumption with production fail-closed behavior when replay storage is unavailable. Test and development keep an in-memory fallback so local workflows remain usable.

Verification: Added `server/tests/trustedDeviceChallengeService.test.js:321` to prove a browser-key challenge cannot be reused after successful verification.

### SEC-12: Password reset did not revoke server-side browser sessions

Impact: A stolen or unattended browser-session cookie could remain valid even after the account owner completed a password reset, because only Firebase refresh tokens were revoked.

Evidence: `server/controllers/otpController.js:1685` now revokes server-side browser sessions for the user before committing the new Firebase password, and `server/services/browserSessionService.js:625` provides user-wide revocation across in-memory and Redis-backed session stores.

Fix: Added `revokeBrowserSessionsForUser`, including Redis `SCAN`-based deletion for distributed session stores, and wired password reset finalization to fail closed if server-side session revocation cannot be completed.

Verification: Added focused service coverage at `server/tests/browserSessionService.test.js:198` and password-reset integration coverage at `server/tests/otpRoutes.test.js:295`.

### SEC-20: Critical transitive `protobufjs` vulnerability in Firebase paths

Impact: A critical `protobufjs < 7.5.5` code-execution advisory affected Firebase/Firestore dependency paths used by the login-adjacent frontend and backend runtime.

Evidence: `app/package-lock.json:7417` and `server/package-lock.json:9237` now resolve `protobufjs` to `7.5.5`; before this pass both installed trees resolved `7.5.4` through Firebase/Firestore.

Fix: Ran production dependency remediation and updated local installs so both the committed lockfiles and current `node_modules` resolve the patched `protobufjs`. The same pass also moved safe backend transitive/direct patches including `firebase-admin`, `nodemailer`, `svix`, `@aws-sdk/xml-builder`, and `fast-xml-parser` where npm could do so without a forced breaking change.

Verification: `npm.cmd ls protobufjs` now reports `protobufjs@7.5.5` in both `app` and `server`. `npm.cmd audit --omit=dev --json` reports `0` frontend vulnerabilities and `0 critical / 0 high` backend vulnerabilities.

### SEC-21: Backend production dependency audit still had low/moderate findings

Impact: Even after the critical `protobufjs` patch, the backend production dependency tree still carried lower-severity audit findings through Firebase Admin's Google Cloud optional dependencies, `uuid`, `node-cron`, and a patched `brace-expansion` chain introduced while remediating the Google Cloud stack.

Evidence: `server/package.json:70` now upgrades `node-cron` to `^4.2.1`; `server/package.json:84` adds explicit overrides for the vulnerable Firebase/Google Cloud transitive chain; `server/package-lock.json:6088`, `server/package-lock.json:8318`, `server/package-lock.json:10316`, and `server/package-lock.json:4290` now resolve the relevant Google Cloud, scheduler, UUID, and brace-expansion packages to patched versions.

Fix: Upgraded the direct scheduler dependency from `node-cron` 3.x to 4.x, added targeted overrides for `google-gax`, `gaxios`, `retry-request`, `teeny-request`, proxy-agent, and `uuid`, and let npm apply the patched `brace-expansion` lockfile remediation.

Verification: `npm.cmd audit --omit=dev --json` in `server` now reports `0` vulnerabilities. A Firebase/Admin/Firestore/Storage import smoke test passes, `node-cron` still validates the configured cron syntax, and the backend auth/security plus FX scheduler tests pass.

## Medium Severity

### SEC-13: Failed CSRF requests refreshed browser-session idle state

Impact: A forged or otherwise invalid cookie-authenticated POST could refresh the server-side browser-session idle window before the CSRF middleware rejected the request.

Evidence: `server/middleware/authMiddleware.js:660` now assigns the loaded session without touching it, and `server/middleware/authMiddleware.js:612` defers the touch until response completion.

Fix: Browser-session touch is now scheduled on the Express `finish` event and skipped for `4xx/5xx` responses, so failed CSRF validation and other rejected requests no longer prolong the session.

Verification: Added `server/tests/authMiddleware.cookie.test.js:103` to prove failed responses do not call `touchBrowserSession`, while successful responses still do.

### SEC-14: Account check endpoint still had a timing discovery surface

Impact: The public `/auth/otp/check-user` endpoint returned a generic body but still allowed response-time sampling against verified, unknown, or mismatched account records.

Evidence: `server/controllers/otpController.js:1757` now starts the generic response timer for `checkUserExists`, and `server/controllers/otpController.js:1817` now returns through `sendGenericAccountDiscoveryResponse`.

Fix: Added a generic account-discovery response helper at `server/controllers/otpController.js:272` that uses the same production timing floor as other generic OTP/account discovery responses.

Verification: Added `server/tests/otpRoutes.test.js:286` and `server/tests/otpRoutes.test.js:303` to prove verified and mismatched identities return the same external response as unknown users.

### SEC-15: Recovery-code verification failures still had timing discovery

Impact: Public recovery-code verification returned the same failure body for wrong and unknown accounts, but response-time sampling could still distinguish no-account paths from existing-account code checks.

Evidence: `server/controllers/authController.js:748` now records a response start time for `verifyBackupRecoveryCode`, and failed recovery-code consumption waits through `waitForRecoveryCodeVerificationWindow` at `server/controllers/authController.js:761`.

Fix: Added a small production timing floor for invalid recovery-code verification attempts before surfacing the generic `Recovery code is invalid or already used.` error. Malformed requests still fail fast as validation errors.

Verification: Added `server/tests/authRoutes.integration.test.js:117` to prove wrong-code and unknown-account failures return the same status and message.

### SEC-17: Trusted-device proof verification lacked a dedicated limiter

Impact: `/api/auth/verify-device` could receive repeated trusted-device proof attempts under only broader route/global controls, leaving the high-value proof verification path less tightly bounded than challenge issuance.

Evidence: `server/routes/authRoutes.js:92` now defines `auth_verify_device`, and `server/routes/authRoutes.js:117` applies it before `verifyDeviceChallenge`.

Fix: Added a security-critical distributed limiter keyed by authenticated uid/email or device/IP fallback.

Verification: Added `server/tests/csrfAuthRoutes.integration.test.js:267` to assert the route traverses the dedicated limiter.

### SEC-18: Hosted web builds persisted trusted-device session tokens in localStorage by default

Impact: A trusted-device session token persisted in `localStorage` is easier to exfiltrate after XSS or extension compromise and can survive tab/browser restarts longer than needed for web login flows.

Evidence: `app/src/services/deviceTrustClient.js:44` now only persists the token across restarts when explicitly configured or when running in desktop/native runtimes.

Fix: Hosted web defaults now keep trusted-device session tokens in `sessionStorage`; `VITE_PERSIST_TRUSTED_DEVICE_SESSION=true` still allows explicit persistence where the deployment accepts that tradeoff.

Verification: Added `app/src/services/deviceTrustClient.test.js:536`, `app/src/services/deviceTrustClient.test.js:551`, and `app/src/services/deviceTrustClient.test.js:619` for the new default, explicit opt-in, and no-promotion behavior.

### SEC-19: Auth and OTP endpoints inherited the global JSON body limit

Impact: Login, OTP, recovery, and session endpoints accepted the app-wide 12 MB JSON limit even though their payloads are small, increasing request-body memory and parser work available to attackers on public auth surfaces.

Evidence: `server/index.js:114` now defines `AUTH_BODY_LIMIT`, and `server/index.js:266` applies a tighter parser to `/api/auth` and `/api/otp` before the global parser.

Fix: Added a 64 KB default `AUTH_BODY_LIMIT` with a smaller URL-encoded parameter limit for auth/OTP routes, while preserving the larger global limit for non-auth APIs that need it.

Verification: Added `server/tests/authRoutes.integration.test.js:61` to prove oversized auth request bodies are rejected before controller work.

### SEC-22: Cross-site navigations could refresh browser-session idle state

Impact: A cross-site top-level navigation that sent a SameSite=Lax session cookie could refresh the server-side browser-session idle window after a successful authenticated response.

Evidence: `server/middleware/authMiddleware.js:615` now checks `Sec-Fetch-Site` before scheduling the deferred browser-session touch.

Fix: Browser-session idle refresh is skipped for requests explicitly marked `Sec-Fetch-Site: cross-site`, while same-origin/same-site app traffic and older clients without the header keep the existing behavior.

Verification: Added coverage in `server/tests/authMiddleware.cookie.test.js:102` proving successful cross-site requests do not call `touchBrowserSession`.

### SEC-23: Fresh bearer login left superseded browser-cookie sessions alive

Impact: When a fresh Firebase bearer token replaced an existing browser cookie, the old opaque browser session could remain valid until its normal expiry.

Evidence: `server/middleware/authMiddleware.js:689` now records the superseded cookie session id, and `server/controllers/authController.js:258` revokes it after the replacement session is persisted.

Fix: Bearer-auth session establishment now clears the old browser session once the new session exists, reducing stale-cookie and session-fixation windows without changing multi-device behavior.

Verification: Added `server/tests/authRoutes.integration.test.js:375` to prove `establishSessionCookie` revokes the superseded session after minting the replacement.

### SEC-4: Trusted-device bootstrap challenge endpoint was not rate limited

Impact: A public login-adjacent endpoint could be repeatedly hit to perform account/device challenge probing and unnecessary challenge issuance work.

Evidence: `server/routes/authRoutes.js:79` now applies a distributed limiter to `/auth/bootstrap-device-challenge`.

Fix: `server/routes/authRoutes.js:60` adds `auth_bootstrap_device_challenge` with a 5-minute window and identity/device/IP keying.

Verification: Added `server/tests/csrfAuthRoutes.integration.test.js:221` to assert the public route traverses the limiter.

### SEC-5: Login/password-reset OTP verification leaked account state

Impact: Direct calls to OTP verification could distinguish unknown phone numbers, identity mismatches, expired sessions, and wrong OTP attempts for login/recovery flows.

Evidence: `server/controllers/otpController.js:1179` and related verification branches now route through a masked error helper.

Fix: `server/controllers/otpController.js:133` masks `login` and `forgot-password` verification failures behind the same generic `401` response while keeping signup behavior specific where the UX expects it.

Verification: Added OTP route tests for unknown login phone and login identity mismatch.

### SEC-9: Signup and phone-factor flows leaked account/precondition state

Impact: Public signup OTP requests and phone-factor completion calls could reveal whether an email/phone already belonged to a verified account, whether a pending signup existed, or whether a password-recovery precondition was present.

Evidence: `server/controllers/otpController.js:681` and `server/controllers/otpController.js:717` now return the same generic success response for duplicate signup identifiers, and `server/controllers/authController.js:555` through `server/controllers/authController.js:664` now mask phone-factor signup/recovery precondition failures.

Fix: Signup OTP send now uses the same neutral `200` response as login/recovery discovery flows, while malformed request validation remains specific. Phone-factor completion now uses a generic `403` for account-state and flow-state failures after the caller has a valid Firebase phone proof.

Verification: Added/updated assertions at `server/tests/otpRoutes.test.js:90`, `server/tests/authRoutes.integration.test.js:855`, and `server/tests/otpSystem.test.js:260`.

### SEC-10: Generic OTP discovery responses still had a timing side channel

Impact: Even after status codes and response bodies were normalized, an attacker could still sample response latency to distinguish fast duplicate/missing-account exits from real OTP persistence and delivery paths.

Evidence: `server/controllers/otpController.js:50` now defines a production response floor, `server/controllers/otpController.js:562` starts the per-request timer, and generic responses at `server/controllers/otpController.js:644`, `server/controllers/otpController.js:696`, `server/controllers/otpController.js:732`, and `server/controllers/otpController.js:1089` all share that floor.

Fix: Generic account/OTP discovery responses now wait for a minimum production response window before returning the neutral `200` response. The floor is disabled in `NODE_ENV=test` so route behavior tests stay fast and deterministic.

Verification: Re-ran the focused OTP route suite after the timing floor patch.

### SEC-11: Legacy OTP verification branches still leaked lockout and purpose state

Impact: Login and password-recovery OTP verification could still reveal that an account was locked or that an OTP existed for a different purpose when the request hit older user-backed OTP state or an existing session for another purpose.

Evidence: `server/controllers/otpController.js:1246` now masks the legacy lockout branch through `otpVerificationError`, and `server/controllers/otpController.js:1305` now masks the cross-purpose session branch through the same helper.

Fix: The remaining legacy lockout and cross-purpose mismatch exits now use the same generic login/recovery verification response as the rest of the OTP verification pipeline, while signup keeps its more specific validation behavior.

Verification: Added focused coverage at `server/tests/otpRoutes.test.js:185` and `server/tests/otpRoutes.test.js:204`.

### SEC-8: Phone-factor completion endpoints were not route-rate-limited

Impact: Authenticated or proof-token callers could repeatedly hit phone-factor completion paths, increasing brute-force and abuse risk around login, signup, and password-recovery step-up flows.

Evidence: `server/routes/authRoutes.js:99` and `server/routes/authRoutes.js:100` now route both phone-factor completion endpoints through `phoneFactorCompletionLimiter`.

Fix: `server/routes/authRoutes.js:75` adds the `auth_phone_factor_completion` distributed limiter with user/email/device/IP keying and a 5-minute window.

Verification: Added route-wiring assertions at `server/tests/csrfAuthRoutes.integration.test.js:238` and `server/tests/csrfAuthRoutes.integration.test.js:253`.

## Defense-In-Depth

### SEC-6: Production session cookies depended on proxy headers for `Secure`

Impact: A production deployment with missing `x-forwarded-proto` / `req.secure` could emit the auth session cookie without `Secure`.

Evidence: `server/services/browserSessionService.js:263` now treats production as secure-by-default unless `AUTH_SESSION_COOKIE_SECURE=false` is explicitly set.

Fix: Production cookies now keep `Secure` even when proxy metadata is incomplete; non-production still uses request TLS signals so local HTTP development is not broken.

Verification: Added a production-mode cookie test without proxy headers.

### SEC-7: Malformed cookie values could throw during parsing

Impact: A malformed percent-encoded cookie could trigger an exception while parsing cookies.

Fix: `server/services/browserSessionService.js:216` now safely falls back to the raw cookie value when decoding fails.

## Reviewed Existing Controls

- OTP login assurance flow tokens are already single-use: `server/services/authSessionService.js:532` consumes `OtpFlowGrant` before applying `password+otp` assurance, and `server/tests/authSessionService.test.js` already covers replay rejection.
- Login redirects use internal-route normalization in `app/src/utils/navigation.js`, blocking absolute/external redirect targets.
- State-changing cookie-auth routes other than logout were already covered by CSRF middleware.

## Operational Hardening

### SEC-24: Login security gates now run as a repeatable CI guard

Impact: Future dependency, deprecation, or auth-session regressions can block CI before they reach production.

Fix: `package.json` adds `security:login-gates`, which runs lockfile deprecation checks, production npm audits for root/app/server, and the focused login/auth regression suite. `.github/workflows/ci.yml` adds a `login-security-gates` job wired into the existing reusable CI workflow.

Verification: `scripts/check-lockfile-deprecations.js` fails on any deprecated package metadata in `package-lock.json`, `app/package-lock.json`, or `server/package-lock.json`.

### SEC-25: Login attack smoke simulation added

Impact: CSRF, replay, stale-session, and cross-site session-refresh regressions are now tested as attacker-like flows instead of only as isolated unit behavior.

Fix: `server/tests/loginAttackSmoke.test.js` simulates cookie logout CSRF, recovery-code replay, reset flow token device mismatch, cross-site cookie session navigation, stale cookie plus fresh bearer replacement, and trusted-device challenge replay. `package.json` adds `security:attack-smoke` and includes it in `security:login-gates`.

Verification: `npm.cmd run security:attack-smoke` runs the focused attack simulation suite.

### SEC-26: Production login environment contract audit added

Impact: Deployment drift in Redis, CORS, secure cookies, trusted-device mode, secret bootstrap, proxy/security headers, or Node inspector flags can now block the login security gate before release.

Fix: `server/scripts/audit_login_production_env_contract.js` checks the AWS production base environment, Compose topology, Parameter Store secret contract, runtime-secret rendering, deploy-time trusted-device enforcement, and backend startup assertions. `package.json` adds `security:prod-env-audit` and includes it in `security:login-gates`.

Verification: `npm.cmd run security:prod-env-audit` runs the production/staging contract audit without requiring real production secret values.

### SEC-27: Static frontend anti-clickjacking headers moved to deployment layer

Impact: The production login SPA previously relied on a meta CSP for `frame-ancestors`, which browsers ignore, leaving static frontend routes without an enforceable anti-framing header.

Fix: `app/config/vercelRoutingContract.mjs` now defines shared frontend security headers, `app/scripts/sync_vercel_configs.mjs` syncs them into both Vercel configs, `netlify.toml` adds the same headers, and `app/index.html` removes the ignored `frame-ancestors` meta directive. The production contract audit now checks these headers.

Verification: `npm.cmd run security:prod-env-audit` checks Vercel/Netlify SPA security headers, and `npm.cmd run security:prod-live-smoke` performs the live HTTPS login smoke.

### SEC-28: Live backend HTTPS cutover completed

Impact: Production login traffic now reaches the backend through an HTTPS origin, and the legacy public plain-HTTP port `5000` is no longer reachable.

Fix: `infra/aws/docker-compose.ec2.yml` adds a Caddy TLS edge, binds the API container to `127.0.0.1:5000`, and preserves Redis/session topology. `infra/aws/Caddyfile` serves `3.109.181.238.sslip.io` over HTTPS with HSTS. `infra/aws/bootstrap-free-tier.ps1` opens `80/443` and revokes legacy `5000`; `infra/aws/deploy-release.sh` validates the TLS edge before completing deployment. Vercel/Netlify routing now points at `https://3.109.181.238.sslip.io`.

Verification: `npm.cmd run security:prod-live-smoke` passes against production and explicitly checks that `http://3.109.181.238:5000` is not publicly usable. AWS security group `sg-0264279f9673777d3` now exposes only ports `80` and `443`.

## 2026-07-10 Auth Deep-Hardening Addendum

### SEC-29 (High): Unverified provider email could select an existing privileged profile

Impact: A valid external identity carrying an email that the provider explicitly marked unverified could be treated as email-verified, participate in the email-or-UID lookup, and select the existing public-email profile. The prior regression fixtures demonstrated that the selected profile could be an admin profile.

Evidence: `server/utils/authIdentity.js:106` previously returned provider trust before evaluating explicit false verification signals. `server/middleware/authMiddleware.js:1299` and `server/services/authSessionService.js:673` now separate verified public-email authority from UID-backed account identity.

Fix: Exact-match the supported provider IDs, make any explicit false verification signal authoritative, never infer email verification from provider name or stored profile state, and use an internal UID-backed identity whenever the current proof does not verify the public email. Social sign-in without a verified email remains available, but it cannot merge into or inherit privilege from the matching public-email account.

Verification: `server/tests/authIdentity.test.js`, `server/tests/authMiddleware.bootstrap.test.js:290`, and `server/tests/authSessionService.test.js:464` cover provider-name spoofing, explicit false claims, and an attempted collision with an existing admin email.

### SEC-30 (High): Desktop browser handoff capability was exposed in the hosted URL query

Impact: The one-time desktop handoff secret, loopback callback, and post-login route appeared in the request query sent to the hosted frontend. Query values can enter edge logs, browser history, screenshots, support captures, and referrer-dependent tooling before the capability expires.

Evidence: `desktop/runtimeServer.cjs:161` now keeps only the non-secret request id in the query and puts capability material in the fragment. `app/src/pages/Login/useLoginController.js:761` persists that capability to session storage and immediately replaces the visible route without it.

Fix: Move capability values to the URL fragment, scrub them after first client-side receipt, retain ten-minute session-storage expiry, and continue accepting legacy query handoffs during desktop-client rollout.

Verification: `desktop/runtimeServer.test.cjs` proves the hosted query has no secret or callback; `app/src/pages/Login/useLoginController.test.jsx:314` covers fragment parsing, legacy compatibility, immediate scrubbing, Duo return restoration, and loopback completion.

### SEC-31 (Medium): Duo start accepted a caller-controlled login hint

Impact: Any direct caller of `/api/auth/duo/start` could put an arbitrary email into Duo's optional `login_hint`, creating privacy leakage and account-selection confusion even though the normal UI passed an empty value.

Evidence: `server/controllers/authController.js:738` no longer forwards the query field, `server/services/duoOidcService.js:178` no longer supports a login-hint parameter, and `app/src/services/api/authApi.js:280` no longer constructs one.

Fix: Remove Duo login-hint support at every client and server layer. Enterprise Keycloak login hints remain a separate, intentional SSO feature.

Verification: `server/tests/auth.duo-oidc.security.test.js:143` sends a hostile `loginHint` query and proves that the upstream authorization URL has no `login_hint`.

### SEC-32 (High): OIDC discovery and key fetches lacked endpoint confinement and time bounds

Impact: A compromised or drifted discovery document could direct server-side token or JWKS requests to another origin, and unavailable identity-provider requests could occupy authentication work without a fixed deadline.

Evidence: `server/services/duoOidcService.js:31` and `server/services/auth/keycloakOidcService.js:34` now require HTTPS endpoints on the configured issuer origin. All discovery, token, and signing-key network calls have ten-second abortable deadlines.

Fix: Fail closed on non-HTTPS, credential-bearing, or cross-origin discovery endpoints; bind the discovery cache to both issuer and discovery URL; and bound provider network operations.

Verification: Focused Duo and Keycloak tests reject cross-origin discovery documents while normal PKCE, callback, and step-up flows continue to pass.

### SEC-33 (High): OIDC temporal and authorized-party claims were incompletely validated

Impact: Non-numeric `exp`, `iat`, or `nbf` values could evade JavaScript comparison checks, and multi-audience tokens were accepted without proving the expected authorized party.

Evidence: `server/services/duoOidcService.js:326` and `server/services/auth/oidcTokenVerifier.js:135` now enforce `azp` where required. Both verifiers reject non-finite NumericDate claims, and production Keycloak configuration rejects plain HTTP at `server/config/authEnvironment.js:153`.

Fix: Validate finite expiration, issued-at, and not-before values; enforce expected authorized party for multi-audience or `azp`-bearing tokens; and require HTTPS for production enterprise OIDC endpoints.

Verification: `server/tests/auth.duo-oidc.security.test.js:324`, `server/tests/oidcTokenVerifier.test.js`, and `server/tests/authEnvironment.test.js:81` cover malformed dates, `azp` mismatch, and HTTP production configuration.

### SEC-34 (Open, Medium): Backend auth events are not centrally queryable in CloudWatch Logs

Impact: The backend emits structured `auth.security_event` records, but a read-only AWS inventory on 2026-07-10 found CloudTrail and VPC flow-log groups only. Authentication incident reconstruction currently depends on local container logs and cannot be performed through a retained application log group.

Recommended fix: Add a separately reviewed log-shipping change with a dedicated application log group, retention and cost limits, least-privilege instance-role writes, PII redaction validation, alarms for auth failure classes, and a staged rollback test. This was not bundled into the auth code patch because it changes shared production observability and IAM behavior.

### SEC-35 (Open, Medium): Auth Shield remains shadow-only without a client nonce contract

Impact: `server/security/authShield/config.js:41` defaults the shield to disabled and shadow mode, while critical replay checks require the nonce read at `server/security/authShield/sessionContext.js:37`. Enabling enforcement before clients generate and rotate that nonce would block legitimate critical actions.

Current mitigation: The independent sensitive-action policy remains enforced on recovery, MFA, phone-factor, and device-verification routes in `server/routes/authRoutes.js:242-260`.

Recommended fix: Add a versioned request-nonce client contract, validate it in staging shadow telemetry, then promote route classes incrementally. Do not flip the production flag as an emergency one-line change.

### SEC-36 (High): DPoP replay checks accepted ambiguous identifiers and failed open on Redis errors

Exploit path: An attacker able to submit a validly signed proof could use a non-string `jti` whose object identity evaded the process-local replay map. In a Redis-backed deployment, a replay-store outage was logged but the proof was still accepted.

Affected surface: `server/utils/dpop.js` and all routes that call `server/security/authShield/dpopVerifier.js`, including protected auth-session and sensitive-action requests.

Fix: Require a non-empty string `jti` of at most 256 characters, hash the value before building a Redis key, use the canonical string in memory, and reject proofs when Redis replay storage errors.

Regression test: `server/tests/dpopVerifier.security.test.js` proves object-valued identifiers and Redis failures are denied.

### SEC-37 (High): Auth Shield could override a current unverified identity with stored profile state

Exploit path: A request whose current provider proof explicitly marked the email unverified could still pass the shield's verified-email condition when the persisted user profile had `isVerified=true`.

Affected surface: `server/security/authShield/identityVerifier.js` for sensitive actions evaluated through Auth Shield.

Fix: Treat the current normalized `req.authIdentity.emailVerified` or token verification boolean as authoritative; consult persisted profile state only when the current proof has no verification signal.

Regression test: `server/tests/authShield.identityVerifier.test.js` proves an explicit current false value cannot be overridden by stored state.

### SEC-38 (High): Global session revocation and emergency logout failed open on Redis errors

Exploit path: During a Redis read failure, an existing browser session could be accepted without observing the global revocation marker. During a write failure, `FORCE_LOGOUT_ALL_USERS` could report success although other processes never received the revocation.

Affected surface: browser-cookie authentication through `server/services/browserSessionService.js` and the emergency-control `FORCE_LOGOUT_ALL_USERS` action in `server/services/emergencyControlService.js`.

Fix: In production or any deployment that disallows memory fallback, propagate global marker read/write failures and return `GLOBAL_SESSION_REVOCATION_FAILED` with status 503 from the emergency action.

Regression test: `server/tests/browserSessionService.test.js` covers failed global marker reads and writes; `server/tests/emergencyControlService.test.js` proves emergency logout cannot resolve successfully after revocation failure.

### SEC-39 (High): Production admin passkeys lacked a pinned WebAuthn relying-party boundary

Exploit path: A production configuration could require admin passkeys while deriving or omitting the relying-party ID/origin, weakening deployment assurance and allowing host drift to change the WebAuthn verification boundary.

Affected surface: trusted-device/admin passkey startup in `server/config/authTrustedDeviceFlags.js`, the production contract audit, and AWS bootstrap/release configuration.

Fix: Require an HTTPS origin with no credentials or path, require the RP ID to match that origin, require user verification, pin the production values, disable session memory fallback, and synchronize those non-secret settings on every normal EC2 release without altering secrets.

Regression test: `server/tests/authTrustedDeviceFlags.test.js` covers missing and valid boundaries; `server/tests/envContractScripts.test.js` verifies bootstrap, audit, and release-time synchronization; the production env audit returns no failures or warnings.

### SEC-40 (High): Desktop owner assertion replay protection was process-local

Exploit path: A captured, otherwise valid owner HMAC assertion could be replayed against a different API process or after a process restart because each process maintained an independent replay map.

Affected surface: the desktop owner access route backed by `server/services/desktopOwnerAccessService.js` and its controller call site.

Fix: Consume a SHA-256 replay digest atomically with Redis `SET NX PX`; require distributed replay storage in production and distributed-security deployments; retain memory replay only for non-production local workflows; await verification in the controller.

Regression test: `server/tests/desktopOwnerAccessService.test.js` proves cross-process replay and Redis outage are denied; `desktop/runtimeServer.test.cjs` covers the desktop caller contract.

### SEC-41 (Open, Medium): Historical identity links may predate verified-email binding

Exploit path: Accounts linked before SEC-29 could retain a public email or `authUid` association created from an unverified provider claim. The new code prevents new collisions but does not prove all historical records are clean.

Affected surface: existing production user/account records consumed by the auth middleware and session services. No production data was read or changed during this patch.

Recommended fix: Run a separately reviewed, read-only inventory that flags conflicting provider UID, public email, verification provenance, and privileged role combinations; require an owner-approved repair plan with backup and rollback before any mutation.

Regression test: `server/tests/authIdentity.test.js`, `server/tests/authMiddleware.bootstrap.test.js`, and `server/tests/authSessionService.test.js` prevent creation or selection of new unverified-email collisions. A production data audit remains required to measure historical exposure.

## Residual Dependency Risk

- Root, frontend, and backend production audits now report `0` vulnerabilities.
- Root, frontend, and backend lockfile scans now report `0` deprecated packages. The cleanup replaced Electron desktop transitive deprecations through targeted root overrides, moved backend Jest/Google Cloud transitive deprecations to maintained ranges, and replaced the deprecated `node-domexception` registry package with a local native `DOMException` bridge because every published `node-domexception` version is itself deprecated.
- Diagnostic note: npm 11 still reports an `npm ls` `ELSPROBLEMS` warning for semver-compatible `fetch-blob@3.2.0` and `formdata-polyfill@4.0.10` when reached through Firebase Admin's optional Google Cloud dependency chain. I reproduced the same resolver report in a clean temp project; `npm install`, production audits, lockfile deprecation scans, import smokes, and auth tests all pass.
- The backend uses npm `overrides` for Firebase/Google Cloud transitive dependencies because the current latest `firebase-admin` still pins vulnerable lower-level ranges. Keep those overrides visible during future Firebase Admin upgrades and remove them once upstream dependency ranges natively resolve cleanly.

## Verification Run

- `npm.cmd test -- --runTestsByPath tests/csrfAuthRoutes.integration.test.js tests/browserSessionService.test.js tests/otpRoutes.test.js tests/authRoutes.integration.test.js`
- `npm.cmd run build` in `app`
- `npm.cmd test -- --runTestsByPath tests/csrfAuthRoutes.integration.test.js`
- `npm.cmd test -- --runTestsByPath tests/authRoutes.integration.test.js`
- `npm.cmd test -- --runTestsByPath tests/otpRoutes.test.js`
- `npm.cmd test -- --runTestsByPath tests/authRoutes.integration.test.js`
- `npm.cmd test -- --runTestsByPath tests/otpRoutes.test.js`
- `git diff --check`
- `npm.cmd test -- --runTestsByPath tests/otpRoutes.test.js`
- `npm.cmd test -- --runTestsByPath tests/browserSessionService.test.js tests/otpRoutes.test.js`
- `npm.cmd test -- --runTestsByPath tests/authMiddleware.cookie.test.js tests/csrfAuthRoutes.integration.test.js`
- `npm.cmd test -- --runTestsByPath tests/otpRoutes.test.js`
- `npm.cmd test -- --runTestsByPath tests/authRoutes.integration.test.js`
- `npm.cmd test -- --runTestsByPath tests/trustedDeviceChallengeService.test.js`
- `npm.cmd test -- --runTestsByPath tests/csrfAuthRoutes.integration.test.js`
- `npm.cmd test -- --runTestsByPath tests/authRoutes.integration.test.js`
- `npm.cmd test -- src/services/deviceTrustClient.test.js` in `app`
- `npm.cmd audit fix --package-lock-only --omit=dev` in `app` and `server`
- `npm.cmd install --no-audit --no-fund` in `app` and `server`
- `npm.cmd ls protobufjs` in `app` and `server`
- `npm.cmd audit --omit=dev --json` in the workspace root
- `npm.cmd audit --omit=dev --json` in `app` and `server`
- `npm.cmd test -- --runTestsByPath tests/authRoutes.integration.test.js tests/otpRoutes.test.js tests/authMiddleware.cookie.test.js tests/browserSessionService.test.js tests/trustedDeviceChallengeService.test.js tests/authSessionService.test.js tests/csrfMiddleware.test.js tests/distributedRateLimit.test.js tests/authRecoveryCodeService.test.js`
- `npm.cmd test -- src/services/deviceTrustClient.test.js` in `app`
- `npm.cmd run build` in `app`
- `npm.cmd install node-cron@^4.2.1 --save` in `server`
- `npm.cmd install --no-audit --no-fund` in `server`
- `npm.cmd install --no-audit --no-fund` in the workspace root
- `npm.cmd audit fix --package-lock-only --omit=dev` in `server`
- Deprecated-package lockfile scan across `package-lock.json`, `app/package-lock.json`, and `server/package-lock.json`
- `node -e "require('firebase-admin'); require('firebase-admin/auth'); require('firebase-admin/firestore'); require('firebase-admin/storage'); require('@google-cloud/firestore'); require('@google-cloud/storage'); const cron=require('node-cron'); const uuid=require('uuid'); console.log('smoke', cron.validate('0 * * * *'), typeof uuid.v4, uuid.v4().length)"` in `server`
- `npm.cmd test -- --runTestsByPath tests/fxRateService.test.js tests/authRoutes.integration.test.js tests/otpRoutes.test.js tests/authMiddleware.cookie.test.js tests/browserSessionService.test.js tests/trustedDeviceChallengeService.test.js tests/authSessionService.test.js tests/csrfMiddleware.test.js tests/distributedRateLimit.test.js tests/authRecoveryCodeService.test.js tests/authMiddleware.admin.test.js`
- `npm.cmd test -- --runTestsByPath tests/authRoutes.integration.test.js tests/otpRoutes.test.js tests/authMiddleware.cookie.test.js tests/browserSessionService.test.js tests/trustedDeviceChallengeService.test.js tests/authSessionService.test.js tests/csrfMiddleware.test.js tests/distributedRateLimit.test.js tests/authRecoveryCodeService.test.js tests/authMiddleware.admin.test.js` in `server`
- `npm.cmd test -- --runTestsByPath tests/authMiddleware.cookie.test.js tests/authRoutes.integration.test.js` in `server`
- `npm.cmd test -- src/services/deviceTrustClient.test.js` in `app`
- `npm.cmd audit --omit=dev --json` in the workspace root, `app`, and `server`
- `npm.cmd ls @electron/get @electron/asar @electron/rebuild node-gyp glob rimraf lodash.isequal electron-updater electron-builder` in the workspace root
- `npm.cmd exec electron -- --version` in the workspace root
- Desktop dependency version smoke for `electron`, `electron-updater`, `electron-builder`, `@electron/get`, `@electron/asar`, `@electron/rebuild`, `node-gyp`, `glob`, `rimraf`, and `fast-deep-equal`
- Native `DOMException` bridge and Firebase/Google Cloud import smoke in `server`
- `node scripts/check-lockfile-deprecations.js`
- `npm.cmd run security:prod-env-audit`
- `npm.cmd run security:prod-live-smoke`
- `npm.cmd run security:attack-smoke`
- `npm.cmd run security:login-gates`
- `git diff --check`

Note: `tests/otpSystem.test.js` was updated to document the same generic signup behavior, but isolated runs of that legacy suite timed out in this environment and were stopped after orphaned Jest processes remained active.

## 2026-07-10 Deep-Hardening Verification

- Focused regression tests were written to fail before the DPoP, identity precedence, global revocation, emergency logout, WebAuthn boundary, EC2 release contract, and owner replay fixes.
- `npm run security:login-gates` passed: all three production dependency audits found zero known vulnerabilities; login architecture tests passed 25/25; attack smoke passed 5/5; shared auth passed 164/164.
- `npm run security:tokens` passed 51/51; `npm run security:otp-reset` passed 165/165; IDOR and LiveKit authorization passed 18/18.
- Focused browser/desktop tests passed: login handoff 50/50 and desktop runtime 10/10.
- `npm run security:routes:coverage:strict` covered 97/97 registered route entries.
- `npm run security:secrets` passed across 2,371 repository files.
- Production hardening and login environment audits returned zero failures; the environment audit also returned zero warnings.
- JavaScript syntax checks passed for all 36 changed JavaScript files, both changed shell scripts passed `bash -n`, and `git diff --check` passed.

Merge assessment: Ready for a pull request based on the completed local evidence. Safe to merge only if the required GitHub checks pass for the final commit and the branch remains based on current `origin/main`. Production rollout must use the gated workflow, preserve rollback, and verify the served release SHA plus backend readiness after deployment.
