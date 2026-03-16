# OTP API Contract (Enumeration-Safe Behavior)

## Public OTP endpoints

### `POST /api/otp/send`

For unauthenticated contexts (`login`, `forgot-password`), this endpoint must not reveal whether an account exists or whether email/phone match a registered profile.

- **Success response (uniform):**

```json
{
  "success": true,
  "message": "If the account details are valid, an OTP has been sent."
}
```

- Internal mismatch and non-existent-account details are still recorded through audit logs.

### `POST /api/otp/check-user`

This endpoint is non-enumerating. It does not expose account existence or profile hints.

- **Success response (uniform):**

```json
{
  "success": true,
  "message": "If the account details are valid, you can continue with verification."
}
```

- The response must not include fields like `exists`, `reason`, `registeredPhoneSuffix`, or raw `phone`.
- Internal matching outcomes are preserved in audit logs for observability.
