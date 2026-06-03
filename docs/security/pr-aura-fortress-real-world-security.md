# Summary

Advances the Aura Fortress campaign with a central sensitive-action policy engine, WebAuthn-backed critical admin decisions, zero-trust authorization helpers, redacted audit events, and a non-destructive disaster-recovery verifier.

# Security Controls Added

- Central sensitive-action classification and policy decision engine.
- Reusable sensitive-action Express middleware.
- Critical admin WebAuthn state-change checks now flow through the central policy.
- Zero-trust resource authorization foundation for owner, tenant, role, and admin override checks.
- Redacted security audit service for policy and incident evidence.
- Backup/restore safety verifier that refuses production restore by default.

# Rollback Flags

- `AUTH_SENSITIVE_ACTION_POLICY_ENABLED`
- `AUTH_SENSITIVE_ACTION_POLICY_ROLLBACK`
- `AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_STATE_CHANGES`
- `AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_SECURITY_CHANGES`
- `AUTH_WEBAUTHN_ADMIN_BREAK_GLASS_ENABLED`

# Tests Run

```sh
npm test
npm run lint
npm run build
npm run security:pqc
npm run security:admin
npm run security:free-stack
npm --prefix server test -- --runTestsByPath tests/sensitiveActionPolicy.test.js tests/sensitiveActionMiddleware.test.js tests/authorizationPolicy.test.js tests/securityAuditService.test.js tests/disasterRecoveryRunbook.test.js tests/authMiddleware.webauthnStepUp.test.js tests/authSecurityTelemetryService.test.js --forceExit
```

# CI Expectations

Existing security gates should remain enabled. Do not disable GitGuardian, Gitleaks, CodeQL, Semgrep, Trivy, PQC, Docker, or DAST checks to merge this work.

# Known Limitations

No system can be 100 percent secure. WebAuthn/passkeys reduce phishing risk but do not remove all account-takeover risk. Firebase, Stripe, Razorpay, Resend, browser/WebPKI, hosted databases, and SDK internal crypto remain partly outside direct app control. Strong authorization, audit logs, backup drills, and incident response require ongoing operation, not one-time code.

# Production Rollout Checklist

1. Confirm admin operators have WebAuthn/passkeys enrolled.
2. Deploy with policy logging visible.
3. Watch `security.audit_event` and `auth.security_event` denials.
4. Enable enforcement for critical admin state changes.
5. Confirm payment/refund and upload false positives stay at zero.
6. Keep rollback flags documented and time-boxed.
7. Run DR verifier in dry-run mode.
8. Record CI, release, and rollback evidence.
