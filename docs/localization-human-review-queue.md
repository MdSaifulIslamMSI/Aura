# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3688
- Former raw review rows: 92708
- Actionable grouped queue entries: 1739
- Actionable affected locale-message pairs: 29067
- Native-review audit grouped entries: 3043
- Native-review audit affected locale-message pairs: 63641
- High-risk actionable entries: 926 (16091 affected pairs)
- Medium-risk actionable entries: 308 (4771 affected pairs)
- Low-risk actionable entries: 505 (8205 affected pairs)

## Actionable Queue By Locale

- `bn`: 1436 grouped entries / 1473 affected pairs
- `hi`: 1384 grouped entries / 1419 affected pairs
- `te`: 1513 grouped entries / 1553 affected pairs
- `mr`: 1507 grouped entries / 1547 affected pairs
- `ur`: 1497 grouped entries / 1536 affected pairs
- `gu`: 1538 grouped entries / 1582 affected pairs
- `pa`: 1525 grouped entries / 1568 affected pairs
- `ml`: 1517 grouped entries / 1556 affected pairs
- `kn`: 1510 grouped entries / 1550 affected pairs
- `or`: 1548 grouped entries / 1592 affected pairs
- `as`: 1495 grouped entries / 1535 affected pairs
- `sa`: 1524 grouped entries / 1565 affected pairs
- `es`: 1501 grouped entries / 1541 affected pairs
- `fr`: 1511 grouped entries / 1560 affected pairs
- `de`: 1515 grouped entries / 1561 affected pairs
- `ar`: 1417 grouped entries / 1454 affected pairs
- `ja`: 1433 grouped entries / 1473 affected pairs
- `pt`: 1498 grouped entries / 1535 affected pairs
- `zh`: 1429 grouped entries / 1467 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 74 grouped entries / 749 affected pairs
- `exact-english-fallback-needs-human-review`: 144 grouped entries / 1017 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 3 grouped entries / 4 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `invalid-legacy-icu-uses-english-fallback`: 1 grouped entries / 18 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 119 grouped entries / 718 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1375 grouped entries / 26225 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2901 grouped entries / 3243 affected pairs
- `hi`: 2954 grouped entries / 3297 affected pairs
- `te`: 2992 grouped entries / 3367 affected pairs
- `mr`: 2995 grouped entries / 3373 affected pairs
- `ur`: 2885 grouped entries / 3224 affected pairs
- `gu`: 2964 grouped entries / 3338 affected pairs
- `pa`: 2977 grouped entries / 3352 affected pairs
- `ml`: 2982 grouped entries / 3364 affected pairs
- `kn`: 2996 grouped entries / 3370 affected pairs
- `or`: 2959 grouped entries / 3328 affected pairs
- `as`: 3015 grouped entries / 3385 affected pairs
- `sa`: 2989 grouped entries / 3355 affected pairs
- `es`: 2999 grouped entries / 3379 affected pairs
- `fr`: 2985 grouped entries / 3360 affected pairs
- `de`: 2974 grouped entries / 3359 affected pairs
- `ar`: 3020 grouped entries / 3262 affected pairs
- `ja`: 3153 grouped entries / 3447 affected pairs
- `pt`: 2989 grouped entries / 3385 affected pairs
- `zh`: 3159 grouped entries / 3453 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
