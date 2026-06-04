# Aura MFA Staging Activation

Last updated: 2026-06-04

This runbook activates Aura MFA in staging only. Do not apply these flags to production, and do not enable admin-required MFA until normal staging user MFA has been proven with a real authenticator app.

## Current Gate

Staging activation requires this SSM SecureString before TOTP is enabled:

```sh
/aura/staging/MFA_SECRET_ENCRYPTION_KEY
```

Verify the key exists without printing its value:

```sh
aws ssm get-parameter --region ap-south-1 --name /aura/staging/MFA_SECRET_ENCRYPTION_KEY --query "Parameter.{Name:Name,Type:Type,Version:Version,LastModifiedDate:LastModifiedDate}" --output json
```

If the command returns `ParameterNotFound`, stop activation. Generate a key locally, store it as a staging-only SecureString, then rerun the existence check.

## Generate Key

Generate a 32-byte random key:

```sh
npm run security:mfa-secret
```

Equivalent direct command:

```sh
node scripts/security/generate-mfa-secret.mjs --bytes 32 --format base64
```

Store the generated value only in the staging secret manager or SSM. Keep it stable for staging; rotating this key without a migration makes existing encrypted TOTP secrets unreadable.

## Staging Flags

The staging contract is:

```sh
MFA_ENABLED=true
MFA_TOTP_ENABLED=true
MFA_PASSKEY_ENABLED=true
MFA_RECOVERY_CODES_ENABLED=true
MFA_REQUIRED_FOR_ADMINS=false
MFA_REQUIRED_FOR_SELLERS=false
MFA_EMAIL_OTP_FALLBACK_ENABLED=false
```

`scripts/staging/03-put-ssm-params.sh` writes these flags under `/aura/staging` and fails closed unless `/aura/staging/MFA_SECRET_ENCRYPTION_KEY` already exists or `STAGING_MFA_SECRET_ENCRYPTION_KEY` is supplied for that run.

Production remains disabled:

```sh
MFA_ENABLED=false
```

## Staging Smoke

Before live manual testing:

```sh
npm run env:validate:staging
npm --prefix server test -- --runTestsByPath tests/mfaRolloutSmoke.test.js --forceExit
npm run security:auth
```

After staging deploy:

```sh
npm run staging:verify
npm run smoke:staging
```

## Microsoft Authenticator Checklist

Use a staging account you can recover:

1. Open Security Center.
2. Enable authenticator app.
3. Scan the QR code with Microsoft Authenticator.
4. Confirm manual setup key enrollment also works on a fresh setup attempt.
5. Enter the six-digit code.
6. Save recovery codes.
7. Logout.
8. Login again and confirm an MFA challenge appears.
9. Confirm no final `aura_sid` or session cookie exists before MFA proof.
10. Complete login with TOTP.
11. Login again and use one recovery code.
12. Confirm the same recovery code fails on a fresh challenge.

## Admin Step-Up Follow-Up

Only after normal user staging proof passes, set this in staging:

```sh
MFA_REQUIRED_FOR_ADMINS=true
```

Then verify admin login and each dangerous action returns a fresh MFA challenge before mutation: payment or payout change, password or email change, disable MFA, recovery-code regeneration, and backup, restore, or delete operations.

## Rollback

Rollback is flag-only:

```sh
MFA_ENABLED=false
```

Do not delete stored MFA metadata during rollback.
