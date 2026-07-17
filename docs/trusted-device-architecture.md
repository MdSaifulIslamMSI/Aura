# Trusted Device Architecture

## What was wrong with the old LWE path

The old `latticeChallenge` flow was not a defensible authentication control.

The concrete failures were:

- The server sent `simulatedSk` to the browser, which means the client received the exact secret it was supposed to prove possession of.
- The frontend challenge component was not mounted into the application shell, so the backend could return a required challenge without a real enforcement surface.
- The legacy proof was not converted into a session-bound server token required by privileged requests, so there was no durable authorization boundary after the proof step.
- The naming implied post-quantum or FIDO-grade guarantees that the implementation did not actually provide.

## Replacement design

The repo now uses a real trusted-device checkpoint for privileged access.

### Browser side

- Each browser gets a stable device identifier via `localStorage`.
- The trusted-device flow now prefers WebAuthn or platform passkeys when the browser exposes them.
- Passkey-capable browsers complete a real WebAuthn challenge locally and send the resulting credential payload to the server.
- Browsers that cannot use WebAuthn can still fall back to a non-extractable `RSA-PSS` private key stored in IndexedDB when the server allows the fallback path.
- On first use for a device, the browser either registers a WebAuthn credential or sends an exported browser-key public key so the server can bind the device.

### Server side

- `server/services/trustedDeviceChallengeService.js` issues sealed challenge tokens bound to:
  - user id
  - device id
  - current Firebase session binding (`authUid` + token `iat`)
- WebAuthn challenges also carry relying-party context (`origin`, `rpId`, user-verification policy, timeout) so the browser and server verify the same passkey ceremony.
- Trusted-device tokens now use their own rotation-aware secret contract:
  - primary secret: `AUTH_DEVICE_CHALLENGE_SECRET`
  - primary version: `AUTH_DEVICE_CHALLENGE_SECRET_VERSION`
  - previous secrets: `AUTH_DEVICE_CHALLENGE_PREVIOUS_SECRETS`
- Verification requires either a valid WebAuthn assertion or a valid browser-key signature over the challenge payload.
- Successful verification returns a sealed trusted-device session token, also bound to the current Firebase session and device id.
- Privileged middleware requires that trusted-device session token on protected privileged requests.

## Enforcement model

- Session establishment routes (`/api/auth/session`, `/api/auth/sync`) can return `device_challenge_required`.
- When trusted-device and MFA policy both apply, the server enforces a strict sequence: trusted-device proof first, then `mfa_challenge_required`, then `authenticated`. Device verification cannot finalize the login early.
- A risk-driven MFA requirement is sealed into the device challenge and restored after verification, so it cannot disappear between requests.
- The frontend mounts a real checkpoint overlay through `AuraTrustedDeviceChallenge`.
- Seller and admin access paths enforce the trusted-device session token on the server.
- Admin treatment is consistent for both the legacy `isAdmin` flag and non-empty `adminRoles`; role-only admins do not fall through to public policy.
- Admin access can require passkey-backed assurance with `ADMIN_REQUIRE_PASSKEY`.
  In production this defaults on, and the AWS runtime contract pins it to `true`.
  Browser-key trusted devices remain usable for lower-risk trusted-device checks,
  but they are not enough for passkey-required admin access.
- `AUTH_DEVICE_CHALLENGE_MODE` is the primary environment flag.
- `AUTH_LATTICE_CHALLENGE_MODE` is still read as a legacy alias so existing deployments do not silently break.
- When trusted-device challenge mode is enabled, startup now fails closed unless the deployment provides a dedicated device secret or explicitly opts into vault-secret fallback.

## Capability boundaries

This is now a passkey-first trusted-device proof with a browser-key fallback, not a full hardware-attestation platform.

- It is materially stronger than the removed fake LWE flow because the private signing material never leaves the authenticator or browser.
- The WebAuthn branch is genuinely passkey-backed, but the fallback branch is still browser-resident and should be described honestly.
- If hardware-bound attestation policy is needed later, the next step is stronger WebAuthn attestation and device-management policy, not synthetic cryptography claims.

## Public and admin semantics

The product now separates device recognition from authentication assurance:

| Proof | Public account | Admin account |
| --- | --- | --- |
| Browser key | Remember this browser; AAL1 recognition only | Never satisfies admin MFA or passkey policy |
| WebAuthn with user presence only | Phishing-resistant credential recognition, but not MFA | Rejected for admin MFA and admin enrollment |
| WebAuthn with an observed UV flag | May satisfy passkey MFA when registered with MFA scope | Satisfies admin policy only when admin-scoped and freshly verified |
| Legacy admin passkey snapshot | Recognition-only migration candidate | Must complete a fresh UV assertion before promotion |

The requested WebAuthn `userVerification` preference is not treated as proof by itself. New records persist the authenticator's observed UV bit and time. Historical records that successfully used a `required` ceremony remain compatible, while V2 backfills are deliberately unverified until a fresh assertion.

The security center exposes remembered browsers and passkeys separately, identifies the current browser, shows backup/sync state when observed, and supports rename, individual revoke, and revoke-all-others. Revoking the current browser signs it out. Password reset revokes all active trusted devices, passkeys, and browser sessions.

## V2 storage and rollout boundary

`TrustedDeviceCredential` is the normalized V2 credential store. Migration is source-bound, resumable, auditable, and secretless in its evidence. Apply mode requires a completed error-free audit, an approval hash, an explicit operator, and two mutation gates. It performs a full source fingerprint preflight before any credential write and checks the fingerprint again after apply.

V2 is intentionally non-authoritative in this release:

- `legacy` is the only serving read mode.
- `dual_write` is cohort-scoped and mirrors fresh verified credentials plus lifecycle changes.
- `shadow_compare` observes drift but never changes an allow/deny decision.
- V2-first modes are reserved and make startup fail until an atomic cutover path is released.

This prevents a partial cross-collection write from turning a stale V2 credential into an authorization source. See [the V2 rollout runbook](runbooks/trusted-device-v2-rollout.md).

The policy follows the current WebAuthn backup-state and UV verification rules, and the distinction in NIST SP 800-63B between syncable authenticators, phishing resistance, and non-exportable AAL3 credentials:

- https://www.w3.org/TR/webauthn-3/
- https://pages.nist.gov/800-63-4/sp800-63b.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
