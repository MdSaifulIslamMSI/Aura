# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3719
- Former raw review rows: 93297
- Actionable grouped queue entries: 1756
- Actionable affected locale-message pairs: 29428
- Native-review audit grouped entries: 3053
- Native-review audit affected locale-message pairs: 63869
- High-risk actionable entries: 944 (16471 affected pairs)
- Medium-risk actionable entries: 309 (4790 affected pairs)
- Low-risk actionable entries: 503 (8167 affected pairs)

## Actionable Queue By Locale

- `bn`: 1454 grouped entries / 1492 affected pairs
- `hi`: 1402 grouped entries / 1438 affected pairs
- `te`: 1531 grouped entries / 1572 affected pairs
- `mr`: 1525 grouped entries / 1566 affected pairs
- `ur`: 1515 grouped entries / 1555 affected pairs
- `gu`: 1556 grouped entries / 1601 affected pairs
- `pa`: 1543 grouped entries / 1587 affected pairs
- `ml`: 1535 grouped entries / 1575 affected pairs
- `kn`: 1528 grouped entries / 1569 affected pairs
- `or`: 1566 grouped entries / 1611 affected pairs
- `as`: 1513 grouped entries / 1554 affected pairs
- `sa`: 1542 grouped entries / 1584 affected pairs
- `es`: 1518 grouped entries / 1560 affected pairs
- `fr`: 1528 grouped entries / 1579 affected pairs
- `de`: 1533 grouped entries / 1580 affected pairs
- `ar`: 1435 grouped entries / 1473 affected pairs
- `ja`: 1451 grouped entries / 1492 affected pairs
- `pt`: 1515 grouped entries / 1554 affected pairs
- `zh`: 1447 grouped entries / 1486 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 74 grouped entries / 749 affected pairs
- `exact-english-fallback-needs-human-review`: 163 grouped entries / 1416 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 3 grouped entries / 4 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `invalid-legacy-icu-uses-english-fallback`: 1 grouped entries / 18 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 119 grouped entries / 718 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1373 grouped entries / 26187 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2912 grouped entries / 3255 affected pairs
- `hi`: 2966 grouped entries / 3309 affected pairs
- `te`: 3004 grouped entries / 3379 affected pairs
- `mr`: 3007 grouped entries / 3385 affected pairs
- `ur`: 2897 grouped entries / 3236 affected pairs
- `gu`: 2976 grouped entries / 3350 affected pairs
- `pa`: 2988 grouped entries / 3364 affected pairs
- `ml`: 2993 grouped entries / 3376 affected pairs
- `kn`: 3008 grouped entries / 3382 affected pairs
- `or`: 2971 grouped entries / 3340 affected pairs
- `as`: 3026 grouped entries / 3397 affected pairs
- `sa`: 3002 grouped entries / 3367 affected pairs
- `es`: 3009 grouped entries / 3391 affected pairs
- `fr`: 2996 grouped entries / 3372 affected pairs
- `de`: 2986 grouped entries / 3371 affected pairs
- `ar`: 3033 grouped entries / 3274 affected pairs
- `ja`: 3166 grouped entries / 3459 affected pairs
- `pt`: 3000 grouped entries / 3397 affected pairs
- `zh`: 3171 grouped entries / 3465 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
