# Local Auth Development

## Validate The Contract

```sh
npm run auth:env:validate
npm run auth:smoke
```

The default example remains on `AUTH_PROVIDER=legacy`, so it validates without starting Keycloak.

## Run Local Keycloak

1. Create an untracked local env file from `config/auth.example.env`.
2. Set `AUTH_PROVIDER=keycloak`.
3. Replace `KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_DB_PASSWORD`, and `AUTH_OIDC_STATE_SECRET` with local-only values.
4. Keep `AUTH_CLIENT_TYPE=public` for local PKCE testing unless you create a confidential client.
5. Start Keycloak:

```sh
docker compose -f infra/auth/docker-compose.yml --env-file <your-untracked-auth-env> up -d
```

6. Validate:

```sh
npm run auth:env:validate -- --env-file <your-untracked-auth-env>
npm run auth:smoke -- --env-file <your-untracked-auth-env> --live
```

## Local Realm

The local realm import is `infra/auth/keycloak/realm-aura-dev.json`.

- Realm: `aura-dev`
- Client: `aura-web`
- PKCE: S256
- Email verification: enabled
- Brute force protection: enabled
- Roles: `user`, `seller`, `support`, `admin`
- WebAuthn and TOTP required actions: available but not forced by default

No default user password is committed.
