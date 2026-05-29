# Authentication Architecture

Aura keeps the current Firebase-backed consumer login as the rollback-safe default and adds Keycloak as the enterprise OIDC provider path.

## Current Strategy

- Default provider: `AUTH_PROVIDER=legacy`
- Enterprise provider: `AUTH_PROVIDER=keycloak`
- Browser session: server-issued `aura_sid` cookie with CSRF protection and session revocation
- Token validation: Firebase Admin for legacy bearer tokens, JWKS-backed OIDC validation for Keycloak access tokens
- Authorization: centralized role and permission helpers in `server/services/auth/authorizationService.js`
- Audit and metrics: existing `recordAuthSecurityEvent` path for login, session, admin, trusted-device, and recovery events

## Local Commands

```sh
npm run auth:env:validate
npm run auth:smoke
npm run test:auth:smoke
npm run security:auth
```

## Rollout States

1. `AUTH_PROVIDER=legacy`: existing Firebase behavior.
2. `AUTH_PROVIDER=keycloak` in local or staging with Keycloak realm imported.
3. Enable enterprise login for selected users/admins.
4. Require Keycloak MFA/passkeys for admin users in the provider.
5. Move traffic gradually; keep legacy Firebase rollback path until staging and production checks are green.

## Related Docs

- [Inventory](./auth-inventory.md)
- [Threat model](./auth-threat-model.md)
- [Decision record](./auth-decision-record.md)
- [Local development](./local-dev.md)
- [Production setup](./production-setup.md)
- [Rollback](./rollback.md)
- [Testing](./testing.md)
- [Security checklist](./security-checklist.md)
