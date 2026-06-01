# Full App ICU Text Coverage Expansion Plan

Generated from `npm run i18n:discover-text` on branch `codex/i18n-expand-full-app-text-coverage`.

## Baseline

- Required ICU key count: 2834
- Locale coverage: 100% across required static runtime keys
- Production legacy lookup count: 0
- Residual production legacy literal ID count: 0
- Dynamic production i18n lookup count: 0
- Forbidden i18n endpoint scan: passed
- Focused i18n tests: passed
- Frontend production build: passed

## Discovery Summary

- Files scanned: 338
- Candidate stable UI texts: 1549
- Candidates already covered by existing ICU text: 201
- New uncovered candidates: 1348
- High-risk uncovered candidates: 394
- Medium-risk uncovered candidates: 193
- Low-risk uncovered candidates: 761
- Dynamic exclusions: 9
- False positives / non-production exclusions: 15374
- Parse errors: 0

## Trust Calibration

The first scanner pass intentionally over-collected. The refined pass now filters:

- non-visible JSX attribute expressions such as `className`
- route/API/CSS/id/class-like tokens
- lowercase enum/status tokens such as method codes
- time-unit and unit labels such as `10s`, `ms`, `px`
- generated ICU catalogs and generated market message packs
- broad backend runtime code outside email/template surfaces

The remaining candidates are real user-visible surfaces or need explicit product review.

## Migration Order

1. High-risk auth, trusted-device, OTP, desktop login, checkout, payment, order, support, status, and admin action text.
2. Medium-risk cart, wishlist, product, discovery/search/filter, delivery, profile/settings, notification, and seller inventory text.
3. Low-risk marketing headings, help text, empty states, dashboard labels, footer/nav copy, and generic informational content.
4. Accessibility-specific props and screen-reader text.
5. Validation, toast, snackbar, alert, confirm, and modal warning text.
6. Static shell, manifest, SEO, email, and notification template text where locale-aware architecture exists.

## Tests Required

- `npm --prefix app run i18n:check`
- `npm run scan:i18n-forbidden-endpoints`
- `npm run test:i18n`
- relevant focused app tests for migrated high/medium risk files
- `npm --prefix app run test:e2e:locale`
- `npm --prefix app run test:e2e:locale:a11y`
- `npm --prefix app test`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run i18n:legacy-report`
- `npm run i18n:discover-text`
- `npm run i18n:discover-text:check`
- `npm run env:validate`
- `npm run ci:doctor`

## Expected Key Count Increase

The maximum possible increase from the current scanner output is 1348 new ICU keys. The final increase should be lower because repeated copy, existing catalog text reuse, static metadata follow-ups, and documented dynamic exclusions should not create duplicate or fake keys.

## Review Queue

Every new high-risk or medium-risk non-English entry must be added to `app/src/i18n/quality/humanReviewQueue.json` when it uses an English fallback or non-native placeholder translation.
