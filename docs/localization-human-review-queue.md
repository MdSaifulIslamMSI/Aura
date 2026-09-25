# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3730
- Former raw review rows: 93544
- Actionable grouped queue entries: 1758
- Actionable affected locale-message pairs: 29466
- Native-review audit grouped entries: 3063
- Native-review audit affected locale-message pairs: 64078
- High-risk actionable entries: 947 (16528 affected pairs)
- Medium-risk actionable entries: 308 (4771 affected pairs)
- Low-risk actionable entries: 503 (8167 affected pairs)

## Actionable Queue By Locale

- `bn`: 1456 grouped entries / 1494 affected pairs
- `hi`: 1404 grouped entries / 1440 affected pairs
- `te`: 1533 grouped entries / 1574 affected pairs
- `mr`: 1527 grouped entries / 1568 affected pairs
- `ur`: 1517 grouped entries / 1557 affected pairs
- `gu`: 1558 grouped entries / 1603 affected pairs
- `pa`: 1545 grouped entries / 1589 affected pairs
- `ml`: 1537 grouped entries / 1577 affected pairs
- `kn`: 1530 grouped entries / 1571 affected pairs
- `or`: 1568 grouped entries / 1613 affected pairs
- `as`: 1515 grouped entries / 1556 affected pairs
- `sa`: 1544 grouped entries / 1586 affected pairs
- `es`: 1520 grouped entries / 1562 affected pairs
- `fr`: 1530 grouped entries / 1581 affected pairs
- `de`: 1535 grouped entries / 1582 affected pairs
- `ar`: 1437 grouped entries / 1475 affected pairs
- `ja`: 1453 grouped entries / 1494 affected pairs
- `pt`: 1517 grouped entries / 1556 affected pairs
- `zh`: 1449 grouped entries / 1488 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 74 grouped entries / 749 affected pairs
- `exact-english-fallback-needs-human-review`: 163 grouped entries / 1416 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 3 grouped entries / 4 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `invalid-legacy-icu-uses-english-fallback`: 1 grouped entries / 18 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 119 grouped entries / 718 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1375 grouped entries / 26225 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2922 grouped entries / 3266 affected pairs
- `hi`: 2976 grouped entries / 3320 affected pairs
- `te`: 3015 grouped entries / 3390 affected pairs
- `mr`: 3018 grouped entries / 3396 affected pairs
- `ur`: 2908 grouped entries / 3247 affected pairs
- `gu`: 2987 grouped entries / 3361 affected pairs
- `pa`: 2999 grouped entries / 3375 affected pairs
- `ml`: 3004 grouped entries / 3387 affected pairs
- `kn`: 3019 grouped entries / 3393 affected pairs
- `or`: 2981 grouped entries / 3351 affected pairs
- `as`: 3036 grouped entries / 3408 affected pairs
- `sa`: 3013 grouped entries / 3378 affected pairs
- `es`: 3020 grouped entries / 3402 affected pairs
- `fr`: 3007 grouped entries / 3383 affected pairs
- `de`: 2996 grouped entries / 3382 affected pairs
- `ar`: 3044 grouped entries / 3285 affected pairs
- `ja`: 3177 grouped entries / 3470 affected pairs
- `pt`: 3011 grouped entries / 3408 affected pairs
- `zh`: 3182 grouped entries / 3476 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
