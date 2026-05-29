# Auth Threat Model

## Assets

- User accounts and profile data
- Admin, support, and seller privileges
- Browser session cookies and CSRF tokens
- Firebase ID tokens and Keycloak OIDC tokens
- Password reset, OTP, recovery-code, and trusted-device flows
- Audit logs and security metrics

## Trust Boundaries

- Browser to frontend app
- Frontend app to backend API
- Backend to Firebase Admin
- Backend to Keycloak JWKS and token endpoints
- Backend to MongoDB and Redis
- GitHub Actions to deployment providers

## Key Threats And Controls

| Threat | Control |
| --- | --- |
| Phishing and password reuse | Keycloak OIDC path, provider MFA/passkeys, Duo/WebAuthn step-up for privileged actions |
| Token forgery | Firebase Admin validation for legacy tokens; Keycloak issuer, audience, expiry, signature, and JWKS validation |
| `alg=none` or weak JWT algorithms | OIDC verifier rejects unsigned tokens and only allows RS256 |
| Session theft | HttpOnly cookie sessions, SameSite Lax, Secure in production/HTTPS, server-side revocation |
| CSRF | Existing CSRF token flow for cookie-session writes |
| Account enumeration | Existing generic OTP/recovery responses and rate limiting |
| Brute force | Distributed rate limits on auth sync, OTP, phone factor, recovery code, trusted device, Duo, and enterprise OIDC |
| Privilege drift | Admin middleware re-checks MongoDB before allowing admin access |
| Stale client diagnostics cookies | Diagnostics ingest accepts anonymous/stale sessions so it can report auth failures instead of failing with 401 |
| WebSocket CSP block | HTML meta CSP now includes the CloudFront HTTPS and WSS backend origins |
| Secret leakage | Env examples use placeholders; secret scan remains in CI |

## Residual Risk

- Keycloak production MFA/passkey policy is configured in the IdP, not hardcoded in the app.
- Existing Firebase auth remains active during rollout and must be monitored until deprecation.
- Production login failures still require live backend logs to distinguish provider misconfiguration from account-state problems.

## Abuse Cases To Keep Testing

- Expired access token rejected
- Wrong issuer rejected
- Wrong audience rejected
- Unsigned JWT rejected
- Admin route denied for normal users
- Seller route denied for normal users
- Diagnostics post accepted with stale cookies
- OTP and recovery flows return safe messages under invalid input
