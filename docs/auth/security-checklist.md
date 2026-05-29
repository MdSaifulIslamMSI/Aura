# Auth Security Checklist

- [x] Legacy auth preserved behind `AUTH_PROVIDER=legacy`.
- [x] Keycloak OIDC provider added behind `AUTH_PROVIDER=keycloak`.
- [x] Internal auth adapter added.
- [x] OIDC JWT signature, issuer, audience, expiry, and algorithm validation added.
- [x] `alg=none` rejected.
- [x] Centralized role/permission helper added.
- [x] Admin and seller middleware use centralized role checks.
- [x] Admin second-factor checks accept provider AMR claims.
- [x] Server session model preserved.
- [x] CSRF protections preserved for cookie-session writes.
- [x] Auth route rate limits preserved and enterprise OIDC limiter added.
- [x] Audit logging path preserved for login/session/admin/security events.
- [x] Diagnostics endpoint fixed to accept stale auth cookies for failure reporting.
- [x] HTML meta CSP aligned with hosted backend websocket origin.
- [x] Env validation and auth smoke scripts added to CI.
- [x] Keycloak local Docker Compose and realm import added without real secrets.
- [x] Docs for local dev, production setup, rollback, testing, and decision record added.

## Manual Production Items

- [ ] Create real Keycloak realm and confidential production client.
- [ ] Store production `AUTH_CLIENT_SECRET` and `AUTH_OIDC_STATE_SECRET` in the runtime secret manager.
- [ ] Configure Keycloak admin MFA/passkeys and recovery process.
- [ ] Configure access-token audience mapper for `AUTH_AUDIENCE`.
- [ ] Validate production redirect and post-logout URLs.
- [ ] Run live auth smoke in staging before production rollout.
