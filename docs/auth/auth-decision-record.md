# Auth Decision Record

## Decision

Use Keycloak as the primary enterprise identity provider while preserving the existing Firebase auth path behind `AUTH_PROVIDER=legacy`.

## Why Keycloak

The repository already has mature app-level auth: Firebase login, server cookies, CSRF, OTP, recovery codes, Duo step-up, WebAuthn/trusted-device checks, audit events, and rate limiting. The missing layer is a mature enterprise IdP for SSO, OIDC/SAML, roles/groups, and provider-managed MFA/passkeys. Keycloak fits that gap without replacing the app session model.

Keycloak was chosen because it is open source, self-hostable, OIDC/SAML capable, widely deployed, supports roles/groups, has a broad admin ecosystem, and can be integrated behind a feature flag without deleting legacy auth.

## Options Evaluated

| Option | Fit | Decision |
| --- | --- | --- |
| Keycloak | Mature enterprise SSO, OIDC, SAML, roles, groups, MFA, WebAuthn/passkeys | Chosen |
| authentik | Good self-hosted SSO and reverse-proxy protection | Good alternative, less aligned with app-level OIDC adapter rollout |
| ZITADEL | Strong SaaS/org/passkey posture | Good future B2B option, but less conservative than Keycloak for default enterprise IAM |
| Ory stack | Maximum control with separate identity, OAuth2, proxy, authorization services | Powerful but operationally heavier for this repo's current auth maturity |
| SuperTokens | Fast app auth/session integration | Duplicates existing Firebase/session investment |
| Logto | Modern SaaS/developer IAM | Good alternative, Keycloak has broader enterprise ecosystem |
| Hanko | Passkey-first | Too narrow as the only enterprise IdP |
| Authelia | Reverse-proxy SSO/MFA | Better for internal surfaces than app-level user identity |
| Casdoor | UI-first IAM with Casbin style | Less common default than Keycloak for this repo's target |
| Kanidm | Strong secure identity source/WebAuthn | Promising, but Keycloak has broader OIDC/SAML ecosystem |

## Implemented Path

- `AUTH_PROVIDER=legacy` keeps current Firebase behavior.
- `AUTH_PROVIDER=keycloak` switches bearer token validation to Keycloak OIDC/JWKS.
- `/api/auth/enterprise/start` and `/api/auth/enterprise/callback` add a backend Keycloak authorization-code + PKCE flow.
- The callback creates the same server-side browser session used by legacy auth.
- Role/permission checks are centralized in `authorizationService`.
- CI runs env validation and auth smoke checks.

## Rollback

Set `AUTH_PROVIDER=legacy` and redeploy. Do not delete Keycloak or Firebase users during rollout. Existing sessions can be revoked if required, but destructive migrations are not part of this change.

## References

- Keycloak docs: https://www.keycloak.org/documentation
- authentik docs: https://docs.goauthentik.io/
- ZITADEL docs: https://zitadel.com/docs
- Ory docs: https://www.ory.sh/docs/
- SuperTokens docs: https://supertokens.com/docs
- Logto docs: https://docs.logto.io/
- Hanko docs: https://docs.hanko.io/
- Authelia docs: https://www.authelia.com/
- Casdoor docs: https://casdoor.org/docs/
- Kanidm docs: https://kanidm.github.io/kanidm/
