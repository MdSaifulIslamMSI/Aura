# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3683
- Former raw review rows: 92613
- Actionable grouped queue entries: 1733
- Actionable affected locale-message pairs: 28953
- Native-review audit grouped entries: 3044
- Native-review audit affected locale-message pairs: 63660
- High-risk actionable entries: 925 (16072 affected pairs)
- Medium-risk actionable entries: 308 (4771 affected pairs)
- Low-risk actionable entries: 500 (8110 affected pairs)

## Actionable Queue By Locale

- `bn`: 1430 grouped entries / 1467 affected pairs
- `hi`: 1378 grouped entries / 1413 affected pairs
- `te`: 1507 grouped entries / 1547 affected pairs
- `mr`: 1501 grouped entries / 1541 affected pairs
- `ur`: 1491 grouped entries / 1530 affected pairs
- `gu`: 1532 grouped entries / 1576 affected pairs
- `pa`: 1519 grouped entries / 1562 affected pairs
- `ml`: 1511 grouped entries / 1550 affected pairs
- `kn`: 1504 grouped entries / 1544 affected pairs
- `or`: 1542 grouped entries / 1586 affected pairs
- `as`: 1489 grouped entries / 1529 affected pairs
- `sa`: 1518 grouped entries / 1559 affected pairs
- `es`: 1495 grouped entries / 1535 affected pairs
- `fr`: 1505 grouped entries / 1554 affected pairs
- `de`: 1509 grouped entries / 1555 affected pairs
- `ar`: 1411 grouped entries / 1448 affected pairs
- `ja`: 1427 grouped entries / 1467 affected pairs
- `pt`: 1492 grouped entries / 1529 affected pairs
- `zh`: 1423 grouped entries / 1461 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 74 grouped entries / 749 affected pairs
- `exact-english-fallback-needs-human-review`: 138 grouped entries / 903 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 3 grouped entries / 4 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `invalid-legacy-icu-uses-english-fallback`: 1 grouped entries / 18 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 119 grouped entries / 718 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1375 grouped entries / 26225 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2902 grouped entries / 3244 affected pairs
- `hi`: 2955 grouped entries / 3298 affected pairs
- `te`: 2993 grouped entries / 3368 affected pairs
- `mr`: 2996 grouped entries / 3374 affected pairs
- `ur`: 2886 grouped entries / 3225 affected pairs
- `gu`: 2965 grouped entries / 3339 affected pairs
- `pa`: 2978 grouped entries / 3353 affected pairs
- `ml`: 2983 grouped entries / 3365 affected pairs
- `kn`: 2997 grouped entries / 3371 affected pairs
- `or`: 2960 grouped entries / 3329 affected pairs
- `as`: 3016 grouped entries / 3386 affected pairs
- `sa`: 2990 grouped entries / 3356 affected pairs
- `es`: 3000 grouped entries / 3380 affected pairs
- `fr`: 2986 grouped entries / 3361 affected pairs
- `de`: 2975 grouped entries / 3360 affected pairs
- `ar`: 3021 grouped entries / 3263 affected pairs
- `ja`: 3154 grouped entries / 3448 affected pairs
- `pt`: 2990 grouped entries / 3386 affected pairs
- `zh`: 3160 grouped entries / 3454 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
