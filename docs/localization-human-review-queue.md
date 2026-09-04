# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3679
- Former raw review rows: 92537
- Actionable grouped queue entries: 3124
- Actionable affected locale-message pairs: 30592
- Native-review audit grouped entries: 3013
- Native-review audit affected locale-message pairs: 61945
- High-risk actionable entries: 1317 (16534 affected pairs)
- Medium-risk actionable entries: 585 (5099 affected pairs)
- Low-risk actionable entries: 1222 (8959 affected pairs)

## Actionable Queue By Locale

- `bn`: 1427 grouped entries / 1464 affected pairs
- `hi`: 1407 grouped entries / 1442 affected pairs
- `te`: 1504 grouped entries / 1544 affected pairs
- `mr`: 1498 grouped entries / 1538 affected pairs
- `ur`: 1488 grouped entries / 1527 affected pairs
- `gu`: 1529 grouped entries / 1573 affected pairs
- `pa`: 1516 grouped entries / 1559 affected pairs
- `ml`: 1508 grouped entries / 1547 affected pairs
- `kn`: 1501 grouped entries / 1541 affected pairs
- `or`: 1540 grouped entries / 1583 affected pairs
- `as`: 1486 grouped entries / 1526 affected pairs
- `sa`: 1514 grouped entries / 1556 affected pairs
- `es`: 1492 grouped entries / 1532 affected pairs
- `fr`: 1502 grouped entries / 1551 affected pairs
- `de`: 1506 grouped entries / 1552 affected pairs
- `ar`: 1408 grouped entries / 1445 affected pairs
- `ja`: 1483 grouped entries / 1523 affected pairs
- `pt`: 2973 grouped entries / 3073 affected pairs
- `zh`: 1478 grouped entries / 1516 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 51 grouped entries / 520 affected pairs
- `exact-english-fallback-needs-human-review`: 1575 grouped entries / 2810 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 102 grouped entries / 756 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1372 grouped entries / 26168 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2901 grouped entries / 3243 affected pairs
- `hi`: 2924 grouped entries / 3265 affected pairs
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
- `ja`: 3101 grouped entries / 3388 affected pairs
- `pt`: 1528 grouped entries / 1838 affected pairs
- `zh`: 3107 grouped entries / 3395 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
