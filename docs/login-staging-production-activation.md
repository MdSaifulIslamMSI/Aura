# Login Staging and Production Activation

This is the operator runbook for turning the repo-owned login architecture work into staging, then production, without changing enforcement faster than the telemetry can explain.

## Preconditions

| Area | Required before staging | Required before production |
|---|---|---|
| AWS access | Fresh `aws login` session and the target CloudFront distribution id. | Same, plus reviewed WAF metrics from staging. |
| WAF | CloudFormation template validates in `us-east-1`. | Web ACL association has a tested rollback path. |
| Observability | `METRICS_SECRET` and `GRAFANA_ADMIN_PASSWORD` are set for the overlay. | Alerts are tuned from staging traffic. |
| Microsoft/Apple | Microsoft is configured in Firebase and exposed in the CloudFront frontend; Apple still needs Apple Developer credentials before its frontend flag is enabled. | Provider callback domains, legal copy, and browser smoke are reviewed. |
| Runtime enforcement | `AUTH_RISK_ENGINE_MODE=monitor`, outbox enabled only in staging first, and `AUTH_RISK_SIGNAL_SECRET` provisioned before any enforce dry run. | Risk enforcement only after threshold review, signed edge/server signals, and support runbook approval; JIT remains off until an approval workflow exists. |

## Local Preflight

```powershell
npm.cmd run security:login-live-readiness
npm.cmd run security:login-next10
npm.cmd run security:login-gates
```

For a real staging activation, set the target context before the readiness check:

```powershell
$env:AURA_LOGIN_ENVIRONMENT = 'staging'
$env:AURA_CLOUDFRONT_DISTRIBUTION_ID = 'E123EXAMPLE'
$env:AURA_WAF_STACK_NAME = 'aura-login-security-staging'
$env:AUTH_RISK_ENGINE_MODE = 'monitor'
$env:AUTH_SECURITY_OUTBOX_ENABLED = 'true'
$env:AUTH_RISK_SIGNAL_SECRET = '<long-random-login-risk-signal-secret>'
$env:PRIVILEGED_JIT_ACCESS_ENABLED = 'false'
$env:VITE_FIREBASE_ENABLE_MICROSOFT_AUTH = 'true'
$env:VITE_FIREBASE_ENABLE_APPLE_AUTH = 'true'
npm.cmd run security:login-live-readiness -- --strict
```

## AWS WAF Activation

Refresh AWS access first. The previous live discovery attempt failed with an expired AWS session, so do not treat any cloud state as verified until this succeeds:

```powershell
aws login
aws sts get-caller-identity --region us-east-1
```

Validate and deploy the CloudFront-scoped Web ACL in `us-east-1`:

```powershell
aws cloudformation validate-template --template-body file://infra/aws/waf-login-security-cloudfront.yml --region us-east-1
aws cloudformation deploy --stack-name $env:AURA_WAF_STACK_NAME --template-file infra/aws/waf-login-security-cloudfront.yml --region us-east-1 --parameter-overrides EnvironmentName=$env:AURA_LOGIN_ENVIRONMENT
aws cloudformation describe-stacks --stack-name $env:AURA_WAF_STACK_NAME --region us-east-1
```

Attach the resulting Web ACL ARN to CloudFront through the distribution config. CloudFront uses the distribution `WebACLId` field for this path; do not use `AWS::WAFv2::WebACLAssociation` for CloudFront.

## Observability Activation

Start with staging or EC2 only after `METRICS_SECRET` and `GRAFANA_ADMIN_PASSWORD` are present:

```powershell
docker compose -f docker-compose.split-runtime.yml -f infra/observability/docker-compose.ec2.yml config
docker compose -f docker-compose.split-runtime.yml -f infra/observability/docker-compose.ec2.yml up -d prometheus grafana
```

Confirm `/metrics` is protected, Prometheus can scrape with `x-metrics-key`, and Grafana loads the login security dashboard before any production switch.

## Provider Activation

Enable providers in Firebase first, then expose completed providers in the app with:

```powershell
$env:VITE_FIREBASE_ENABLE_MICROSOFT_AUTH = 'true'
$env:VITE_FIREBASE_ENABLE_APPLE_AUTH = 'true'
```

Microsoft requires the app id, secret, tenant/callback setup, authorized Firebase redirect URI, and browser smoke after deployment. Apple requires the Service ID, Team ID, Key ID, private key, domains, and callback URL. Keep provider frontend flags off until the matching console setup is complete.

## Runtime Enforcement Decisions

| Control | Staging default | Production default | Promotion rule |
|---|---|---|---|
| Login risk engine | `AUTH_RISK_ENGINE_MODE=monitor` | `monitor` | Move to `enforce` only after threshold review and support runbook approval. |
| Auth security outbox | `AUTH_SECURITY_OUTBOX_ENABLED=true` | `false` until observed | Enable production after queue creation, drain, and alert visibility are confirmed. |
| Privileged JIT access | `PRIVILEGED_JIT_ACCESS_ENABLED=false` | `false` | Enable only after approval workflow, audit review, and break-glass ownership exist. |

### Staged Login Risk Enforcement

`AUTH_RISK_ENGINE_MODE=monitor` evaluates login risk and records telemetry, but it never changes the `/api/auth/sync` response. Use this first in staging with `AUTH_SECURITY_OUTBOX_ENABLED=true` and review `login_risk`, `trusted_device_challenge`, and `step_up_required` events.

`AUTH_RISK_ENGINE_MODE=enforce` keeps low and medium decisions on the normal session path. High-risk decisions that recommend step-up return the existing `device_challenge_required` response and persist `session.riskState=login_risk_high` until the trusted-device challenge succeeds. The runtime uses the current trusted-device headers plus optional trusted edge/server signals: `X-Aura-Login-Failure-Count`, `X-Aura-IP-Reputation`, and `X-Aura-Impossible-Travel`.

Those signal headers are ignored unless they arrive with a fresh HMAC signature in `X-Aura-Login-Risk-Signature` and timestamp in `X-Aura-Login-Risk-Timestamp`. The signature secret is `AUTH_RISK_SIGNAL_SECRET`; rotate with `AUTH_RISK_SIGNAL_PREVIOUS_SECRETS`. The signed payload is bound to method, path, trusted device id, normalized signal values, and timestamp. The API now strips spoofed unsigned copies on `/api/auth/sync`, preserves valid upstream signatures, and can sign server-derived exact-match IP reputation from `AUTH_RISK_IP_DENYLIST` / `AUTH_RISK_IP_WATCHLIST`. Keep unsigned client-supplied copies stripped at the edge anyway so logs and downstream tools do not confuse attacker input with trusted signals.

Rollback is environment-only for these controls: set `AUTH_RISK_ENGINE_MODE=off`, `AUTH_SECURITY_OUTBOX_ENABLED=false`, and `PRIVILEGED_JIT_ACCESS_ENABLED=false`, then redeploy the affected service. `off` stops risk evaluation, and monitor/off mode treats any stored `login_risk_high` session posture as standard so already-signed-in users are not stuck behind the staged gate.
