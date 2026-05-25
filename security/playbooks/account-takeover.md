# Account Takeover Playbook

## Trigger

- Failed login spike.
- MFA or trusted-device failure spike.
- User report of unauthorized access.
- Impossible-travel or high-risk auth signal.

## Immediate Actions

1. Revoke active sessions for affected user IDs.
2. Rotate refresh/session tokens.
3. Lock the account if confidence is high.
4. Notify the user and security owner.
5. Review auth, admin, payment, and data access logs.
6. Reset password/MFA/passkey factors when needed.

## Evidence

- Request IDs.
- User ID and tenant ID.
- IP addresses and user agents.
- Login timestamps.
- MFA/trusted-device result.
- Accessed resources after suspicious login.

## Recovery

- Unlock only after identity verification.
- Add a detection or regression test for the observed bypass.
- Close with timeline, impact, and follow-up owner.
