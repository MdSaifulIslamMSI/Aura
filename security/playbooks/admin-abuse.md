# Admin Abuse Playbook

## Trigger

- Break-glass account used.
- Admin role changed.
- Admin exports data.
- Dangerous action without expected ticket/change record.

## Immediate Actions

1. Revoke or suspend the admin session.
2. Preserve admin audit logs and request IDs.
3. Identify target resources and affected users.
4. Confirm MFA/passkey/fresh-login evidence.
5. Require second reviewer for continued privileged operations.
6. Disable break-glass credentials unless actively approved.

## Evidence

- Admin user ID.
- Action, target type, target ID.
- IP and user agent.
- Request ID.
- Approval or ticket reference.
- Before/after resource state.

## Recovery

- Restore unauthorized changes where possible.
- Rotate credentials if admin account was compromised.
- Add or tighten policy/detection.
