# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3692
- Former raw review rows: 92784
- Actionable grouped queue entries: 1743
- Actionable affected locale-message pairs: 29143
- Native-review audit grouped entries: 3043
- Native-review audit affected locale-message pairs: 63641
- High-risk actionable entries: 927 (16110 affected pairs)
- Medium-risk actionable entries: 311 (4828 affected pairs)
- Low-risk actionable entries: 505 (8205 affected pairs)

## Actionable Queue By Locale

- `bn`: 1440 grouped entries / 1477 affected pairs
- `hi`: 1388 grouped entries / 1423 affected pairs
- `te`: 1517 grouped entries / 1557 affected pairs
- `mr`: 1511 grouped entries / 1551 affected pairs
- `ur`: 1501 grouped entries / 1540 affected pairs
- `gu`: 1542 grouped entries / 1586 affected pairs
- `pa`: 1529 grouped entries / 1572 affected pairs
- `ml`: 1521 grouped entries / 1560 affected pairs
- `kn`: 1514 grouped entries / 1554 affected pairs
- `or`: 1552 grouped entries / 1596 affected pairs
- `as`: 1499 grouped entries / 1539 affected pairs
- `sa`: 1528 grouped entries / 1569 affected pairs
- `es`: 1505 grouped entries / 1545 affected pairs
- `fr`: 1515 grouped entries / 1564 affected pairs
- `de`: 1519 grouped entries / 1565 affected pairs
- `ar`: 1421 grouped entries / 1458 affected pairs
- `ja`: 1437 grouped entries / 1477 affected pairs
- `pt`: 1502 grouped entries / 1539 affected pairs
- `zh`: 1433 grouped entries / 1471 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 74 grouped entries / 749 affected pairs
- `exact-english-fallback-needs-human-review`: 144 grouped entries / 1017 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 3 grouped entries / 4 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `invalid-legacy-icu-uses-english-fallback`: 1 grouped entries / 18 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 119 grouped entries / 718 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1379 grouped entries / 26301 affected pairs

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
