# Production Auth Setup

## Required Runtime Variables

For legacy rollback mode:

```sh
AUTH_PROVIDER=legacy
```

For Keycloak:

```sh
AUTH_PROVIDER=keycloak
AUTH_ISSUER_URL=https://<keycloak-host>/realms/<realm>
AUTH_CLIENT_ID=<client-id>
AUTH_CLIENT_TYPE=confidential
AUTH_CLIENT_SECRET=<runtime-secret>
AUTH_OIDC_STATE_SECRET=<runtime-secret>
AUTH_AUDIENCE=<expected-access-token-audience>
AUTH_JWKS_URL=https://<keycloak-host>/realms/<realm>/protocol/openid-connect/certs
AUTH_REDIRECT_URI=https://<backend-origin>/api/auth/enterprise/callback
AUTH_POST_LOGOUT_REDIRECT_URI=https://<frontend-origin>/login
AUTH_COOKIE_NAME=aura_sid
AUTH_REQUIRE_MFA_FOR_ADMIN=true
AUTH_ALLOWED_CLOCK_SKEW_SECONDS=60
AUTH_RATE_LIMIT_LOGIN=10
AUTH_RATE_LIMIT_PASSWORD_RESET=5
```

Do not commit real values. Use the existing runtime secret path or parameter store integration.

## Keycloak Client

- Client type: confidential for production.
- Flow: standard authorization code with PKCE S256.
- Redirect URI: exact backend callback URL.
- Web origins: frontend origin only.
- Access token audience: include `AUTH_AUDIENCE`.
- Roles/groups: map Keycloak roles to access-token claims.
- MFA/passkeys: require MFA for admin users and prefer WebAuthn/passkeys where possible.

## Startup Behavior

- Production fails closed when `AUTH_PROVIDER=keycloak` is incomplete.
- `AUTH_PROVIDER=legacy` remains available as rollback.
- Tokens are validated with issuer, audience, expiry, signature, JWKS, and algorithm checks.

## Secret Rotation

1. Add the new client/state secret in the secret manager.
2. Update Keycloak client secret if rotating `AUTH_CLIENT_SECRET`.
3. Deploy with the new runtime value.
4. Watch auth smoke tests, login success rate, token-validation failures, and admin access events.
5. Revoke old sessions if the rotation responds to a suspected compromise.

## Production Readiness

Run before promotion:

```sh
npm run auth:env:validate -- --environment production --strict --env-file <production-contract-file>
npm run auth:smoke -- --environment production --env-file <production-contract-file> --live
npm run test:auth:smoke
npm run security:auth
npm run security:secrets
```
