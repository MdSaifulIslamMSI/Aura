# Auth Testing

## Focused Tests

```sh
npm --prefix server test -- --runTestsByPath tests/authEnvironment.test.js tests/authorizationService.test.js tests/oidcTokenVerifier.test.js tests/keycloakOidcService.test.js tests/authProviderAdapter.test.js tests/observabilityRoutes.test.js --forceExit
npm --prefix app test -- --run src/services/api/authApi.test.js src/config/cspPolicy.test.js
```

## Smoke And Security

```sh
npm run auth:env:validate
npm run auth:smoke
npm run test:auth:smoke
npm run security:auth
npm run security:secrets
```

## Coverage Added

- Env validation keeps legacy rollback safe and fails closed for incomplete Keycloak production config.
- OIDC tokens reject `alg=none`, expired tokens, wrong issuer, and wrong audience.
- Keycloak authorization-code + PKCE state is signed, HttpOnly, one-time-use, and replay resistant.
- Adapter exposes the internal auth interface while hiding provider-specific token verification.
- Central RBAC denies by default and supports role-derived permissions.
- Frontend enterprise login URL generation sanitizes return paths and login hints.
- HTML CSP allows the hosted CloudFront HTTPS/WSS backend so Socket.IO is not blocked by meta CSP.
- Observability diagnostics ingest works even with stale auth cookies.

## Live Checks

Live IdP smoke is intentionally opt-in:

```sh
npm run auth:smoke -- --env-file <your-untracked-auth-env> --live
```

Do not point live smoke at production without an approved production validation window.
