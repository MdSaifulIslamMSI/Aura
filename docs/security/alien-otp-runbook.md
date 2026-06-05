# ALIEN OTP Runbook

## Enable Locally

1. Enroll a trusted-device passkey through the existing MFA passkey flow.
2. Set:

```env
ALIEN_OTP_ENABLED=true
ALIEN_OTP_SENSITIVE_ACTIONS_ENABLED=true
ALIEN_OTP_RISK_ENGINE_ENABLED=true
ALIEN_OTP_AUDIT_ENABLED=true
ALIEN_OTP_STRICT_MODE=false
VITE_ALIEN_OTP_ENABLED=true
```

3. Use `app/src/security/alienOtpClient.js` for protected request helpers.

## Investigate A Denial

1. Search for `alien_otp.event` by request ID.
2. Review event, action, route, decision, risk level, and reasons.
3. Confirm no raw nonce, credential assertion, token, or signature is present in logs.
4. Check whether the decision came from missing proof, invalid challenge shape, WebAuthn verification, device binding, replay, or risk block.

## Common Reasons

| Reason | Meaning | Response |
| --- | --- | --- |
| `alien_proof_missing` | Request did not include challenge/proof | Retry with client helper or use existing MFA fallback |
| `challenge_expired` | TTL elapsed | Request a fresh challenge |
| `challenge_replayed` | Challenge already consumed | Treat as suspicious if repeated |
| `wrong_user` | Challenge subject does not match session | Re-authenticate |
| `wrong_tenant` | Challenge tenant does not match request | Investigate tenant resolver |
| `wrong_resource` | Challenge resource does not match request | Request new action-bound challenge |
| `unknown_passkey_credential` | Credential is not enrolled for the user | Re-enroll passkey or use fallback |
| `device_session_missing` | Device-bound mode lacks trusted-device session | Re-run trusted-device verification |

## Incident Response

1. Disable strict mode if valid users are blocked:

```env
ALIEN_OTP_STRICT_MODE=false
```

2. Disable all ALIEN OTP enforcement if needed:

```env
ALIEN_OTP_ENABLED=false
VITE_ALIEN_OTP_ENABLED=false
```

3. Revoke suspicious user challenges with `revokeUserChallenges(userId)` from `server/services/alienOtpChallengeService.js`.
4. Revoke suspicious trusted devices through the existing MFA/passkey removal flow.
5. Rotate backend/session secrets only if logs or investigation indicate secret compromise.

## Verification Commands

```sh
npm --prefix server test -- --runTestsByPath tests/alienOtpChallengeService.test.js tests/alienOtpWebAuthnService.test.js tests/alienOtpRequired.test.js tests/alienOtpRiskEngine.test.js tests/alienDeviceBindingService.test.js tests/alienOtpAudit.test.js tests/alienOtpEnvContract.test.js --forceExit
npm run security:auth
npm run security:free-stack
git diff --check
```
