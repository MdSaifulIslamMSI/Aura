# Static And Template Text Coverage

This note classifies the stable text discovered outside the React runtime during the full-app ICU coverage expansion.

## Server Transactional Email Templates

The discovery scanner intentionally scans `server/services/email/**` because transactional email copy is user-visible. The current server email path renders templates in Node and does not have recipient-locale catalog binding, a locale preference contract on the email payload, or server-side ICU catalog loading.

For this migration, the following server email strings are documented as follow-up rather than forced into the React app catalogs:

- `server/services/email/activityEmailService.js`: `Refund Request Submitted`
- `server/services/email/activityEmailService.js`: `A refund request was created from your post-purchase command center.`
- `server/services/email/templates/otpTemplate.js`: `Payment Security Challenge`

Reason: adding React FormatJS keys would increase catalog count without changing the server email runtime, and enabling runtime translation in production would violate the migration rules. A proper server email localization migration should add recipient locale resolution, server-side ICU catalogs, placeholder validation, localized subject/preheader/html/text rendering, and focused tests for security-sensitive OTP/payment/refund email copy.

## Static HTML Metadata

`app/index.html` still has static shell metadata. Locale-aware HTML metadata needs a separate static/SEO strategy, because the Vite shell is not currently generated per locale.
