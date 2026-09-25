# Security Architecture Rating Report

## 1. Executive Score

Overall Score: 70/100

Security Level: Medium

One-line verdict: This codebase has unusually strong application-security controls for a marketplace app, but current production/deployment defaults and desktop release settings keep it out of production-grade territory.

2026-06-01 hardening update: the desktop signing/update defaults, EC2 anonymous AI default, Resend webhook route limiter, and production CSP localhost/inline-style findings were tightened after this report. The original rows remain below as historical review context; use the current code, `docs/security/risk-register.md`, and the security harness checks as the live posture source.

## 2. Project Overview

- App type: Public commerce marketplace with AI shopping assistant, payment flows, admin operations, web frontend, API backend, Electron desktop shell, and Capacitor mobile app.
- Tech stack: React 19/Vite frontend; Express 5/Node backend; MongoDB via Mongoose; Redis for distributed security state; Firebase Auth/Admin; Stripe and Razorpay payments; Resend email webhooks; LiveKit; OpenAI/local AI provider support; Electron/electron-builder; Docker/EC2/Caddy/CloudFront/Vercel/Netlify/GitHub Actions.
- Main assets: User accounts, Firebase tokens, browser sessions, OTP/recovery codes, admin privileges, order/payment data, saved payment method references, addresses/phones/emails, review media, AI prompts/responses, webhook secrets, deployment credentials, logs.
- Main entry points: Express routes under `server/index.js`, API routes in `server/routes`, public frontend routes in `app/src`, Electron local runtime proxy in `desktop/runtimeServer.cjs`, webhook receivers, internal cron routes, CI/CD workflows.
- Trust boundaries: Browser/mobile/desktop clients to API; CDN/edge to backend; backend to MongoDB/Redis; backend to payment/email/AI/LiveKit providers; admin users to privileged routes; CI/CD to cloud deployments; Electron renderer to local runtime proxy.

## 3. Top 10 Security Risks

| Rank | Severity | Risk | Evidence | Impact | Fix |
|---:|---|---|---|---|---|
| 1 | High | Secret-bearing AWS env file can be copied into backend Docker images | `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\server\.dockerignore` excludes `.env`, `.env.local`, `.env.azure-secrets` but not `.env.aws-secrets`; `server\Dockerfile:19` copies `.` into the image; local `server\.env.aws-secrets` exists | Secrets can be baked into registry/image layers if built from this checkout | Add `.env*` and secret allowlist-denylist to `.dockerignore`; prefer explicit `COPY` allowlist; rotate any real secrets that entered build contexts |
| 2 | High | Desktop backend proxy disables TLS certificate verification | `desktop\runtimeServer.cjs:71-77`, `buildProxyOptions`, sets `secure: false` for HTTPS proxying to backend | Network MITM with a bad certificate can intercept API traffic from desktop clients | Set `secure: true` by default; allow insecure proxy only for local dev loopback targets |
| 3 | High | Desktop auto-update/release is not code-signature safe | `package.json:154-155`, `signAndEditExecutable: false`, `verifyUpdateCodeSignature: false`; `desktop\main.cjs:424-427` enables auto-update | Compromised release channel or unsigned artifact can compromise clients | Require platform code signing, enable update signature verification, publish provenance/checksums |
| 4 | High | Production AWS compose defaults anonymous AI chat to enabled | `infra\aws\docker-compose.ec2.yml:15`; `server\routes\aiRoutes.js:36-50,91-92`; `server\controllers\aiController.js:132-156` only applies private quota to authenticated users | Public users can spend AI resources and send arbitrary prompts when provider is enabled | Default public AI off in production; require auth or strict anonymous quotas/cost caps |
| 5 | Medium | Public translation endpoint proxies anonymous text to Google Translate | `server\routes\i18nRoutes.js:8`; `server\services\i18n\translationService.js:9,76`; no auth or route-specific limiter | Abuse of upstream dependency and privacy disclosure of submitted text | Require auth or tight per-IP quota/cache; disclose third-party translation; add route limiter |
| 6 | Medium | Email webhook bypasses global limiter and has no webhook-specific limiter | `server\index.js:418-422` skips `/api/email-webhooks`; `server\routes\emailWebhookRoutes.js:6`; `emailWebhookController.js:13-33` verifies signatures | Invalid webhook floods can burn CPU/log volume before rejection | Add route-specific IP and event-id limiter plus request-size limits |
| 7 | Medium | Redis deployment has no auth/TLS in compose and is security-control critical | `infra\aws\docker-compose.ec2.yml:109-114`; `docker-compose.split-runtime.yml:33-41` | Host/container-network compromise can tamper with CSRF/rate/session state | Use managed Redis or Redis ACL/TLS, private networking, backups, and monitoring |
| 8 | Medium | Review uploads lack magic-byte scanning and malware moderation; local storage is default | `server\controllers\uploadController.js:14-28,122-140`; `server\services\reviewMediaStorageService.js:41-42,120-128` | Storage abuse, malware hosting, disk exhaustion, moderation gaps | Enforce production S3/object storage, file signatures, AV/media scanning, per-user quotas |
| 9 | Medium | CI actions are version-tag pinned, not commit-SHA pinned | `.github\workflows\ci.yml:71,88,187`; deployment workflows use many `uses: action@v*` tags | Compromised action tags/accounts can affect CI/CD supply chain | Pin third-party actions by full SHA; use Dependabot/renovate for updates |
| 10 | Medium | Production CSP allows localhost connections and Firebase tokens use browser local persistence | `vercel.json:48`, `app\vercel.json:46`, `netlify.toml:8`; `app\src\config\firebase.js:217` | XSS or compromised script has larger token/local-service blast radius | Remove localhost from web CSP; prefer HttpOnly server sessions or memory persistence for web |

## 4. Category Scorecard

| Category | Score | Findings | Confidence |
|---|---:|---|---|
| Threat model and architecture clarity | 8/10 | Existing threat model and many security docs/tests; some trust boundaries still implicit in deployment | High |
| Authentication security | 8/10 | Firebase revocation checks, session CSRF, OTP/rate limits, admin MFA/passkey policy; local persistence and complexity remain | High |
| Authorization and access control | 11/15 | Strong admin middleware and active-account gates; broad manual route composition raises coverage risk | Medium |
| Input validation and injection resistance | 9/12 | Zod validation, Mongo sanitization, XSS sanitization, safe React markdown defaults; public translation/upload gaps | High |
| Data protection and privacy | 6/10 | Good cookie flags/log redaction; PII in models/logs, local token persistence, third-party AI/translation exposure | Medium |
| Secrets and configuration security | 5/10 | Production asserts and gitignore are good; Docker build-context secret risk is serious | High |
| Dependency and supply-chain security | 6/10 | Lockfiles, gitleaks, npm audit scripts; unsigned desktop and SHA-unpinned actions weaken maturity | High |
| Infrastructure/deployment security | 6/10 | Non-root pinned Docker image and edge headers; single-host Redis/uploads and risky AI default | High |
| Logging, monitoring, incident readiness | 4/5 | Metrics, audit logs, redaction, health checks; webhook limiter gap | High |
| Secure SDLC maturity | 7/8 | Many security tests/scripts/docs; stronger provenance/SBOM/release attestation still needed | Medium |

## 5. Attack Path Analysis

1. Build-context secret leakage: developer/CI builds `server` image from a checkout containing `server\.env.aws-secrets`; Docker copies it into the image; registry, artifact, or runtime user can recover secrets; attacker uses secrets for Duo/cloud/auth abuse.
2. Desktop MITM: attacker controls network path; desktop local proxy connects to HTTPS backend with `secure: false`; forged certificate is accepted; attacker observes or modifies API traffic.
3. Desktop release compromise: release token or GitHub release is compromised; app auto-updater downloads unsigned/unverified build; client is compromised.
4. Anonymous AI cost abuse: public user calls `/api/ai/chat` repeatedly; route-level IP limit is the main barrier; provider cost and service availability are affected.
5. Translation privacy/abuse: anonymous user posts batches to `/api/i18n/translate`; backend forwards text to Google Translate; private text can leave the system and upstream can be abused.
6. Webhook flood: attacker sends invalid Resend webhook requests; route bypasses global limiter; server spends work verifying/logging rejects.
7. Redis tampering after host compromise: attacker reaches internal Redis; modifies session/rate/CSRF state; security controls degrade.
8. Upload abuse: authenticated user uploads allowed MIME with misleading content; media is stored and publicly served without AV/content scanning.
9. CI supply-chain compromise: third-party GitHub Action tag is replaced upstream; CI runs malicious action with workflow permissions/secrets.
10. XSS blast-radius escalation: any frontend XSS or compromised dependency can read Firebase local persistence and connect to localhost endpoints allowed by production CSP.

Text trust boundary diagram:

`Browser/Mobile/Desktop -> CDN/Edge/Vercel/Netlify/CloudFront -> Express API -> MongoDB/Redis`

`Express API -> Stripe/Razorpay/Resend/Google Translate/OpenAI-or-local-AI/LiveKit/S3`

`GitHub Actions -> Cloud/Vercel/Netlify/GitHub Releases`

`Electron Renderer -> Local Runtime Proxy -> Remote API`

## 6. Architecture Strengths

- Strong backend authentication posture: Firebase token revocation, browser-session support, CSRF for cookie sessions, global session revocation, active-account enforcement.
- Admin protection is materially above average: allowlist, email verification, fresh login, 2FA/passkey, Duo step-up, and structured admin-block logging.
- Payment flow has strong controls: protected routes, OTP assurance, idempotency keys, webhook signature checks, event dedupe, amount/currency/order matching.
- Security headers, CORS allowlist, health/metrics auth, raw-body webhook handling, log redaction, and structured metrics are present.
- CI/SDLC maturity is visible: gitleaks, npm audit scripts, security test plans, threat-model docs, and many focused security tests.

## 7. Architecture Weaknesses

- Deployment/release defaults are not aligned with the strength of the application-layer code.
- Secrets hygiene is fragile because local secret files exist and one is not excluded from Docker build context.
- Desktop security has strong renderer isolation but weak transport/update assurance.
- Public AI/translation surfaces are enabled or open in ways that can create cost, privacy, and abuse risk.
- Infrastructure relies on single-host Redis/uploads in compose examples, which is weak for a payment marketplace.
- Route security is manually composed across many files, making authorization coverage hard to prove from a central policy map.

## 8. File-by-File Evidence

- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\server\index.js`: Helmet, CORS allowlist, raw body capture, rate limits, metrics, health readiness, route registration, upload serving.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\server\middleware\authMiddleware.js`: Firebase token verification with revocation, session handling, CSRF enforcement, admin policy, step-up checks.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\server\services\browserSessionService.js`: HttpOnly/Secure/SameSite cookie serialization, idle/absolute TTLs, Redis-backed sessions, memory fallback controls.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\server\routes\paymentRoutes.js`: Payment routes require auth/active account/OTP assurance, webhooks exposed unauthenticated as expected.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\server\services\payments\paymentService.js`: Webhook signature verification, duplicate event detection, payment amount/currency/order checks.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\server\routes\aiRoutes.js`: Public AI access mode and route limiters.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\server\routes\i18nRoutes.js`: Public translation route.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\server\controllers\uploadController.js`: Signed review upload token, MIME/size checks, base64 data URL handling.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\server\services\reviewMediaStorageService.js`: Local/S3 media storage selection, local default.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\server\.dockerignore` and `server\Dockerfile`: Docker context and copy behavior causing secret packaging risk.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\desktop\runtimeServer.cjs`: Local runtime API proxy, `secure: false`.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\desktop\main.cjs`: Secure Electron renderer defaults, auto-update enabled.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\package.json`: Desktop publish target, disabled signing/signature verification.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\.github\workflows\*.yml`: Least-privilege permissions in many jobs, gitleaks/npm audit, but action tags not SHA-pinned.
- `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend\vercel.json`, `app\vercel.json`, `netlify.toml`: Security headers and CSP, with localhost allowed in production `connect-src`.

## 9. Priority Fix Roadmap

### Fix in 24 hours

- Add `.env*`, `.env.aws-secrets*`, cloud credential files, `.vercel`, and generated secret artifacts to `server\.dockerignore`; rebuild from a clean context.
- Change `desktop\runtimeServer.cjs` proxy TLS verification to secure by default.
- Set `AI_PUBLIC_CHAT_ACCESS_ENABLED` default to false in production deploy configs.
- Add a route-specific limiter to `/api/email-webhooks/resend`.

### Fix this week

- Enable desktop code signing and update signature verification.
- Add route-level auth/rate controls to `/api/i18n/translate`.
- Remove localhost from production web CSP unless served only to desktop-specific builds.
- Add media upload magic-byte checks, per-user quotas, and production object-storage requirement.

### Fix this month

- Move Redis/uploads to managed, authenticated, monitored services for production.
- Pin all third-party GitHub Actions to immutable commit SHAs.
- Add SBOM/provenance/attestation to releases, especially desktop/mobile.
- Build a central route security matrix and test that every state-changing route has expected auth, CSRF, validation, and rate-limit controls.

### Long-term architecture improvements

- Treat AI, translation, and upload as separate abuse-budgeted services with clear quotas, privacy notices, and data-retention policy.
- Move web auth toward HttpOnly server sessions or in-memory Firebase persistence where feasible.
- Add periodic threat-model refreshes tied to release gates and incident exercises.
- Add production-ready HA/DR architecture docs for MongoDB, Redis, media, queues, and payment reconciliation.

## 10. Final Recommendation

- Local demo: Yes, safe enough.
- Internal use: Yes, with trusted users and non-production credentials.
- Beta users: Conditional. Fix Docker secret context, desktop TLS/update assurance, and public AI/translation controls first.
- Public production: No for a commerce/payment marketplace until the 24-hour and this-week items are closed.
- Enterprise/high-risk use: No. Needs signed/provenanced releases, hardened infrastructure, centralized authorization assurance, and stronger data-governance evidence.

## Issue Details

### 1. Docker build-context secret risk

- Severity: High
- Confidence: High
- Type: Config-level and architecture-level
- Evidence: `server\.dockerignore` omits `.env.aws-secrets`; `server\Dockerfile:19` copies the full server context; local `server\.env.aws-secrets` exists.
- Exploitability: Any image build from this checkout can package secrets into image layers.
- Business impact: Credential disclosure and downstream account/provider compromise.
- Fix: Exclude all secret files from Docker contexts, use explicit copy allowlists, build from clean CI, rotate exposed secrets.

### 2. Desktop proxy TLS verification disabled

- Severity: High
- Confidence: High
- Type: Code-level and architecture-level
- Evidence: `desktop\runtimeServer.cjs:71-77`, function `buildProxyOptions`, sets `secure: false`.
- Exploitability: A network MITM can present an invalid certificate and still be accepted by the desktop proxy.
- Business impact: Token, PII, order, and payment-flow interception or manipulation.
- Fix: Use `secure: true`; gate insecure mode behind explicit development-only loopback config.

### 3. Desktop release/update trust is weak

- Severity: High
- Confidence: High
- Type: Config-level and process-level
- Evidence: `package.json:154-155`; `desktop\main.cjs:424-427`.
- Exploitability: Unsigned/unverified update artifacts reduce the attacker effort needed after release-channel compromise.
- Business impact: Client compromise and loss of customer trust.
- Fix: Enable signing and update signature verification; add release provenance.

### 4. Anonymous AI surface default

- Severity: High
- Confidence: High
- Type: Architecture-level and config-level
- Evidence: `infra\aws\docker-compose.ec2.yml:15`; `server\routes\aiRoutes.js:36-50,91-92`; `server\controllers\aiController.js:132-156`.
- Exploitability: Anonymous users can call chat endpoints if provider is enabled and the default is not overridden.
- Business impact: AI spend, availability loss, abuse content, privacy concerns.
- Fix: Auth-gate production AI chat or use strict anonymous quotas and cost ceilings.

### 5. Public translation proxy

- Severity: Medium
- Confidence: High
- Type: Architecture-level and code-level
- Evidence: `server\routes\i18nRoutes.js:8`; `server\services\i18n\translationService.js:9,76`.
- Exploitability: Anonymous caller sends text that the server forwards to Google Translate.
- Business impact: Upstream abuse and privacy exposure.
- Fix: Add auth, strict quota, caching, and privacy disclosure.

### 6. Email webhook rate-limit gap

- Severity: Medium
- Confidence: High
- Type: Code-level and config-level
- Evidence: `server\index.js:418-422`; `server\routes\emailWebhookRoutes.js:6`; `server\controllers\emailWebhookController.js:13-33`.
- Exploitability: Invalid webhook requests bypass global rate limiting and reach verification/logging.
- Business impact: CPU/log DoS and noisy incident response.
- Fix: Add dedicated webhook limiter and request-size guard.

### 7. Redis production hardening gap

- Severity: Medium
- Confidence: High
- Type: Infrastructure-level
- Evidence: `infra\aws\docker-compose.ec2.yml:109-114`; `docker-compose.split-runtime.yml:33-41`.
- Exploitability: Requires host/container network access; Redis itself has no auth in compose.
- Business impact: Security-control state tampering after infrastructure compromise.
- Fix: Managed/private Redis with ACL/TLS, network policy, backups, monitoring.

### 8. Upload scanning gap

- Severity: Medium
- Confidence: High
- Type: Architecture-level and code-level
- Evidence: `server\controllers\uploadController.js:14-28,122-140`; `server\services\reviewMediaStorageService.js:41-42`.
- Exploitability: Authenticated users can upload allowed MIME/data URL content without deep inspection.
- Business impact: Malware/content abuse, disk/storage pressure, brand risk.
- Fix: Magic-byte checks, AV scanning, quotas, object storage, moderation pipeline.

### 9. GitHub Actions not SHA pinned

- Severity: Medium
- Confidence: High
- Type: Supply-chain/process-level
- Evidence: `.github\workflows\ci.yml:71,88,187`; deploy workflows use tag-pinned actions.
- Exploitability: Compromised third-party action tag can execute in CI.
- Business impact: Build, deploy, or secret compromise.
- Fix: Pin external actions by SHA and automate reviewed updates.

### 10. Web token/CSP blast radius

- Severity: Medium
- Confidence: Medium
- Type: Architecture-level and config-level
- Evidence: `app\src\config\firebase.js:217`; `vercel.json:48`; `app\vercel.json:46`; `netlify.toml:8`.
- Exploitability: Requires XSS or compromised frontend dependency, then local persistence and localhost CSP widen impact.
- Business impact: Account/session compromise and local-service reachability.
- Fix: Remove localhost from web CSP, isolate desktop CSP, consider HttpOnly sessions or memory persistence.
