# ALIEN OTP Threat Model

## Assets

- User sessions and Firebase identities.
- Passkey/WebAuthn public credential metadata.
- Trusted-device session tokens.
- Sensitive admin, payment, tenant, auth-factor, API-key, and webhook actions.
- Tenant and resource authorization decisions.
- Audit trails and request IDs.

## Primary Threats

| Threat | ALIEN OTP Control | Residual Risk |
| --- | --- | --- |
| Phished password or session cookie | Requires fresh passkey assertion for protected actions in strict mode | Fully compromised device can still sign |
| Replay of a captured proof | Short TTL challenge and one-time consume | Redis outage must fail closed in production strict mode |
| Cross-tenant action abuse | Challenge binds tenant/resource/action and existing authz still runs | Resolver bugs can still misclassify resources |
| Stolen bearer token | Optional device-bound trusted-device session proof | Device binding must be enabled and enrolled |
| Passkey credential cloned/replayed | Existing WebAuthn verifier checks credential ID, origin, RP ID, signature, and counter | Some authenticators have zero counters |
| Risky admin/payment action | ALIEN risk engine escalates action risk and can block critical cases in strict mode | Risk scoring is heuristic |
| Log leakage | Audit hashes identifiers and never logs nonce/assertion/signature | Logger transport compromise can expose metadata |

## Trust Boundaries

- Browser to API: protected by TLS, CORS, CSRF controls, WebAuthn origin/RP checks, and device headers.
- API to Redis: challenge storage and consume must be available for production strict mode.
- API to database: user passkey metadata and trusted-device records are read but private keys are never stored.
- Existing authz layer: RBAC/ABAC/tenant checks remain the source of authorization truth.

## Security Requirements

- Reject expired challenges.
- Reject reused challenges.
- Reject wrong user, tenant, action, resource, session, or device when binding is enabled.
- Verify passkey assertions before consuming.
- Consume only after full proof verification succeeds.
- Default off for production.
- Strict blocking only when explicitly enabled.
