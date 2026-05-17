# Cisco Duo Security Hardening

This repo is prepared for Cisco Duo Universal Prompt as an additional MFA checkpoint for high-risk auth/admin flows. Live Duo activation must use staging or production credentials supplied through the runtime secret manager, never committed files.

## Defensive Scope

- Use Duo only for this app's own auth, admin, emergency-control, and payment-risk flows.
- Never place `DUO_CLIENT_SECRET` in frontend code, `.env.example` values, logs, or test fixtures.
- Keep all local and CI checks deterministic and offline.
- Fail closed when Duo is enabled but the full integration contract is not configured.

## Required Runtime Variables

| Variable | Purpose |
| --- | --- |
| `DUO_ENABLED` | Enables Duo enforcement when set to `true`. |
| `DUO_CLIENT_ID` | Duo Universal Prompt client ID. |
| `DUO_CLIENT_SECRET` | Duo Universal Prompt client secret from the secret manager. |
| `DUO_API_HOST` | Duo Web SDK API hostname, for example `api-xxxxxxxx.duosecurity.com`. Use for Web SDK apps. |
| `DUO_OIDC_ISSUER` | Duo Generic OIDC issuer URL. Use for Generic OIDC Relying Party apps. |
| `DUO_DISCOVERY_URL` | Duo OIDC discovery URL. Optional when it can be derived from `DUO_OIDC_ISSUER`. |
| `DUO_REDIRECT_URI` | Backend callback URL registered in Duo. |
| `DUO_FAIL_CLOSED` | Defaults to `true`; keep true outside emergency break-glass. |

## CLI / CI Readiness

Run:

```powershell
npm run security:duo
npm run duo:activate
```

The gate checks that:

- Duo documentation exists.
- Backend Duo config parsing exists and is tested.
- Duo secrets are included in the runtime secret-manager contract.
- No live Duo credentials are required for CI.
- If any Duo env var is set, all required Duo env vars must be present.

`npm run duo:activate` is the CLI activation check. For Web SDK apps, it uses the official Duo Universal Node SDK and runs Duo `healthCheck()`. For Generic OIDC Relying Party apps, it validates the OIDC discovery document, issuer, authorization endpoint, token endpoint, JWKS URL, and UserInfo URL. It writes `security-reports/duo-activation.json` without secret values.

To publish Duo values to AWS Systems Manager Parameter Store, put real values in `server/.env.aws-secrets` locally and run the existing AWS CLI-backed sync:

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\aws\sync-parameter-store-env.ps1 -SourceEnvFile .\server\.env.aws-secrets -PathPrefix /aura/staging -AwsRegion ap-south-1 -DryRun
powershell -ExecutionPolicy Bypass -File .\infra\aws\sync-parameter-store-env.ps1 -SourceEnvFile .\server\.env.aws-secrets -PathPrefix /aura/staging -AwsRegion ap-south-1
```

The dry run prints parameter names and value lengths only. Do not commit `server/.env.aws-secrets`.

## Manual Activation Checklist

1. Create a Duo Universal Prompt OIDC/Web SDK application in Cisco Duo.
2. Store either Web SDK values (`DUO_CLIENT_ID`, `DUO_CLIENT_SECRET`, `DUO_API_HOST`, `DUO_REDIRECT_URI`) or Generic OIDC values (`DUO_CLIENT_ID`, `DUO_CLIENT_SECRET`, `DUO_OIDC_ISSUER`, `DUO_DISCOVERY_URL`, `DUO_REDIRECT_URI`) in the runtime secret manager.
3. Enable Duo first in staging with fake users and test admins.
4. Verify high-risk flows: admin login, role change, emergency controls, recovery-code verification, refund/payment actions.
5. Confirm logs do not contain Duo secrets, auth codes, state, raw session tokens, or full user PII.
6. Only then set `DUO_ENABLED=true` for production.

## References

- Cisco Duo Universal Prompt Web SDK: https://duo.com/docs/duoweb
- Cisco Duo OIDC Auth API: https://duo.com/docs/oauthapi
