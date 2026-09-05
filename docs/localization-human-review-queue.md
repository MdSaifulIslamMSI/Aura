# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3684
- Former raw review rows: 92632
- Actionable grouped queue entries: 1734
- Actionable affected locale-message pairs: 28972
- Native-review audit grouped entries: 3044
- Native-review audit affected locale-message pairs: 63660
- High-risk actionable entries: 926 (16091 affected pairs)
- Medium-risk actionable entries: 308 (4771 affected pairs)
- Low-risk actionable entries: 500 (8110 affected pairs)

## Actionable Queue By Locale

- `bn`: 1431 grouped entries / 1468 affected pairs
- `hi`: 1379 grouped entries / 1414 affected pairs
- `te`: 1508 grouped entries / 1548 affected pairs
- `mr`: 1502 grouped entries / 1542 affected pairs
- `ur`: 1492 grouped entries / 1531 affected pairs
- `gu`: 1533 grouped entries / 1577 affected pairs
- `pa`: 1520 grouped entries / 1563 affected pairs
- `ml`: 1512 grouped entries / 1551 affected pairs
- `kn`: 1505 grouped entries / 1545 affected pairs
- `or`: 1543 grouped entries / 1587 affected pairs
- `as`: 1490 grouped entries / 1530 affected pairs
- `sa`: 1519 grouped entries / 1560 affected pairs
- `es`: 1496 grouped entries / 1536 affected pairs
- `fr`: 1506 grouped entries / 1555 affected pairs
- `de`: 1510 grouped entries / 1556 affected pairs
- `ar`: 1412 grouped entries / 1449 affected pairs
- `ja`: 1428 grouped entries / 1468 affected pairs
- `pt`: 1493 grouped entries / 1530 affected pairs
- `zh`: 1424 grouped entries / 1462 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 74 grouped entries / 749 affected pairs
- `exact-english-fallback-needs-human-review`: 139 grouped entries / 922 affected pairs
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
