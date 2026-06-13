# Aura Fortress Route Enforcement Coverage

This matrix tracks high-risk route coverage for the sensitive-action control plane introduced in PR #209. The goal is explicit route evidence: every dangerous mutation or sensitive export route is either enforced by `requireSensitiveAction`, protected by route-level zero-trust resource authorization, audited with redaction, or documented as an intentionally separate proof flow.

Run the checker with:

```sh
npm run security:routes:coverage:strict
```

## Coverage Matrix

| Route | Category | Route enforcement |
| --- | --- | --- |
| GET /api/admin/analytics/export | DATA_EXPORT | `protect`, `admin`, `sensitiveActions.dataExport`, redacted audit |
| POST /api/admin/catalog/onboarding/validate | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminCatalogChange` |
| POST /api/admin/catalog/imports | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminCatalogChange` |
| POST /api/admin/catalog/imports/:jobId/publish | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminCatalogChange` |
| POST /api/admin/catalog/sync/run | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminCatalogChange` |
| POST /api/admin/email-ops/order-queue/:notificationId/retry | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminEmailOperation` |
| POST /api/admin/email-ops/test-send | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminEmailOperation` |
| POST /api/admin/emergency-controls/:key/activate | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, emergency role, second factor, `sensitiveActions.adminSecurityConfigChange` |
| POST /api/admin/emergency-controls/:key/deactivate | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, emergency role, second factor, `sensitiveActions.adminSecurityConfigChange` |
| POST /api/admin/emergency-controls/:key/extend | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, emergency role, second factor, `sensitiveActions.adminSecurityConfigChange` |
| PATCH /api/admin/emergency-controls/:key/message | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, emergency role, second factor, `sensitiveActions.adminSecurityConfigChange` |
| PATCH /api/admin/fraud/:decisionId/resolve | MODERATION_ACTION | `protect`, `admin`, `sensitiveActions.adminFraudModeration` |
| PATCH /api/admin/notifications/read-all | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminNotificationChange` |
| PATCH /api/admin/notifications/:notificationId/read | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminNotificationChange` |
| POST /api/admin/ops/smoke | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, `sensitiveActions.adminSecurityConfigChange` |
| POST /api/admin/ops/maintenance | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, `sensitiveActions.adminSecurityConfigChange` |
| POST /api/admin/order-emails/:notificationId/retry | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminEmailOperation` |
| POST /api/admin/payments/ops/expire-stale | PAYMENT_PAYOUT_CHANGE | `protect`, `admin`, `sensitiveActions.paymentPayoutChange` |
| PATCH /api/admin/payments/refunds/ledger/:orderId/:requestId/reference | PAYMENT_REFUND | `protect`, `admin`, `sensitiveActions.paymentRefund` |
| POST /api/admin/payments/:intentId/capture | PAYMENT_PAYOUT_CHANGE | `protect`, `admin`, `sensitiveActions.paymentPayoutChange` |
| POST /api/admin/payments/:intentId/retry-capture | PAYMENT_PAYOUT_CHANGE | `protect`, `admin`, `sensitiveActions.paymentPayoutChange` |
| POST /api/admin/products | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminProductChange` |
| PATCH /api/admin/products/:id/core | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminProductChange` |
| PATCH /api/admin/products/:id/pricing | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminProductChange` |
| DELETE /api/admin/products/:id | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminProductChange` |
| POST /api/admin/status/components | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, `sensitiveActions.adminSecurityConfigChange` |
| PATCH /api/admin/status/components/:id | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, `sensitiveActions.adminSecurityConfigChange` |
| POST /api/admin/status/incidents | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, `sensitiveActions.adminSecurityConfigChange` |
| PATCH /api/admin/status/incidents/:id | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, `sensitiveActions.adminSecurityConfigChange` |
| POST /api/admin/status/incidents/:id/updates | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, `sensitiveActions.adminSecurityConfigChange` |
| POST /api/admin/status/incidents/:id/resolve | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, `sensitiveActions.adminSecurityConfigChange` |
| POST /api/admin/status/incidents/:id/postmortem | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, `sensitiveActions.adminSecurityConfigChange` |
| POST /api/admin/status/maintenance | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, `sensitiveActions.adminSecurityConfigChange` |
| POST /api/admin/status/monitor/run | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, `sensitiveActions.adminSecurityConfigChange` |
| POST /api/admin/status/seed | ADMIN_SECURITY_CONFIG_CHANGE | `protect`, `admin`, `sensitiveActions.adminSecurityConfigChange` |
| POST /api/admin/users/:userId/warn | ADMIN_USER_MANAGEMENT | `protect`, `admin`, `sensitiveActions.adminUserMutation` |
| POST /api/admin/users/:userId/suspend | ADMIN_USER_MANAGEMENT | `protect`, `admin`, `sensitiveActions.adminUserMutation` |
| POST /api/admin/users/:userId/dismiss-warning | ADMIN_USER_MANAGEMENT | `protect`, `admin`, `sensitiveActions.adminUserMutation` |
| POST /api/admin/users/:userId/reactivate | ADMIN_USER_MANAGEMENT | `protect`, `admin`, `sensitiveActions.adminUserMutation` |
| POST /api/admin/users/:userId/delete | ADMIN_USER_MANAGEMENT | `protect`, `admin`, `sensitiveActions.adminUserMutation` |
| POST /api/auth/recovery-codes | ACCOUNT_RECOVERY_CHANGE | `protect`, CSRF unless bearer, limiter, `sensitiveActions.accountRecoveryChange` |
| POST /api/auth/mfa/totp/setup | PASSWORD_OR_AUTH_FACTOR_CHANGE | `protect`, CSRF unless bearer, limiter, `sensitiveActions.authFactorChange` |
| GET /api/auth/mfa/totp/qr | PASSWORD_OR_AUTH_FACTOR_CHANGE | `protect`, limiter, `sensitiveActions.authFactorChange` |
| POST /api/auth/mfa/totp/verify-setup | PASSWORD_OR_AUTH_FACTOR_CHANGE | `protect`, CSRF unless bearer, limiter, `sensitiveActions.authFactorChange` |
| POST /api/auth/mfa/passkey/register/options | PASSWORD_OR_AUTH_FACTOR_CHANGE | `protect`, CSRF unless bearer, limiter, `sensitiveActions.authFactorChange` |
| POST /api/auth/mfa/passkey/register/verify | PASSWORD_OR_AUTH_FACTOR_CHANGE | `protect`, CSRF unless bearer, limiter, `sensitiveActions.authFactorChange` |
| POST /api/auth/complete-phone-factor-login | PASSWORD_OR_AUTH_FACTOR_CHANGE | `protect`, limiter, `sensitiveActions.authFactorChange` |
| POST /api/auth/complete-phone-factor-verification | PASSWORD_OR_AUTH_FACTOR_CHANGE | phone-factor proof, limiter, `sensitiveActions.authFactorChange` |
| POST /api/auth/verify-device | PASSWORD_OR_AUTH_FACTOR_CHANGE | `protect`, CSRF unless bearer, limiter, `sensitiveActions.authFactorChange` |
| POST /api/auth/otp/reset-password | ACCOUNT_RECOVERY_CHANGE | Turnstile plus reset-password limiter; unauthenticated recovery proof flow |
| POST /api/ai/chat | AI_TOOL_ACTION | Rate limit plus `requireAiToolActionPolicy` for mutating tool requests |
| POST /api/ai/chat/stream | AI_TOOL_ACTION | Rate limit plus `requireAiToolActionPolicy` for mutating tool requests |
| POST /api/ai/sessions | AI_TOOL_ACTION | `protect`, AI session limiter, `sensitiveActions.aiSessionMutation` |
| POST /api/ai/sessions/:sessionId/reset | AI_TOOL_ACTION | `protect`, AI session limiter, `sensitiveActions.aiSessionMutation` |
| POST /api/ai/sessions/:sessionId/archive | AI_TOOL_ACTION | `protect`, AI session limiter, `sensitiveActions.aiSessionMutation` |
| POST /api/listings | UPLOAD_WRITE | `protect`, active account, seller, `sensitiveActions.listingWrite` |
| PUT /api/listings/:id | UPLOAD_WRITE | `protect`, active seller, `authorizeListingOwner`, `sensitiveActions.listingWrite` |
| PATCH /api/listings/:id/sold | UPLOAD_WRITE | `protect`, active seller, `authorizeListingOwner`, `sensitiveActions.listingWrite` |
| DELETE /api/listings/:id | UPLOAD_WRITE | `protect`, active seller, `authorizeListingOwner`, `sensitiveActions.listingWrite` |
| POST /api/listings/:id/escrow/intents | PAYMENT_PAYOUT_CHANGE | `protect`, active account, `sensitiveActions.listingEscrowChange` |
| POST /api/listings/:id/escrow/intents/:intentId/confirm | PAYMENT_PAYOUT_CHANGE | `protect`, active account, `sensitiveActions.listingEscrowChange` |
| PATCH /api/listings/:id/escrow/start | PAYMENT_PAYOUT_CHANGE | `protect`, active account, `sensitiveActions.listingEscrowChange` |
| PATCH /api/listings/:id/escrow/confirm | PAYMENT_PAYOUT_CHANGE | `protect`, active account, `sensitiveActions.listingEscrowChange` |
| PATCH /api/listings/:id/escrow/cancel | PAYMENT_PAYOUT_CHANGE | `protect`, active account, `sensitiveActions.listingEscrowChange` |
| POST /api/orders | ORDER_STATUS_CHANGE | `protect`, active account, OTP assurance, `sensitiveActions.orderStatusChange` |
| GET /api/orders/:id/timeline | ZERO_TRUST_READ | `protect`, `authorizeOrderOwner`, hidden existence response |
| GET /api/orders/:id/command-center | ZERO_TRUST_READ | `protect`, `authorizeOrderOwner`, hidden existence response |
| POST /api/orders/:id/command-center/refund | PAYMENT_REFUND | `protect`, active account, `authorizeOrderOwner`, `sensitiveActions.paymentRefund` |
| POST /api/orders/:id/command-center/replace | ORDER_STATUS_CHANGE | `protect`, active account, `authorizeOrderOwner`, `sensitiveActions.orderStatusChange` |
| POST /api/orders/:id/command-center/support | ORDER_STATUS_CHANGE | `protect`, active account, `authorizeOrderOwner`, `sensitiveActions.orderStatusChange` |
| POST /api/orders/:id/command-center/warranty | ORDER_STATUS_CHANGE | `protect`, active account, `authorizeOrderOwner`, `sensitiveActions.orderStatusChange` |
| PATCH /api/orders/:id/command-center/refund/:requestId/admin | PAYMENT_REFUND | `protect`, `admin`, `sensitiveActions.paymentRefund` |
| PATCH /api/orders/:id/command-center/replace/:requestId/admin | ORDER_STATUS_CHANGE | `protect`, `admin`, `sensitiveActions.orderStatusChange` |
| POST /api/orders/:id/command-center/support/admin-reply | ORDER_STATUS_CHANGE | `protect`, `admin`, `sensitiveActions.orderStatusChange` |
| PATCH /api/orders/:id/command-center/warranty/:claimId/admin | ORDER_STATUS_CHANGE | `protect`, `admin`, `sensitiveActions.orderStatusChange` |
| POST /api/orders/:id/cancel | ORDER_STATUS_CHANGE | `protect`, active account, `authorizeOrderOwner`, `sensitiveActions.orderStatusChange` |
| POST /api/orders/:id/admin-cancel | ORDER_STATUS_CHANGE | `protect`, `admin`, `sensitiveActions.orderStatusChange` |
| PATCH /api/orders/:id/status | ORDER_STATUS_CHANGE | `protect`, `admin`, `sensitiveActions.orderStatusChange` |
| POST /api/payments/webhooks/razorpay | PAYMENT_WEBHOOK_REPLAY_RISK | Provider signature verification plus `recordPaymentWebhookSecurityAudit` |
| POST /api/payments/webhooks/stripe | PAYMENT_WEBHOOK_REPLAY_RISK | Provider signature verification plus `recordPaymentWebhookSecurityAudit` |
| POST /api/payments/intents | PAYMENT_PAYOUT_CHANGE | `protect`, active account, OTP assurance, `sensitiveActions.paymentPayoutChange` |
| POST /api/payments/intents/:intentId/challenge/complete | PAYMENT_PAYOUT_CHANGE | `protect`, active account, OTP assurance, `sensitiveActions.paymentPayoutChange` |
| POST /api/payments/intents/:intentId/confirm | PAYMENT_PAYOUT_CHANGE | `protect`, active account, OTP assurance, `sensitiveActions.paymentPayoutChange` |
| POST /api/payments/intents/:intentId/refunds | PAYMENT_REFUND | `protect`, active account, OTP assurance, `sensitiveActions.paymentRefund` |
| POST /api/payments/methods/setup-intent | PAYMENT_PAYOUT_CHANGE | `protect`, active account, OTP assurance, `sensitiveActions.paymentPayoutChange` |
| POST /api/payments/methods | PAYMENT_PAYOUT_CHANGE | `protect`, active account, OTP assurance, `sensitiveActions.paymentPayoutChange` |
| PATCH /api/payments/methods/:methodId/default | PAYMENT_PAYOUT_CHANGE | `protect`, active account, OTP assurance, `authorizePaymentMethodOwner`, `sensitiveActions.paymentPayoutChange` |
| DELETE /api/payments/methods/:methodId | PAYMENT_PAYOUT_CHANGE | `protect`, active account, OTP assurance, `authorizePaymentMethodOwner`, `sensitiveActions.paymentPayoutChange` |
| POST /api/products | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminProductChange` |
| POST /api/products/:id/reviews | MODERATION_ACTION | `protect`, active account, `sensitiveActions.moderationAction` |
| PUT /api/products/:id | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminProductChange` |
| DELETE /api/products/:id | ADMIN_STATE_CHANGE | `protect`, `admin`, `sensitiveActions.adminProductChange` |
| PATCH /api/support/:id/status | MODERATION_ACTION | `protect`, `admin`, `sensitiveActions.supportModeration` |
| POST /api/support/:id/video/start | MODERATION_ACTION | `protect`, `admin`, `sensitiveActions.supportModeration` |
| POST /api/uploads/reviews/sign | UPLOAD_WRITE | `protect`, `sensitiveActions.uploadWrite` |
| POST /api/uploads/reviews/upload | UPLOAD_WRITE | `protect`, `sensitiveActions.uploadWrite` |

## Intentionally Separate Proof Flows

Some high-risk auth routes are unauthenticated by design because they are proof-establishment endpoints. They remain in the checker exclusion list with specific compensating controls:

| Route | Reason |
| --- | --- |
| POST /api/auth/bootstrap-device-challenge | Turnstile and security-critical bootstrap-device limiter. |
| POST /api/auth/recovery-codes/verify | Turnstile, recovery limiter, and recovery-code verifier. |
| POST /api/auth/logout | Session mutation limiter and CSRF for cookie sessions. |
| POST /api/auth/exchange | Token verification and CSRF token generation. |
| POST /api/auth/sync | Token verification, CSRF, and auth sync limiter. |
| POST /api/auth/desktop-handoff/custom-token | Authenticated desktop handoff limiter. |
