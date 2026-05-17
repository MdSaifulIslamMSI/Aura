# Login Next 10 Status - 2026-05-09

| # | Area | Status |
|---|---|---|
| 1 | Production observability activation | EC2 Prometheus/Grafana overlay is live, localhost-bound, and Prometheus is scraping `aura-api`. |
| 2 | Edge/perimeter security | CloudFront WAFv2 stack is deployed and attached to distribution `E34Z9POGIQYOCS`. |
| 3 | Login risk engine lite | `authRiskEngineService` added with focused tests; runtime enforcement now strips spoofed risk headers, preserves signed edge/server risk signals, and can produce signed server-side IP reputation before step-up. |
| 4 | Microsoft/Apple providers | Microsoft Firebase provider is configured, exposed in the CloudFront frontend, and browser-smoke-tested. Apple still requires Apple Developer credentials. |
| 5 | Enterprise SSO/OIDC/SAML | Provider policy and decision rules added; implementation deferred until tenant requirements exist. |
| 6 | Authorization model | Route permission manifest added for admin and sensitive auth/user surfaces. |
| 7 | Privacy/compliance workflows | Data inventory and workflow contract added. |
| 8 | DR/HA | Auth state DR/HA runbook added. |
| 9 | Auth security event bus/outbox | Optional Mongo-backed outbox scaffold added behind `AUTH_SECURITY_OUTBOX_ENABLED`. |
| 10 | Privileged admin access | JIT/PAM policy manifest and runbook added; disabled by default. |

## Remaining Live Work
Apple provider setup and threshold tuning remain. Use `docs/login-staging-production-activation.md` and `npm.cmd run security:login-live-readiness -- --strict` as the activation gate before future promotion changes.
