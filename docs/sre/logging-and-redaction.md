# Logging And Redaction

## Current Logger

`server/utils/logger.js` writes structured JSON and redacts sensitive metadata before output.

Request logs currently include:

- `method`
- `url`
- `status`
- `durationMs`
- `requestId`
- `clientSessionId`
- `clientRoute`
- `ip`

## Redacted Data

The logger redacts or masks:

- authorization headers
- bearer tokens
- cookies when passed under sensitive keys
- passwords
- OTP values
- reset tokens
- API keys
- private keys
- signatures
- card and CVV fields
- raw payload fields
- URL query strings
- selected user/account/tenant identifiers, by hashing

## Required Logging Pattern

New logs must:

- Include `requestId` when request-scoped.
- Include route/method/status/duration for request or dependency events.
- Use stable event names, for example `sre.dependency_timeout`.
- Log dependency duration as `durationMs` where safe.
- Avoid raw request bodies and raw provider payloads.
- Avoid full email verification links, reset URLs, OTPs, cookies, auth headers, Firebase tokens, SSM values, Redis URLs, Mongo URLs, and provider secrets.

## Security Event Pattern

Security, rate-limit, and fail-closed logs should include:

- event name
- requestId
- route class
- reason code
- safe actor/resource hashes when needed
- status code

They must not include:

- raw identity token
- raw session cookie
- raw MFA/OTP/recovery secret
- reset token
- raw webhook body unless already verified and explicitly scrubbed

## Verification

Relevant checks:

- `npm run security:logging`
- `npm run security:secrets`
- `npm run test:reliability`

For any new logger behavior, add a focused test that serializes the logged object and asserts sensitive strings are absent.
