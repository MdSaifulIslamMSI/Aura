# TOTP Authenticator MFA

Last updated: 2026-06-04

Aura TOTP MFA implements RFC 6238 six-digit codes with SHA-256 and a 30-second period.

## Enrollment

1. Client calls `/api/auth/mfa/totp/setup`.
2. Server generates a random base32 secret.
3. Server stores only the encrypted pending secret.
4. Client displays the QR code and manual key.
5. User submits a current authenticator code.
6. Server verifies the code, promotes the pending secret to active, clears pending setup, and returns recovery codes when needed.

## Storage

- Encryption: AES-256-GCM.
- Key: `MFA_SECRET_ENCRYPTION_KEY`.
- Hidden fields: `mfa.totp.secretEncrypted` and `mfa.totp.pendingSecretEncrypted` are `select: false`.
- Recovery codes are HMAC digests only.

## Configuration

```sh
MFA_ENABLED=true
MFA_TOTP_ENABLED=true
MFA_RECOVERY_CODES_ENABLED=true
MFA_SECRET_ENCRYPTION_KEY=<32-plus-character-or-32-byte-secret>
```

## Rotation

Starting setup again creates a new pending TOTP secret. The active secret changes only after the user verifies a valid code for the pending secret.
