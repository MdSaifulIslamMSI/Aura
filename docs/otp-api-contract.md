# OTP API Contract (Enumeration-Safe Behavior)

## Public OTP endpoints

### `POST /api/otp/send`

For unauthenticated contexts (`login`, `forgot-password`), this endpoint must not reveal whether an account exists or whether email/phone match a registered profile.

- **Success response (uniform):**

```json
{
  "success": true,
  "message": "If the account details are valid, we will continue with verification steps."
}
```

- Internal mismatch and non-existent-account details are still recorded through audit logs.

### `POST /api/otp/verify`

For unauthenticated login and forgot-password contexts, verification failures must not reveal whether a phone number, email address, OTP session, or account exists.

- **Failure response (uniform for login and forgot-password verification failures):**

```json
{
  "success": false,
  "message": "If account details are valid, verification will proceed."
}
```

### `POST /api/otp/check-user`

This endpoint is non-enumerating. It does not expose account existence or profile hints.

- **Success response (uniform):**

```json
{
  "success": true,
  "message": "If an account exists, verification instructions have been sent."
}
```

- The response must not include fields like `exists`, `reason`, `registeredPhoneSuffix`, or raw `phone`.
- Internal matching outcomes are preserved in audit logs for observability.
