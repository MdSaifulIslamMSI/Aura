# Passkey Authentication

Last updated: 2026-06-04

Aura passkey MFA uses the existing trusted-device WebAuthn challenge service.

## Enrollment

1. Client calls `/api/auth/mfa/passkey/register/options`.
2. Server issues a trusted-device enrollment challenge with scope `mfa-passkey-register`.
3. Client signs the challenge with `signTrustedDeviceChallenge()` and WebAuthn platform APIs.
4. Client posts proof to `/api/auth/mfa/passkey/register/verify`.
5. Server verifies the challenge, records public passkey metadata, marks MFA enabled, and refreshes the session.

## Login

1. Login policy returns an MFA challenge with `passkey` allowed.
2. Client calls `/api/auth/mfa/passkey/login/options`.
3. Client signs the assertion.
4. Client posts proof plus `challengeId` to `/api/auth/mfa/passkey/login/verify`.
5. Server consumes both the trusted-device challenge and the MFA challenge.

## Configuration

Use existing WebAuthn flags:

- `AUTH_WEBAUTHN_RP_NAME`
- `AUTH_WEBAUTHN_RP_ID`
- `AUTH_WEBAUTHN_ORIGIN`
- `AUTH_WEBAUTHN_USER_VERIFICATION`
- `AUTH_TRUSTED_DEVICE_PREFER_WEBAUTHN`

Enable MFA passkeys with:

```sh
MFA_ENABLED=true
MFA_PASSKEY_ENABLED=true
```
