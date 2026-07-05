# Rate Limit Smoothness Audit

Generated: 2026-07-05T08:44:20.822Z

Status: pass

Summary: 15 pass, 5 warning, 0 fail, 0 skipped.

## Checks

| ID | Status | Scope | Severity | Summary |
| --- | --- | --- | --- | --- |
| smooth.health.observability-health | pass | repo | info | observability-health: timeout=1500ms, body=8192. |
| smooth.webhook.provider-webhooks | pass | repo | info | provider-webhooks declares signature/replay posture. |
| smooth.admin.admin-write | pass | repo | info | admin-write: adminRequired=true, perIp=40, failMode=fail-closed. |
| smooth.admin.admin-read | pass | repo | info | admin-read: adminRequired=true, perIp=80, failMode=fail-closed. |
| smooth.auth-flow.password-reset | pass | repo | info | password-reset declares flow/challenge protection. |
| smooth.auth-flow.otp-send-verify | pass | repo | info | otp-send-verify declares flow/challenge protection. |
| smooth.auth-flow.trusted-device-webauthn | pass | repo | info | trusted-device-webauthn declares flow/challenge protection. |
| smooth.auth-flow.mfa-passkey-duo-step-up | pass | repo | info | mfa-passkey-duo-step-up declares flow/challenge protection. |
| smooth.auth-flow.auth-login-session | pass | repo | info | auth-login-session declares flow/challenge protection. |
| smooth.concurrency.ai-chat-model-gateway | pass | repo | info | Provider quota and chatQuotaService control expensive model pressure. |
| smooth.concurrency.live-socket-video | pass | repo | info | Socket service and listing live-call limiter cap token minting. |
| smooth.upload.upload-review-media | pass | repo | info | upload-review-media has body-size and file-validation evidence. |
| smooth.public-cache.recommendation-events | warning | repo | medium | Public browsing route is no-store with a low per-IP allowance. |
| smooth.public-cache.marketplace-mutations | warning | repo | medium | Public browsing route is no-store with a low per-IP allowance. |
| smooth.public.product-search-browsing | pass | repo | info | product-search-browsing allows 120/60s per IP. |
| smooth.public-cache.i18n-translation | warning | repo | medium | Public browsing route is no-store with a low per-IP allowance. |
| smooth.public.public-api-read | pass | repo | info | public-api-read allows 300/60s per IP. |
| smooth.public-cache.api-mutation-fallback | warning | repo | medium | Public browsing route is no-store with a low per-IP allowance. |
| smooth.public.api-read-fallback | pass | repo | info | api-read-fallback allows 300/60s per IP. |
| smooth.identical-limits.120-120-80-262144-10000 | warning | repo | medium | 9 policies share identical limit shape across 9 components. |

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

- Warnings identify UX smoothness risks without weakening blockers.
- Failures indicate policy gaps that should block merge.
