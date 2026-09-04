# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3676
- Former raw review rows: 92480
- Actionable grouped queue entries: 1730
- Actionable affected locale-message pairs: 28897
- Native-review audit grouped entries: 3040
- Native-review audit affected locale-message pairs: 63583
- High-risk actionable entries: 922 (16015 affected pairs)
- Medium-risk actionable entries: 308 (4772 affected pairs)
- Low-risk actionable entries: 500 (8110 affected pairs)

## Actionable Queue By Locale

- `bn`: 1427 grouped entries / 1464 affected pairs
- `hi`: 1375 grouped entries / 1411 affected pairs
- `te`: 1504 grouped entries / 1544 affected pairs
- `mr`: 1498 grouped entries / 1538 affected pairs
- `ur`: 1488 grouped entries / 1527 affected pairs
- `gu`: 1529 grouped entries / 1573 affected pairs
- `pa`: 1516 grouped entries / 1559 affected pairs
- `ml`: 1508 grouped entries / 1547 affected pairs
- `kn`: 1501 grouped entries / 1541 affected pairs
- `or`: 1539 grouped entries / 1583 affected pairs
- `as`: 1486 grouped entries / 1526 affected pairs
- `sa`: 1515 grouped entries / 1556 affected pairs
- `es`: 1492 grouped entries / 1532 affected pairs
- `fr`: 1502 grouped entries / 1551 affected pairs
- `de`: 1506 grouped entries / 1552 affected pairs
- `ar`: 1408 grouped entries / 1445 affected pairs
- `ja`: 1424 grouped entries / 1464 affected pairs
- `pt`: 1489 grouped entries / 1526 affected pairs
- `zh`: 1420 grouped entries / 1458 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 74 grouped entries / 750 affected pairs
- `exact-english-fallback-needs-human-review`: 138 grouped entries / 903 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 3 grouped entries / 4 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `invalid-legacy-icu-uses-english-fallback`: 1 grouped entries / 18 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 119 grouped entries / 718 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1372 grouped entries / 26168 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2898 grouped entries / 3240 affected pairs
- `hi`: 2950 grouped entries / 3293 affected pairs
- `te`: 2989 grouped entries / 3364 affected pairs
- `mr`: 2992 grouped entries / 3370 affected pairs
- `ur`: 2882 grouped entries / 3221 affected pairs
- `gu`: 2961 grouped entries / 3335 affected pairs
- `pa`: 2974 grouped entries / 3349 affected pairs
- `ml`: 2979 grouped entries / 3361 affected pairs
- `kn`: 2993 grouped entries / 3367 affected pairs
- `or`: 2956 grouped entries / 3325 affected pairs
- `as`: 3012 grouped entries / 3382 affected pairs
- `sa`: 2986 grouped entries / 3352 affected pairs
- `es`: 2996 grouped entries / 3376 affected pairs
- `fr`: 2982 grouped entries / 3357 affected pairs
- `de`: 2971 grouped entries / 3356 affected pairs
- `ar`: 3017 grouped entries / 3259 affected pairs
- `ja`: 3150 grouped entries / 3444 affected pairs
- `pt`: 2986 grouped entries / 3382 affected pairs
- `zh`: 3156 grouped entries / 3450 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
