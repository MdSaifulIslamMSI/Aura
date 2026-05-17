# Login Architecture Gap Backlog - 2026-05-09

## Scope
- Compared the current repository login architecture against the supplied world-class login architecture reference.
- Ran the local login/security gate and fixed the dependency blocker needed for that gate to pass.
- Did not run external staging smoke, production smoke, deploys, or cloud-side infrastructure inspection.

## Verification Baseline
- Initial `npm.cmd run security:login-gates` result: failed at `security:audit:server`.
- Initial blocker: `fast-xml-builder@1.1.5`, reached through `firebase-admin -> @google-cloud/storage -> fast-xml-parser -> fast-xml-builder`.
- Fix applied: server npm override pins `fast-xml-builder` to `^1.2.0`; server lockfile now resolves `fast-xml-builder@1.2.0`.
- Final `npm.cmd run security:login-gates` result: passed.
- Final gate coverage:
  - Deprecated package gate passed for 3 npm lockfiles.
  - Root, app, and server production dependency audits reported 0 vulnerabilities.
  - Production hardening audit reported 0 failures.
  - Production login environment audit reported 0 failures and 0 warnings.
  - Attack smoke passed: 1 Jest suite, 5 tests.
  - Auth tests passed: 10 Jest suites, 109 tests.
- Test logs include expected negative-path auth errors for rejected CSRF, invalid recovery code reuse, missing sessions, reused OTP assurance tokens, and missing trusted-device proof.

## Current Strengths
- Backend-authoritative Firebase authentication and session sync.
- Redis-backed session, CSRF, and distributed rate-limit controls.
- Trusted-device and WebAuthn/passkey step-up for sensitive flows.
- OTP and recovery-code coverage with focused attack-smoke tests.
- Admin access controls requiring stronger assurance.
- Production auth environment contract checks and CI login/security gates.

## Gap Backlog

| Priority | Area | Current gap vs reference | Next action | Verification |
|---|---|---|---|---|
| P0 | Dependency security gate | Fixed in this pass: server audit was blocked by vulnerable transitive `fast-xml-builder@1.1.5`. | Keep `fast-xml-builder` override until upstream dependency resolves safely; remove only after server audit still passes without it. | `npm.cmd --prefix server audit --omit=dev --audit-level=low` and `npm.cmd run security:login-gates`. |
| P1 | Edge and perimeter security | Partially closed: CloudFront-scope AWS WAFv2 template and runbook now exist. Live association, bot-control paid feature decision, and baseline tuning remain open. | Validate/deploy `infra/aws/waf-login-security-cloudfront.yml` in staging, attach its output ARN to CloudFront, then tune sampled requests. | `npm.cmd run security:login-next10`; `aws cloudformation validate-template --template-body file://infra/aws/waf-login-security-cloudfront.yml --region us-east-1`. |
| P1 | Observability and security operations | Partially closed: app-layer login security metric/event coverage, repo-owned Prometheus alert rules, Grafana provisioning, and local/EC2 compose overlays now exist. External SIEM pipeline, tracing, SLO ownership, and production threshold tuning remain open. | Dry-run the EC2 observability overlay with real secrets, then tune thresholds from baseline traffic and decide SIEM export requirements. | `npm.cmd run observability:validate`; `npm.cmd run security:login-gates`; production dashboard/alert dry run when infra is available. |
| P1 | Login risk engine lite | Closed further: `authRiskEngineService` scores failed-login velocity, new/missing device, suspicious IP bucket, impossible-travel placeholder, and step-up/block recommendations. Runtime enforcement now ignores/strips unsigned client risk headers, preserves valid upstream signatures, and can produce signed server-side IP reputation signals. | Feed edge velocity and richer IP intelligence into the same signed signal path, then gate high-risk login sessions behind step-up in staging. | `npm.cmd --prefix server test -- --runTestsByPath tests/authRiskEngineService.test.js tests/authRiskSignalService.test.js tests/authRiskSignalProducerMiddleware.test.js tests/authRoutes.integration.test.js`. |
| P2 | Auth protocol/provider breadth | Partially closed: Microsoft and Apple Firebase OAuth support is available behind explicit frontend flags; enterprise OIDC/SAML are codified as design-required providers. Live provider credentials and smoke tests remain open. | Configure Firebase provider credentials in staging, set `VITE_FIREBASE_ENABLE_MICROSOFT_AUTH` / `VITE_FIREBASE_ENABLE_APPLE_AUTH`, and run browser auth smoke. | `npm.cmd run security:login-next10`; staging browser auth smoke. |
| P2 | Authorization model | Partially closed: `server/config/authorizationPolicy.js` formalizes admin and sensitive auth/user permissions. Runtime policy engine remains optional. | Compare manifest against route inventory in CI before introducing PDP/PEP machinery. | `npm.cmd --prefix server test -- --runTestsByPath tests/loginArchitecturePolicy.test.js`. |
| P2 | Privacy and compliance workflows | Partially closed: privacy data inventory and workflow contract now exist. User-facing export/erasure controllers remain open until legal requirements are confirmed. | Implement subject export/delete endpoints from `server/config/privacyDataInventory.js` after retention rules are approved. | `npm.cmd --prefix server test -- --runTestsByPath tests/loginArchitecturePolicy.test.js`. |
| P2 | Disaster recovery and high availability | Partially closed: auth state DR/HA runbook and minimum restore drill are documented. Multi-region/failover execution remains open. | Run the documented restore drill in isolated staging and record RTO/RPO evidence. | Restore drill plus `npm.cmd run security:login-gates`. |
| P3 | User lifecycle and provisioning | User governance exists, but enterprise SCIM provisioning and directory lifecycle are absent. | Defer unless enterprise customers require SSO/SCIM. | SCIM contract tests when implemented. |
| P3 | Event bus for auth security | Partially closed: optional Mongo-backed auth security outbox scaffold exists behind `AUTH_SECURITY_OUTBOX_ENABLED`; publisher/replay worker remains open. | Enable in staging only after storage/retention are confirmed, then add publisher idempotency. | `npm.cmd --prefix server test -- --runTestsByPath tests/authSecurityEventOutboxService.test.js`. |
| P3 | Privileged access management | Partially closed: JIT/PAM policy manifest and runbook now exist; enforcement is disabled by default. | Confirm operator roster and approval model before adding active JIT checks to destructive admin routes. | `npm.cmd --prefix server test -- --runTestsByPath tests/loginArchitecturePolicy.test.js`. |

## Safe Next Gate
The best next implementation slice is staging activation: validate WAF, start the observability overlay with real secrets, enable Microsoft/Apple in Firebase staging if desired, then run browser login smoke. Keep production smoke blocked until isolated staging credentials and backing services are explicitly configured.
