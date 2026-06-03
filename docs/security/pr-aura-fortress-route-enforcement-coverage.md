# Enforce Aura Fortress security controls across high-risk routes

## Summary

- Wires the PR #209 sensitive-action policy into high-risk admin, payment, refund, order, upload, moderation, account-factor, data-export, listing, support, and AI tool-action routes.
- Adds route-level zero-trust owner checks for order, payment-method, and listing mutations that should not rely only on controller filters.
- Adds redacted webhook audit events for accepted, replayed, and signature-invalid payment webhooks.
- Adds a strict route coverage checker and human-readable route-by-route coverage matrix.

## Verification

```sh
npm test
npm run security:routes:coverage:strict
npm --prefix server test -- --runTestsByPath tests/sensitiveActionPolicy.test.js tests/sensitiveActionMiddleware.test.js tests/authorizationPolicy.test.js tests/securityAuditService.test.js tests/access-control.idor.security.test.js tests/admin.privilege.security.test.js tests/adminPaymentRoutes.integration.test.js tests/adminProductRoutes.integration.test.js tests/adminUserRoutes.integration.test.js tests/adminAnalyticsRoutes.integration.test.js tests/adminFraudRoutes.test.js tests/aiRoutes.test.js tests/otpAssuranceRoutes.test.js tests/payments.webhook.security.test.js --forceExit
npm run security:admin
npm run security:webhooks
npm run security:auth
npm run security:access-control
npm run build
npm run lint
npm run security:pqc
npm run security:free-stack
git diff --check
```

## Notes

- Customer payment/refund routes use fresh-auth plus resource ownership; admin payment/refund routes still require admin and inherit admin step-up behavior.
- Unauthenticated recovery/bootstrap proof-establishment routes stay outside `requireSensitiveAction` and are tracked as explicit compensating-control exclusions in the coverage checker.
- `npm run lint` passes with the repo's existing React hook warnings.
- `npm run security:free-stack` passes PQC and gitleaks locally; Trivy, OSV-Scanner, Semgrep, and cryptodeps are skipped when their local CLIs are unavailable.
