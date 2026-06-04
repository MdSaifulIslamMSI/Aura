# Aura MFA Staging Rollout Verification

Last updated: 2026-06-04

This checklist prepares Aura MFA rollout without enabling production-wide MFA. Keep production default-off until staging and admin step-up proof are complete.

## Preflight

1. Fetch the latest default branch and confirm the Aura Way MFA foundation is present before rollout work is merged:

```sh
git fetch origin
git merge-base --is-ancestor 714f5965 origin/main
```

The command exits `0` when the foundation commit is in `origin/main`. If it exits non-zero, open or merge the MFA foundation branch before treating rollout as a production-ready follow-up.

2. Confirm production examples and defaults still keep MFA off:

```sh
rg -n "MFA_ENABLED=false" config/environments/production.example.env config/auth.example.env
```

3. Do not write real MFA secrets to committed files. Use the staging secret manager, host dashboard, or parameter store only.

## Required Staging Secret

Set this in staging only before enabling TOTP:

```sh
MFA_SECRET_ENCRYPTION_KEY=<strong-32-byte-or-longer-random-key>
```

Generate one with either command:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```sh
openssl rand -base64 32
```

Keep the key stable for the staging environment. Rotating it without a migration makes existing encrypted TOTP secrets unreadable.

## Staging Flags

After the staging secret exists, enable only staging with:

```sh
MFA_ENABLED=true
MFA_TOTP_ENABLED=true
MFA_PASSKEY_ENABLED=true
MFA_RECOVERY_CODES_ENABLED=true
MFA_REQUIRED_FOR_ADMINS=false
MFA_REQUIRED_FOR_SELLERS=false
MFA_EMAIL_OTP_FALLBACK_ENABLED=false
```

Production remains:

```sh
MFA_ENABLED=false
```

## Manual Test Matrix

| Flow | Steps | Expected proof |
| --- | --- | --- |
| Normal user login | Sign in with a non-admin staging account while MFA is optional | Session is created normally when the account has no enrolled factor |
| Authenticator setup with QR | Open Security Center, start authenticator setup, scan QR with Microsoft Authenticator, enter the six-digit code | TOTP becomes enabled and recovery codes are issued |
| Authenticator setup with manual key | Start setup again for a fresh test account, copy manual setup key into Microsoft Authenticator, enter the six-digit code | Manual setup succeeds without QR dependency |
| Recovery-code storage | Save the issued recovery codes outside the browser | Codes are visible once and active count matches the issued set |
| MFA login | Logout, login with primary credentials, complete TOTP challenge | No final session exists until the six-digit proof succeeds |
| Recovery-code login | Logout, login with primary credentials, choose recovery code, enter one saved code | Login succeeds and active recovery-code count decreases |
| Recovery-code replay | Repeat login with the same recovery code and a fresh challenge | Reused code is rejected as invalid or already used |
| Passkey enrollment | Register a staging passkey from Security Center | Passkey appears in MFA status and can be used for login/step-up |
| Admin step-up | Enable admin requirement in staging, login as admin, try payout/payment/admin destructive action | Server returns a fresh MFA step-up challenge before mutation |

## Critical Session Proof

Verify this sequence with browser devtools or an API client:

```text
Primary login success
-> MFA challenge returned
-> no final aura_sid/session cookie yet
-> MFA proof succeeds
-> final aura_sid/session cookie is created
```

This is the core rollout proof. A challenge response must not create a browser session until a valid one-time MFA proof is consumed.

## Admin Step-Up Proof

Enable this in staging only after basic user flows pass:

```sh
MFA_REQUIRED_FOR_ADMINS=true
```

Then verify these actions require fresh MFA:

| Action | Expected response before fresh proof |
| --- | --- |
| Admin destructive user action | Fresh MFA challenge |
| Payment, refund, or payout change | Fresh MFA challenge |
| Password or email change | Fresh MFA challenge |
| Disable MFA | Fresh MFA challenge |
| Recovery-code regeneration | Fresh MFA challenge |
| Backup or restore action | Fresh MFA challenge |

After successful proof, retry the original action and confirm it succeeds only within `MFA_FRESH_WINDOW_SECONDS`.

## Admin Lockout Recovery

Use this order. Do not delete user MFA metadata as the first move.

1. Confirm at least one emergency admin or break-glass path still has access.
2. If all staging admins are blocked, disable enforcement temporarily:

```sh
MFA_ENABLED=false
```

3. Restart or redeploy the staging API so the flag is loaded.
4. Login, repair factors, regenerate recovery codes, and confirm at least two admins can pass MFA.
5. Re-enable staging MFA and retest admin step-up.
6. Preserve audit logs and consumed recovery-code records for incident review.

## Rollback

Rollback is a flag-only operation:

```sh
MFA_ENABLED=false
```

For factor-specific incidents:

```sh
MFA_TOTP_ENABLED=false
MFA_PASSKEY_ENABLED=false
```

Keep `MFA_RECOVERY_CODES_ENABLED=true` unless incident response explicitly freezes recovery-code use. Do not purge stored MFA state during rollback.

## Production Activation Order

1. Day 1: Enable MFA only for your own admin account.
2. Day 2: Enable for internal and admin accounts.
3. Day 3: Enable optional MFA for normal users.
4. Day 4: Require MFA for admins with `MFA_REQUIRED_FOR_ADMINS=true`.
5. Later: Require MFA for sellers with `MFA_REQUIRED_FOR_SELLERS=true`.
6. Much later: make passkey-first policy mandatory for super-admins.

Admin-only production enablement should keep buyer and seller enforcement off:

```sh
MFA_ENABLED=true
MFA_TOTP_ENABLED=true
MFA_PASSKEY_ENABLED=true
MFA_RECOVERY_CODES_ENABLED=true
MFA_REQUIRED_FOR_ADMINS=true
MFA_REQUIRED_FOR_SELLERS=false
MFA_EMAIL_OTP_FALLBACK_ENABLED=false
```

Apply it only after staging proof and at least one tested admin recovery path.

## Automated Smoke Proof

Run the focused rollout smoke before broad gates:

```sh
npm --prefix server test -- --runTestsByPath tests/mfaRolloutSmoke.test.js --forceExit
```

Then run the rollout gate:

```sh
npm test
npm run security:auth
npm run build
npm run lint
```
