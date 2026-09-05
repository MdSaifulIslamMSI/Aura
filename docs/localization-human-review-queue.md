# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3684
- Former raw review rows: 92632
- Actionable grouped queue entries: 1733
- Actionable affected locale-message pairs: 28953
- Native-review audit grouped entries: 3045
- Native-review audit affected locale-message pairs: 63679
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

- `bn`: 2903 grouped entries / 3245 affected pairs
- `hi`: 2956 grouped entries / 3299 affected pairs
- `te`: 2994 grouped entries / 3369 affected pairs
- `mr`: 2997 grouped entries / 3375 affected pairs
- `ur`: 2887 grouped entries / 3226 affected pairs
- `gu`: 2966 grouped entries / 3340 affected pairs
- `pa`: 2979 grouped entries / 3354 affected pairs
- `ml`: 2984 grouped entries / 3366 affected pairs
- `kn`: 2998 grouped entries / 3372 affected pairs
- `or`: 2961 grouped entries / 3330 affected pairs
- `as`: 3017 grouped entries / 3387 affected pairs
- `sa`: 2991 grouped entries / 3357 affected pairs
- `es`: 3001 grouped entries / 3381 affected pairs
- `fr`: 2987 grouped entries / 3362 affected pairs
- `de`: 2976 grouped entries / 3361 affected pairs
- `ar`: 3022 grouped entries / 3264 affected pairs
- `ja`: 3155 grouped entries / 3449 affected pairs
- `pt`: 2991 grouped entries / 3387 affected pairs
- `zh`: 3161 grouped entries / 3455 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
