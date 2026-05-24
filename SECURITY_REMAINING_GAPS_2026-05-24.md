# Security Remaining Gaps - 2026-05-24

Scope: final local DevSecOps hardening pass before merge. Evidence is repository-local unless a command result is listed in the final report.

## 1. Existing Security Found

| Area | Existing protection | Evidence |
| --- | --- | --- |
| Central upload pipeline | Data URI and buffer uploads flow through size, extension, MIME, magic-byte, malware, and fail-closed scan checks. | `server/services/uploadSecurityPipeline.js` |
| Malware scanner | Built-in EICAR blocking plus optional ClamAV/YARA engines with fail-closed behavior. | `server/services/malwareScanService.js`, `server/tests/malwareScanService.test.js` |
| Review media magic bytes | Review image/video bytes are checked against declared media type before storage. | `server/utils/reviewMediaMagicBytes.js`, `server/tests/reviewMediaMagicBytes.test.js` |
| Avatar validation | Profile avatars reject unsupported MIME, SVG, oversized payloads, magic mismatch, malware, and scanner failure before profile update. | `server/controllers/userController.js`, `server/utils/avatarValidation.js`, `server/tests/uploadSecurityPipeline.test.js` |
| Listing image validation | Listing data URI images use the common upload security pipeline before listing create/update. | `server/controllers/listingController.js` |
| AI media validation | Assistant image and audio data URI payloads use the common upload security pipeline before model/provider work. | `server/controllers/aiController.js` |
| Visual search validation | Visual search data URI images are validated before search/model work. | `server/controllers/productController.js`, `server/tests/productControllerVisualSearchValidation.test.js` |
| Gemini remote media validation | Remote inline media fetches reject local/private/metadata targets, enforce streaming size caps, then validate bytes through the upload pipeline. | `server/services/ai/geminiGatewayService.js`, `server/tests/geminiGatewayService.test.js` |
| Upload tests | Valid uploads, MIME mismatch, magic-byte mismatch, oversized payloads, EICAR, scan failure, SVG rejection, unsafe filenames, and double extensions are covered. | `server/tests/uploadSecurityPipeline.test.js` |

## 2. Remaining Gaps

### Authentication

| Check | Status | Evidence | Gap |
| --- | --- | --- | --- |
| Login rate limit | Present | `server/routes/authRoutes.js`, `server/middleware/distributedRateLimit.js`, `server/tests/rate-limit.bypass.security.test.js` | Continue tuning multi-key pressure rules as traffic data grows. |
| Signup rate limit | Present | `server/controllers/otpController.js` signup identifier controls and OTP route Turnstile/rate limits | Add ASN/device prefix scoring when traffic volume justifies it. |
| Password reset rate limit | Present | OTP/recovery tests and OTP route limiters | Keep generic messaging and monitor abuse telemetry. |
| Invalid token rejection | Present | `server/tests/auth.tokens.security.test.js` | None known. |
| Expired token rejection | Present | `server/tests/auth.tokens.security.test.js` | None known. |
| Logout/session invalidation | Present | `server/services/browserSessionService.js`, `server/tests/auth.tokens.security.test.js`, `server/tests/authSessionService.test.js` | Refresh-token-family reuse detection is only needed if classic refresh tokens are introduced. |
| Secure cookie flags | Present | Cookie auth/session middleware and cookie tests | Keep production cookie config reviewed with deployment domains. |
| No token/password logging | Present by policy/tests | Security telemetry tests and secret scan scripts | Keep scanner gates blocking accidental secret exposure. |

### Authorization

| Check | Status | Evidence | Gap |
| --- | --- | --- | --- |
| User A cannot access user B data | Present | `server/tests/access-control.idor.security.test.js` | Continue adding resource-specific IDOR tests when new protected resources are added. |
| User A cannot edit user B resource | Present | `server/tests/access-control.idor.security.test.js` | None known for covered resources. |
| Non-admin cannot access admin APIs | Present | `server/tests/admin.privilege.security.test.js`, `server/tests/adminRouteSurfaceSecurity.test.js` | None known for covered admin routes. |
| Unauthenticated users cannot access protected APIs | Present | Auth middleware and route surface tests | Keep new routes in the authorization policy inventory. |
| Object ownership checks exist | Present | Orders, payments, addresses, saved payment methods, and list endpoints covered | Expand coverage with every new object type. |

### Uploads

| Check | Status | Evidence | Gap |
| --- | --- | --- | --- |
| Every server-accepted upload route uses central pipeline | Present for current byte-accepting routes | `docs/auth-free-security-inventory-2026-05-24.md`, `server/services/uploadSecurityPipeline.js` | Support/admin/KYC raw attachments are not current byte-upload surfaces; route through this pipeline if introduced. |
| Infected files blocked | Present | `server/tests/uploadSecurityPipeline.test.js`, `server/tests/malwareScanService.test.js` | None known. |
| Scan failures blocked | Present | `server/tests/uploadSecurityPipeline.test.js` | Local dev can disable external engines, but the pipeline blocks engine errors by default. |
| Magic-byte mismatch blocked | Present | `server/tests/uploadSecurityPipeline.test.js`, `server/tests/reviewMediaMagicBytes.test.js` | None known. |
| MIME mismatch blocked | Present | `server/tests/uploadSecurityPipeline.test.js` | None known. |
| Oversized file blocked | Present | `server/tests/uploadSecurityPipeline.test.js` | None known. |
| Double extension blocked | Present | `server/tests/uploadSecurityPipeline.test.js` | None known. |
| Path traversal filename blocked | Present | `server/tests/uploadSecurityPipeline.test.js` | None known. |
| Remote media SSRF blocked | Present | `server/tests/geminiGatewayService.test.js` | Continue blocking DNS rebinding/private ranges if more remote fetchers are added. |

### API

| Check | Status | Evidence | Gap |
| --- | --- | --- | --- |
| Request body limits | Present | `server/index.js` JSON and URL encoded limits | Keep route-specific limits low for auth/upload surfaces. |
| Schema validation | Present on major route groups | Validators and route tests | Continue requiring validators for new mutating routes. |
| Rate limits | Present | Distributed limiter and bypass tests | Continue measuring false positives. |
| Strict CORS | Present | `server/tests/config.cors-csrf.security.test.js` | Keep deployment origin allowlist current. |
| Safe error messages | Present on security surfaces | Auth, IDOR, and route tests | Review new endpoints for enumeration leaks. |
| Security headers | Present | `server/tests/config.headers.security.test.js` | None known. |

### Secrets

| Check | Status | Evidence | Gap |
| --- | --- | --- | --- |
| `.env` ignored | Present | `.gitignore`, `server/.dockerignore` | None known. |
| `.env.example` exists | Present for server AWS secrets | `server/.env.aws-secrets.example` | Add more examples only when new required vars are introduced. |
| No secrets in repo | Passed | `npm run security:gitleaks`, `npm run security:secrets` | No new leaks found in final local gates. |
| No secrets in git history | Passed with baseline | `npm run security:gitleaks`, `.gitleaks-baseline.json`, `ROTATE_SECRETS_REQUIRED.md` | Historical redacted baseline requires rotation of previously exposed values without rewriting history or force pushing. |

### Docker

| Check | Status | Evidence | Gap |
| --- | --- | --- | --- |
| Non-root user | Present | `server/Dockerfile` uses `USER node` | None known. |
| No `.env` copied | Present | `server/.dockerignore` excludes env files and key material | None known. |
| `NODE_ENV=production` | Present | `server/Dockerfile` | None known. |
| Healthcheck | Present | `server/Dockerfile` checks `/health/live` | Validated through Docker image build/scan. |
| No unnecessary exposed ports | Present | Only `EXPOSE 5000` for API runtime | None known. |
