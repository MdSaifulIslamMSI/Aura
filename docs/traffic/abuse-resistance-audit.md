# Abuse Resistance Audit

Generated: 2026-07-05T08:44:32.727Z

Status: pass

Summary: 56 pass, 0 warning, 0 fail, 0 skipped.

## Checks

| ID | Status | Scope | Severity | Summary |
| --- | --- | --- | --- | --- |
| abuse.common-budget.observability-health | pass | repo | info | observability-health: cost=medium, timeout=1500, tag=observability-health. |
| abuse.common-budget.public-status | pass | repo | info | public-status: cost=medium, timeout=3000, tag=public-status. |
| abuse.mutation-authority.observability-ingest | pass | repo | info | observability-ingest declares auth, signature, flow, admin, or quota control. |
| abuse.common-budget.observability-ingest | pass | repo | info | observability-ingest: cost=high, timeout=10000, tag=observability-ingest. |
| abuse.common-budget.observability-admin-read | pass | repo | info | observability-admin-read: cost=critical, timeout=10000, tag=observability-admin-read. |
| abuse.common-budget.static-frontend-assets | pass | repo | info | static-frontend-assets: cost=medium, timeout=5000, tag=static-frontend-assets. |
| abuse.mutation-authority.provider-webhooks | pass | repo | info | provider-webhooks declares auth, signature, flow, admin, or quota control. |
| abuse.webhook-signature.provider-webhooks | pass | repo | info | provider-webhooks: signature=true, idempotency=true. |
| abuse.common-budget.provider-webhooks | pass | repo | info | provider-webhooks: cost=high, timeout=8000, tag=provider-webhooks. |
| abuse.mutation-authority.admin-write | pass | repo | info | admin-write declares auth, signature, flow, admin, or quota control. |
| abuse.admin-guard.admin-write | pass | repo | info | server/security/sensitiveActionRegistry.js |
| abuse.common-budget.admin-write | pass | repo | info | admin-write: cost=critical, timeout=10000, tag=admin-write. |
| abuse.admin-guard.admin-read | pass | repo | info | server/middleware/authMiddleware.js |
| abuse.common-budget.admin-read | pass | repo | info | admin-read: cost=critical, timeout=10000, tag=admin-read. |
| abuse.mutation-authority.password-reset | pass | repo | info | password-reset declares auth, signature, flow, admin, or quota control. |
| abuse.auth-strict.password-reset | pass | repo | info | password-reset: failMode=fail-closed, perIp=12. |
| abuse.common-budget.password-reset | pass | repo | info | password-reset: cost=critical, timeout=15000, tag=password-reset. |
| abuse.mutation-authority.otp-send-verify | pass | repo | info | otp-send-verify declares auth, signature, flow, admin, or quota control. |
| abuse.auth-strict.otp-send-verify | pass | repo | info | otp-send-verify: failMode=fail-closed, perIp=12. |
| abuse.common-budget.otp-send-verify | pass | repo | info | otp-send-verify: cost=critical, timeout=7000, tag=otp-send-verify. |
| abuse.mutation-authority.trusted-device-webauthn | pass | repo | info | trusted-device-webauthn declares auth, signature, flow, admin, or quota control. |
| abuse.auth-strict.trusted-device-webauthn | pass | repo | info | trusted-device-webauthn: failMode=fail-closed, perIp=60. |
| abuse.common-budget.trusted-device-webauthn | pass | repo | info | trusted-device-webauthn: cost=high, timeout=10000, tag=trusted-device-webauthn. |
| abuse.auth-strict.mfa-passkey-duo-step-up | pass | repo | info | mfa-passkey-duo-step-up: failMode=fail-closed, perIp=40. |
| abuse.common-budget.mfa-passkey-duo-step-up | pass | repo | info | mfa-passkey-duo-step-up: cost=critical, timeout=7000, tag=mfa-passkey-duo-step-up. |
| abuse.auth-strict.auth-login-session | pass | repo | info | auth-login-session: failMode=fail-closed, perIp=40. |
| abuse.common-budget.auth-login-session | pass | repo | info | auth-login-session: cost=critical, timeout=7000, tag=auth-login-session. |
| abuse.ai-quota.ai-chat-model-gateway | pass | repo | info | ai-chat-model-gateway: quota=true, concurrency=true. |
| abuse.common-budget.ai-chat-model-gateway | pass | repo | info | ai-chat-model-gateway: cost=critical, timeout=25000, tag=ai-chat-model-gateway. |
| abuse.payment-idempotency.payment-checkout | pass | repo | info | Payment intent, provider idempotency, and state-machine guards own duplicate prevention. |
| abuse.common-budget.payment-checkout | pass | repo | info | payment-checkout: cost=critical, timeout=12000, tag=payment-checkout. |
| abuse.mutation-authority.cart-order-mutations | pass | repo | info | cart-order-mutations declares auth, signature, flow, admin, or quota control. |
| abuse.payment-idempotency.cart-order-mutations | pass | repo | info | Canonical cart commands and order state machines must reject unsafe repeats. |
| abuse.common-budget.cart-order-mutations | pass | repo | info | cart-order-mutations: cost=high, timeout=10000, tag=cart-order-mutations. |
| abuse.common-budget.cart-order-reads | pass | repo | info | cart-order-reads: cost=medium, timeout=8000, tag=cart-order-reads. |
| abuse.mutation-authority.live-socket-video | pass | repo | info | live-socket-video declares auth, signature, flow, admin, or quota control. |
| abuse.socket-proof.live-socket-video | pass | repo | info | server/tests/liveCallSessionKeyAuthz.test.js |
| abuse.common-budget.live-socket-video | pass | repo | info | live-socket-video: cost=high, timeout=10000, tag=live-socket-video. |
| abuse.mutation-authority.upload-review-media | pass | repo | info | upload-review-media declares auth, signature, flow, admin, or quota control. |
| abuse.upload.upload-review-media | pass | repo | info | upload-review-media: body=9437184, validation=true. |
| abuse.common-budget.upload-review-media | pass | repo | info | upload-review-media: cost=high, timeout=20000, tag=upload-review-media. |
| abuse.mutation-authority.recommendation-events | pass | repo | info | recommendation-events declares auth, signature, flow, admin, or quota control. |
| abuse.common-budget.recommendation-events | pass | repo | info | recommendation-events: cost=high, timeout=10000, tag=recommendation-events. |
| abuse.mutation-authority.marketplace-mutations | pass | repo | info | marketplace-mutations declares auth, signature, flow, admin, or quota control. |
| abuse.common-budget.marketplace-mutations | pass | repo | info | marketplace-mutations: cost=high, timeout=10000, tag=marketplace-mutations. |
| abuse.common-budget.product-search-browsing | pass | repo | info | product-search-browsing: cost=medium, timeout=4500, tag=product-search-browsing. |
| abuse.mutation-authority.i18n-translation | pass | repo | info | i18n-translation declares auth, signature, flow, admin, or quota control. |
| abuse.common-budget.i18n-translation | pass | repo | info | i18n-translation: cost=high, timeout=10000, tag=i18n-translation. |
| abuse.common-budget.public-api-read | pass | repo | info | public-api-read: cost=medium, timeout=6000, tag=public-api-read. |
| abuse.mutation-authority.user-support-mutations | pass | repo | info | user-support-mutations declares auth, signature, flow, admin, or quota control. |
| abuse.common-budget.user-support-mutations | pass | repo | info | user-support-mutations: cost=high, timeout=10000, tag=user-support-mutations. |
| abuse.common-budget.internal-jobs-workers | pass | repo | info | internal-jobs-workers: cost=high, timeout=10000, tag=internal-jobs-workers. |
| abuse.mutation-authority.api-mutation-fallback | pass | repo | info | api-mutation-fallback declares auth, signature, flow, admin, or quota control. |
| abuse.common-budget.api-mutation-fallback | pass | repo | info | api-mutation-fallback: cost=high, timeout=10000, tag=api-mutation-fallback. |
| abuse.common-budget.api-read-fallback | pass | repo | info | api-read-fallback: cost=medium, timeout=6000, tag=api-read-fallback. |
| abuse.common-budget.static-fallback | pass | repo | info | static-fallback: cost=medium, timeout=5000, tag=static-fallback. |

## Policy Summary

| Component | Policy | Profile | Class | IP Limit | User Limit | Body | Timeout | Fail Mode |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Observability/health | observability-health | Observability/health | HEALTH | 1200/60s | 0/60s | 8192 | 1500ms | fail-open-safe |
| Observability/health | public-status | Observability/health | STATUS_PUBLIC | 600/60s | 0/60s | 16384 | 3000ms | fail-open-safe |
| Observability/health | observability-ingest | Observability/health | AUTHENTICATED_WRITE | 120/300s | 120/300s | 262144 | 10000ms | fail-closed |
| Observability/health | observability-admin-read | Observability/health | ADMIN_READ | 80/300s | 120/300s | 98304 | 10000ms | fail-closed |
| Static frontend/assets | static-frontend-assets | Static frontend/assets | STATIC_PUBLIC | 2400/60s | 0/60s | 8192 | 5000ms | fail-open-safe |
| Email/SMS/webhooks | provider-webhooks | Webhook/internal | WEBHOOK | 300/60s | 0/60s | 262144 | 8000ms | fail-open-safe |
| Admin routes | admin-write | Admin and privileged actions | ADMIN_WRITE | 40/300s | 40/300s | 131072 | 10000ms | fail-closed |
| Admin routes | admin-read | Admin and privileged actions | ADMIN_READ | 80/300s | 120/300s | 98304 | 10000ms | fail-closed |
| Password reset | password-reset | Auth and account security | OTP_RESET | 12/300s | 8/300s | 65536 | 15000ms | fail-closed |
| OTP send | otp-send-verify | Auth and account security | OTP | 12/300s | 8/300s | 65536 | 7000ms | fail-closed |
| MFA/passkey/Duo step-up | trusted-device-webauthn | Auth and account security | AUTH_WEBAUTHN | 60/300s | 30/300s | 98304 | 10000ms | fail-closed |
| MFA/passkey/Duo step-up | mfa-passkey-duo-step-up | Auth and account security | AUTH_LOGIN | 40/300s | 20/300s | 65536 | 7000ms | fail-closed |
| Auth/login/session | auth-login-session | Auth and account security | AUTH_LOGIN | 40/300s | 20/300s | 65536 | 7000ms | fail-closed |
| AI assistant/chat/model gateway | ai-chat-model-gateway | AI/chat/model gateway | AI_EXPENSIVE | 30/60s | 50/60s | 9437184 | 25000ms | fail-closed |
| Payment/checkout/order | payment-checkout | Payment and checkout | PAYMENT | 60/300s | 80/300s | 131072 | 12000ms | fail-closed |
| Cart | cart-order-mutations | Payment and checkout | AUTHENTICATED_WRITE | 120/300s | 120/300s | 262144 | 10000ms | fail-closed |
| Cart | cart-order-reads | Payment and checkout | AUTHENTICATED_READ | 240/60s | 300/60s | 98304 | 8000ms | fail-open-safe |
| LiveKit/socket/video support | live-socket-video | Live/socket/video | AUTHENTICATED_WRITE | 120/300s | 120/300s | 262144 | 10000ms | fail-closed |
| Upload/review media | upload-review-media | Upload and media | UPLOAD | 20/300s | 20/300s | 9437184 | 20000ms | fail-closed |
| Recommendation events | recommendation-events | Public browsing | AUTHENTICATED_WRITE | 120/300s | 120/300s | 262144 | 10000ms | fail-closed |
| Search/listing/marketplace | marketplace-mutations | Public browsing | AUTHENTICATED_WRITE | 120/300s | 120/300s | 262144 | 10000ms | fail-closed |
| Search/listing/marketplace | product-search-browsing | Public browsing | PUBLIC_SEARCH | 120/60s | 0/60s | 98304 | 4500ms | fail-open-safe |
| i18n/translation | i18n-translation | Public browsing | AUTHENTICATED_WRITE | 120/300s | 120/300s | 262144 | 10000ms | fail-closed |
| Product browsing | public-api-read | Public browsing | PUBLIC_READ | 300/60s | 0/60s | 32768 | 6000ms | fail-open-safe |
| Auth/login/session | user-support-mutations | Auth and account security | AUTHENTICATED_WRITE | 120/300s | 120/300s | 262144 | 10000ms | fail-closed |
| Internal jobs/workers | internal-jobs-workers | Webhook/internal | AUTHENTICATED_WRITE | 120/300s | 120/300s | 262144 | 10000ms | fail-closed |
| Product browsing | api-mutation-fallback | Public browsing | AUTHENTICATED_WRITE | 120/300s | 120/300s | 262144 | 10000ms | fail-closed |
| Product browsing | api-read-fallback | Public browsing | PUBLIC_READ | 300/60s | 0/60s | 32768 | 6000ms | fail-open-safe |
| Static frontend/assets | static-fallback | Static frontend/assets | STATIC_PUBLIC | 2400/60s | 0/60s | 8192 | 5000ms | fail-open-safe |

## Output Contract

- Failures identify routes that are too loose for abuse resistance.
- Auth, payment, admin, upload, AI, webhook, and socket checks are merge blockers.
