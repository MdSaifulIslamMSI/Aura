# Elastic Login Test Architecture

## Overview

Our login test architecture is designed as an elastic generated testing framework, not a fixed test suite. The current matrix supports approximately 1.04 billion logical authentication/security combinations across roles, account states, password cases, email cases, token states, session states, OTP states, device states, rate-limit states, and route types. The system does not execute all combinations by default. Instead, it runs optimized risk-based subsets: small smoke tests for normal changes, larger generated tests for authentication changes, heavy security tests for token/session/OTP/RBAC changes, and critical expanded batches before major releases. The ceiling is expandable by adding new risk dimensions such as browser type, OS, geo-risk, fraud score, payment-risk state, API version, and behavioral-risk patterns.

## Detected Stack

- Frontend: React 19, Vite, React Router, Firebase client auth, Vitest, Playwright.
- Backend: Node.js, Express 5, CommonJS, Mongoose/MongoDB, Firebase Admin token verification, Redis-backed distributed rate limiting when enabled.
- Auth routes: `/api/users/login`, `/api/users/profile`, `/api/users/seller/activate`, `/api/auth/exchange`, `/api/auth/session`, `/api/auth/sync`, `/api/auth/logout`, `/api/auth/bootstrap-device-challenge`, `/api/auth/recovery-codes`, `/api/auth/recovery-codes/verify`, `/api/auth/complete-phone-factor-login`, `/api/auth/complete-phone-factor-verification`, `/api/auth/verify-device`, and `/api/auth/otp/*`.
- Security middleware/services: `authMiddleware`, CSRF middleware, distributed rate limiter, XSS sanitizer, request timeout middleware, auth session service, browser session service, risk engine, recovery code service, trusted device challenge service, and security event telemetry.
- Existing tests: Jest backend auth/security tests, Vitest frontend tests, Playwright E2E, GitHub Actions Production CI/CD, AWS runtime contract checks.

## Current Login Flow

The app uses Firebase identity proof plus backend session hardening. The client obtains Firebase auth state, calls protected backend auth/user routes, and the backend verifies tokens through `protect` middleware. Backend auth then creates or syncs an application user profile, issues browser session cookies where applicable, validates CSRF for cookie sessions, applies distributed rate limits, and checks trusted-device or phone-factor proof for higher-risk flows.

The backend is the source of truth for roles and protected route access. Frontend role state is treated as display state only; admin, seller, support, delivery, and payment-sensitive access must be enforced server-side.

## Current Weaknesses Found

- Existing auth coverage is strong but spread across many files; it was not exposed as a single elastic matrix architecture.
- CI E2E previously switched to hosted Chrome to avoid apt timeouts, but Playwright failure video still required bundled ffmpeg. CI now disables Playwright video while preserving screenshots and traces.
- Local AWS CLI credentials were expired during inspection, so production AWS validation should use GitHub Actions OIDC and public smoke endpoints unless AWS login is refreshed.
- Heavy generated and load tests must remain explicit and safe; they must not hit real email, SMS, payment providers, or production secrets.

## Matrix

Base dimensions:

- 6 roles
- 7 account states
- 12 password cases
- 9 email cases
- 12 token states
- 8 session states
- 7 OTP states
- 7 device states
- 7 rate-limit states
- 7 route types

Current matrix:

- Logical combinations: `1,045,529,856`
- Smoke run: `100-500 checks`
- Core run: `800-2,000 checks`
- Security run: `1,000-5,000 checks`
- Generated run: `5,000-50,000 checks`
- Nightly run: `100,000-500,000+ checks`
- Critical run: `500,000-1,000,000+ checks`

Professional explanation:

"Our login test architecture is designed as an elastic generated testing framework, not a fixed test suite. The current matrix supports approximately 1.04 billion logical authentication/security combinations across roles, account states, password cases, email cases, token states, session states, OTP states, device states, rate-limit states, and route types. The system does not execute all combinations by default. Instead, it runs optimized risk-based subsets: small smoke tests for normal changes, larger generated tests for authentication changes, heavy security tests for token/session/OTP/RBAC changes, and critical expanded batches before major releases. The ceiling is expandable by adding new risk dimensions such as browser type, OS, geo-risk, fraud score, payment-risk state, API version, and behavioral-risk patterns."

## Auto-Expand Mode

Auto-Expand Mode allows the login test matrix to grow automatically when authentication/security risk increases. The base matrix supports approximately 1.04 billion logical combinations. When higher-risk changes are detected, the architecture enables additional dimensions such as browser type, OS, geo-risk, fraud score, payment-risk state, API version, and behavioral-risk state. This can expand the logical ceiling beyond 500 billion, into trillions if required. The system does not execute the full ceiling by default; it uses risk-weighted, pairwise, boundary, attack-focused, and seeded generated testing to execute practical subsets.

| Level | Enabled Dimensions | Logical Ceiling |
| --- | --- | ---: |
| Level 0 | Base matrix | 1.04 billion |
| Level 1 | Base x browser x OS | 26.13 billion |
| Level 2 | Base x browser x OS x geo-risk x fraud-score | 653.45 billion |
| Level 3 | Base x browser x OS x geo-risk x fraud-score x payment-risk | 3.26 trillion |
| Level 4 | Base x browser x OS x geo-risk x fraud-score x payment-risk x API version x behavior-risk | 49.01 trillion |

The exact Level 4 computed ceiling is `49,009,212,000,000` combinations based on the configured dimensions.

## Elastic Scaling

Small changes run smoke tests. Login API changes run smoke, core, and selected generated login cases. Token, session, OTP, RBAC, recovery, fraud, or payment-security changes expand the generated matrix automatically. Major releases can run nightly or critical sampled batches.

The architecture uses:

- deterministic seeds
- pairwise sampling
- risk-weighted sampling
- boundary cases
- attack-path sampling
- historical failure replay hooks
- safe provider-free local execution

It does not run 1 billion tests every day.

Correct claim:

"The architecture supports approximately 1.04 billion logical authentication/security combinations and executes optimized risk-based subsets depending on the change type."

Final professional claim:

"This login architecture supports approximately 1.04 billion logical authentication/security combinations through an elastic generated test matrix. It executes optimized risk-based subsets during normal development and can increase test depth when higher-risk login, token, session, OTP, RBAC, recovery, or payment-security changes require stronger validation."

## Commands

```bash
npm run test:auth:count
npm run test:auth:count -- --expand=level_1_device
npm run test:auth:count -- --expand=level_2_risk
npm run test:auth:count -- --expand=level_3_payment_security
npm run test:auth:count -- --expand=level_4_critical
npm run test:auth:risk
npm run test:auth:smoke
npm run test:auth
npm run test:auth:security
npm run test:auth:generated
npm run test:auth:nightly
npm run test:auth:critical
npm run test:auth:auto
npm run test:auth:auto:count
npm run test:auth:auto:critical
```

Safe load tests:

```bash
npm run test:auth:load
node scripts/run-auth-load.js tests/auth/load/brute-force-simulation.k6.js
node scripts/run-auth-load.js tests/auth/load/refresh-token-load.k6.js
node scripts/run-auth-load.js tests/auth/load/password-reset-load.k6.js
```

Load tests default to local targets and refuse non-local URLs unless explicitly approved through environment configuration.

## Risk Classifier

`scripts/classify-auth-change-risk.js` inspects changed files and prints:

- changed files
- risk level
- Auto-Expand level
- enabled extra dimensions
- base ceiling
- expanded ceiling
- recommended command
- estimated execution count
- reasons

Examples:

- CSS or login UI: `npm run test:auth:smoke`
- Login controller or validators: `npm run test:auth:generated`
- session, device, cookie, rate-limit, fraud: `npm run test:auth:security`
- JWT, refresh token, role middleware, OTP/MFA, recovery, production security config: `npm run test:auth:critical`
- payment, checkout, saved card, refund boundaries: `npm run test:auth:critical` with payment-security expansion

## Generated Failure Replay

Generated failures must include:

- expansion level
- seed
- base matrix values
- expanded dimension values
- endpoint or route type
- expected result
- actual result
- reproduction command

Example:

```text
FAILED GENERATED AUTH CASE

Expansion Level:
level_2_risk

Seed:
AUTH-2026-LEVEL2-88421

Case:
role = admin
tokenState = tampered_access_token
sessionState = suspicious_session
browserType = safari
osType = ios
geoRiskState = impossible_travel
fraudScoreLevel = critical
routeType = admin_route

Expected:
403 or reauthentication required

Actual:
200 OK

Reproduce:
npm run test:auth:generated -- --seed=AUTH-2026-LEVEL2-88421
```

## Security Categories Covered

- successful and failed login behavior
- generic credential errors and enumeration prevention
- disabled, deleted, locked, unverified, reset-required, and MFA-required accounts
- malformed, expired, tampered, wrong-secret, missing, reused, and revoked tokens
- session expiry, logout, revocation, suspicious sessions, and password reset invalidation
- CSRF for cookie-backed auth
- OTP/MFA bypass and reuse prevention where supported
- customer/seller/admin/super-admin/support/delivery route policy
- rate limit and brute force behavior
- reset-token and recovery-code reuse
- suspicious device and reauthentication gates
- payment-security authentication boundaries
- response privacy for passwords, hashes, OTPs, reset tokens, and refresh-token hashes

## Future Expansion Dimensions

- vectorized device trust signals
- browser type
- OS type
- geo-risk state
- fraud score
- API version
- payment-risk state
- behavioral-risk pattern
- known breached credential source
- bot score
- device attestation result
- tenant or region policy

## Limitations

- The generated V1 evaluates policy-level auth cases and wraps existing backend Jest tests; it does not replace live end-to-end login testing.
- The current project primarily represents roles with `isAdmin`, `isSeller`, verification, moderation, and assurance fields; the matrix includes support and delivery roles as future-ready route-policy dimensions.
- Nightly and critical runs are intentionally sampled. The logical ceiling is a design ceiling, not a daily execution volume.
- AWS production validation depends on GitHub Actions OIDC or refreshed local AWS credentials.
