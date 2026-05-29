# Auth Rollback

## Fast Rollback

Set:

```sh
AUTH_PROVIDER=legacy
```

Redeploy the backend. This restores Firebase bearer-token verification while preserving the existing browser session and CSRF architecture.

## What Not To Do

- Do not delete Keycloak users during rollback.
- Do not remove Firebase auth configuration.
- Do not drop `authUid` or user identity fields.
- Do not disable admin MFA or trusted-device checks to recover access.

## Session Handling

Existing browser sessions can continue if they were issued by the app and remain valid. If the rollback responds to suspected compromise, revoke browser sessions through the existing session revocation path.

## Migration Safety

Current rollout does not perform destructive user migration. Keycloak identities map to `authUid=keycloak:<subject>`, and the app never links accounts by email alone unless the provider identity is verified and the existing identity-resolution policy permits it.

## Roll Forward

After fixing the cause, restore:

```sh
AUTH_PROVIDER=keycloak
```

Then rerun auth env validation, live auth smoke, and the auth smoke suite.
