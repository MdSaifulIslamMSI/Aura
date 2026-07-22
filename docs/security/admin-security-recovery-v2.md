# Admin security recovery V2

This design removes the circular admin lockout without weakening the existing admin checkpoint. A recovery grant can authorize one passkey enrollment ceremony; it can never authorize an admin route. Admin access still requires a short-lived, server-side passkey or Duo assurance after a fresh sign-in.

## Security invariants

- All `/api/admin/*` business routes remain protected by `protect` and `admin` on the backend.
- The frontend renders state returned by `GET /api/admin/security/status`; it never writes or infers `adminVerified`.
- A general MFA boolean, TOTP AMR, owner email, or admin role alone cannot satisfy admin assurance.
- Recovery grant plaintext is displayed once by the offline command. MongoDB stores only keyed hashes of the grant, browser authority, operator identities, ticket, network, and user agent.
- Grant exchange requires an active, verified, allowlisted admin, a fresh primary sign-in, and a browser session. The resulting HttpOnly authority is bound to that user, `adminSecurityVersion`, and browser session.
- Recovery authority permits only passkey enrollment. It cannot call an admin business route and is not accepted by the `admin` middleware.
- Passkey verification requires observed WebAuthn user verification, the configured RP ID/origin, admin credential scope, and verified admin eligibility.
- Enrollment, MFA synchronization, grant consumption, the token revocation marker, and `adminSecurityVersion` advancement share one MongoDB transaction. Production already requires a writable replica set.
- Successful recovery revokes every browser session and Firebase refresh token, clears both cookies, and forces a new sign-in. The recovered session never becomes an admin session.
- Rate limits are Redis-backed, keyed with HMAC identities, and fail closed in production.
- Audit records are append-only. Update and delete model operations are rejected.

## State contract

The status endpoint returns one of:

- `NOT_AUTHENTICATED`
- `ACCOUNT_DISABLED`
- `EMAIL_VERIFICATION_REQUIRED`
- `NOT_AUTHORIZED_AS_ADMIN`
- `PRIMARY_REAUTH_REQUIRED`
- `ADMIN_RECOVERY_REQUIRED`
- `ADMIN_ENROLLMENT_REQUIRED`
- `ADMIN_CHALLENGE_REQUIRED`
- `ADMIN_VERIFIED`
- `ADMIN_PROVIDER_UNAVAILABLE`
- `ADMIN_SECURITY_CONFIGURATION_ERROR`

Only `ADMIN_VERIFIED` permits the UI to render admin content, and only the backend `admin` middleware permits the corresponding API request.

## Feature flags

All new entry points are off by default.

| Flag | Purpose |
|---|---|
| `ADMIN_SECURITY_STATE_ENGINE_V2` | Enables the authoritative V2 state engine. |
| `ADMIN_PASSKEY_ENROLLMENT` | Enables recovery-authorized passkey enrollment. |
| `ADMIN_PASSKEY_CHALLENGE` | Enables passkey admin challenge endpoints. |
| `ADMIN_DUO_PROVIDER` | Advertises configured Duo as an admin challenge option. |
| `ADMIN_RECOVERY_GRANTS` | Enables one-time recovery grant exchange. |
| `ADMIN_ASSURANCE_ENFORCEMENT` | Enforces the V2 state in the central admin middleware. It cannot be false in production while V2 is enabled. |
| `ADMIN_ACTION_BOUND_ASSURANCE` | Publishes the action-bound assurance policy to clients. |
| `ADMIN_LEGACY_FACTOR_READ` | Temporarily recognizes current legacy admin candidates; disable after migration evidence. |
| `ADMIN_RECOVERY_TWO_PERSON_REQUIRED` | Requires a distinct second operator for offline grant issuance. |
| `VITE_ADMIN_SECURITY_STATE_ENGINE_V2` | Enables the frontend checkpoint only after the backend is live. |

`ADMIN_SECURITY_HASH_SECRET` must be a new random value of at least 32 characters. Store it in Parameter Store. Do not reuse or print the auth vault secret.

## Migration

Audit first:

```powershell
npm --prefix server run migrate:admin-security-v2
```

After current backup and restore-test evidence is approved:

```powershell
npm --prefix server run migrate:admin-security-v2 -- --execute --approved-by=<operator> --ticket=<change-ticket>
```

The migration is additive: it initializes missing `adminSecurityVersion` values to `0` and creates indexes for grants and audit events. Rollback leaves these fields and collections in place because older code ignores them.

## Offline grant issuance

Run this only from an approved production operator shell after confirming the subject's immutable user ID or auth UID. The command prints a redacted summary and asks for `ISSUE`; non-interactive use also requires `--confirm ISSUE`.

```powershell
npm run admin:recovery:create -- --user-id <mongo-user-id> --method passkey --expires-in 10m --reason lost_admin_factor --ticket <change-ticket> --operator <operator-id>
```

When two-person recovery is enabled, add `--second-operator <distinct-operator-id>`. Transfer the one-time plaintext through the approved out-of-band channel. Never paste it into tickets, logs, chat, shell history, or CI output.

The administrator signs in normally, opens the admin destination, pastes the grant into the checkpoint, enrolls the passkey, and is signed out. A fresh sign-in and passkey challenge are then required before the console opens.

## Verification ladder

1. Run focused backend tests for configuration, states, grants, admin route coverage, and passkey enrollment policy.
2. Run frontend checkpoint tests and the production frontend build.
3. Run `npm --prefix server run migrate:admin-security-v2` in audit mode against staging.
4. Apply the additive staging migration, then verify grant expiry, replay, cross-user, cross-session, cancellation, and concurrent-consumption behavior.
5. Verify Redis outage causes `503`, not memory fallback, on recovery endpoints.
6. Verify a recovery authority receives `403` on an ordinary admin route.
7. Verify successful recovery revokes the old browser session and refresh token and requires a fresh sign-in.
8. Verify Duo redirect and callback behavior separately if Duo is enabled.
9. Run the normal branch-protection, security, smoke, cost, observability, rollback, reliability, and latency gates.

## Production go/no-go

Production activation is a hard **NO-GO** until every item is evidenced:

- Zero open high or critical findings for the changed auth surface.
- Current database backup plus a successful restore test.
- Redis is healthy and `AUTH_SESSION_ALLOW_MEMORY_FALLBACK=false`.
- Additive migration audit and apply evidence are retained.
- At least two independent owner/admin accounts have working approved factors.
- A backup admin method is tested without using recovery authority as admin access.
- Security, SRE, and product owner signoffs are recorded.
- Required branch-protection checks pass on the immutable release commit.
- Backend rollback SHA and frontend rollback deployment are captured.
- Staging and canary evidence show no unexplained recovery, challenge, or provider failures.

## Rollout and rollback

1. Deploy the code with every new backend flag and the frontend flag off.
2. Run the migration audit and apply in staging.
3. Enable the backend flags in staging, validate the full recovery and fresh-sign-in path, then enable the staging UI flag.
4. Repeat the production migration audit. Apply only after the go/no-go list passes.
5. Enable the production backend flags as one reviewed Parameter Store change and redeploy. The deploy performs an image-level admin security contract check before activation.
6. Enable the Vercel UI flag only after the backend status and challenge endpoints are healthy.

Rollback order:

1. Disable `VITE_ADMIN_SECURITY_STATE_ENGINE_V2` and restore the previous frontend deployment.
2. Disable the new recovery/state flags together and redeploy the captured backend rollback SHA.
3. Keep the existing `ADMIN_REQUIRE_2FA`, `ADMIN_REQUIRE_PASSKEY`, allowlist, trusted-device, and Duo protections enabled.
4. Revoke active recovery grants and inspect immutable audit events. Do not delete additive schema fields or collections during incident rollback.

## Monitoring

The existing `aura_auth_security_events_total` counter receives bounded events for recovery exchange, enrollment, and passkey verification. Alert on:

- any sustained rise in `admin.recovery.exchange` failures or rate limits;
- any recovery enrollment with `session_cleanup_pending`;
- any `ADMIN_PROVIDER_UNAVAILABLE` or configuration error;
- repeated grant replay, cross-session, or cross-user rejection;
- Redis unavailability for a security-critical limiter;
- passkey challenge failure rate or p95 route latency above the auth budget.

Use request IDs and immutable audit `grantId` values for correlation. Never add grant plaintext, authority cookies, WebAuthn credential material, raw IPs, or raw user agents to dashboards or alerts.
