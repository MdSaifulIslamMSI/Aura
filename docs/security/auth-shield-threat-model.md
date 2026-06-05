# Auth Shield Threat Model

## Assets

- User accounts and sessions.
- Admin privileges and security configuration.
- Payment/refund/payout operations.
- MFA/passkey/trusted-device state.
- Orders, listings, reviews, uploads, and tenant/resource boundaries.
- Security audit evidence.

## Threats Addressed

- Logged-in user attempts non-owned resource mutation.
- Seller attempts to mutate another seller listing.
- Support or normal user attempts payment refund.
- Admin action from stale session.
- Critical mutation replay via nonce or DPoP `jti`.
- Tenant mismatch.
- Disabled/deleted/suspended account using old session context.
- Sensitive action audit event leaking secrets.

## Controls

- Server-side identity extraction from existing auth context.
- Relationship checks before allow.
- Replay guard with Redis/in-memory fallback.
- DPoP-like proof verifier behind flag.
- Step-up freshness checks behind flag.
- Risk scoring for missing request/session/device signals.
- Redacted audit writer.
- Safe public error messages.

## Residual Risk

- Full client DPoP signing is not enabled by default.
- Local relationship rules are not a replacement for a formal graph authorization system.
- Tenant coverage depends on resources exposing trusted tenant IDs.
- Shadow mode needs audit review before fail-closed production expansion.
- Enabling fail-closed replay protection requires clients to send fresh nonces on critical mutations.

## Future Work

- Add OpenFGA/Zanzibar relationship backend.
- Add OPA policy adapter.
- Roll out DPoP for selected trusted clients.
- Add dashboards for deny reasons and shadow-deny rates.
- Expand resource resolvers for every admin/payment/upload/moderation route.
