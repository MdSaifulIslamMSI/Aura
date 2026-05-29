# Auth Inventory

## Stack

- Repository: Node/npm workspace.
- Frontend: React + Vite in `app/`, Firebase client auth, Vitest, Playwright, Capacitor shell.
- Backend: Express 5 in `server/`, CommonJS, MongoDB/Mongoose, Redis session and rate-limit paths, Jest.
- Desktop: Electron wrapper in `desktop/`.
- Deployment: Vercel/Netlify frontend rewrites to CloudFront backend, AWS/backend Docker and workflow assets, GitHub Actions.

## Current Authentication

- Firebase email/password, phone OTP, and social auth for Google, Facebook, GitHub, X, Microsoft, and Apple-ready flags.
- Server validates Firebase bearer tokens with Firebase Admin.
- Server creates hardened browser sessions through `aura_sid` after `/api/auth/exchange`, `/api/auth/session`, or `/api/auth/sync`.
- CSRF tokens are issued for cookie-session writes.
- Duo OIDC exists as a step-up and login path.
- WebAuthn/trusted-device challenge paths support high-assurance actions.
- Recovery codes and OTP flows exist for account recovery.

## User Model

Primary model: `server/models/User.js`

- Identity: `email`, `authUid`, `phone`
- Roles: `isAdmin`, `adminRoles`, `isSeller`
- Verification: `isVerified`, OTP assurance timestamps
- Recovery and MFA-adjacent state: `trustedDevices`, `recoveryCodes`, `authAssurance`
- Account safety: `accountState`, `softDeleted`, `moderation`

## Sessions And Tokens

- Browser session service: `server/services/browserSessionService.js`
- Auth middleware: `server/middleware/authMiddleware.js`
- Cookie session is HttpOnly and SameSite Lax; Secure is enabled when production or HTTPS is detected.
- Token revocation and cache invalidation are enforced before route access.
- New OIDC verifier rejects unsigned tokens, wrong issuer, wrong audience, expired tokens, unsupported algorithms, and missing signing keys.

## Authorization

- Existing route protection: `protect`, `admin`, `seller`, `requireOtpAssurance`.
- New centralized role/permission helpers: `server/services/auth/authorizationService.js`.
- Roles currently mapped from existing fields: `user`, `seller`, `support`, `admin`, `service`.
- Permission style: `resource:action`, including wildcard permissions such as `admin:*`.

## Security Middleware

- CSRF middleware: `server/middleware/csrfMiddleware.js`
- CORS config: `server/config/corsFlags.js`
- CSP/security headers: `server/index.js`, `vercel.json`, `app/vercel.json`, `netlify.toml`, `app/index.html`
- Rate limiting: `server/middleware/distributedRateLimit.js`, with auth-specific route limiters.
- Request IDs: `server/middleware/requestId.js`
- Audit/metrics: `server/services/authSecurityTelemetryService.js`

## CI/CD

- GitHub Actions: `.github/workflows/ci.yml`, `security.yml`, `security-gates.yml`, and scanner workflows.
- Existing scripts include lint, build, test, auth smoke, secret scan, dependency scan, and scanner wrappers.
- Added scripts:
  - `auth:env:validate`
  - `auth:smoke`

## Deployment And Config Risk

- Frontend CSP must stay aligned across `app/index.html`, `vercel.json`, `app/vercel.json`, and `netlify.toml`.
- Production IdP credentials must be injected as runtime secrets only.
- No real Keycloak admin password, client secret, state secret, private key, OTP secret, or Firebase service credential belongs in Git.
