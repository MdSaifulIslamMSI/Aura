# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3737
- Former raw review rows: 93829
- Actionable grouped queue entries: 1763
- Actionable affected locale-message pairs: 29586
- Native-review audit grouped entries: 3069
- Native-review audit affected locale-message pairs: 64243
- High-risk actionable entries: 948 (16553 affected pairs)
- Medium-risk actionable entries: 308 (4771 affected pairs)
- Low-risk actionable entries: 507 (8262 affected pairs)

## Actionable Queue By Locale

- `bn`: 1461 grouped entries / 1500 affected pairs
- `hi`: 1410 grouped entries / 1447 affected pairs
- `te`: 1538 grouped entries / 1580 affected pairs
- `mr`: 1532 grouped entries / 1574 affected pairs
- `ur`: 1522 grouped entries / 1563 affected pairs
- `gu`: 1563 grouped entries / 1609 affected pairs
- `pa`: 1550 grouped entries / 1595 affected pairs
- `ml`: 1542 grouped entries / 1583 affected pairs
- `kn`: 1535 grouped entries / 1577 affected pairs
- `or`: 1573 grouped entries / 1619 affected pairs
- `as`: 1520 grouped entries / 1562 affected pairs
- `sa`: 1549 grouped entries / 1592 affected pairs
- `es`: 1525 grouped entries / 1568 affected pairs
- `fr`: 1536 grouped entries / 1588 affected pairs
- `de`: 1541 grouped entries / 1589 affected pairs
- `ar`: 1442 grouped entries / 1481 affected pairs
- `ja`: 1459 grouped entries / 1501 affected pairs
- `pt`: 1523 grouped entries / 1563 affected pairs
- `zh`: 1455 grouped entries / 1495 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 73 grouped entries / 733 affected pairs
- `exact-english-fallback-needs-human-review`: 162 grouped entries / 1400 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 3 grouped entries / 4 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `invalid-legacy-icu-uses-english-fallback`: 1 grouped entries / 18 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 119 grouped entries / 718 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1382 grouped entries / 26377 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2931 grouped entries / 3275 affected pairs
- `hi`: 2984 grouped entries / 3328 affected pairs
- `te`: 3024 grouped entries / 3399 affected pairs
- `mr`: 3027 grouped entries / 3405 affected pairs
- `ur`: 2917 grouped entries / 3256 affected pairs
- `gu`: 2996 grouped entries / 3370 affected pairs
- `pa`: 3008 grouped entries / 3384 affected pairs
- `ml`: 3013 grouped entries / 3396 affected pairs
- `kn`: 3028 grouped entries / 3402 affected pairs
- `or`: 2990 grouped entries / 3360 affected pairs
- `as`: 3045 grouped entries / 3417 affected pairs
- `sa`: 3022 grouped entries / 3387 affected pairs
- `es`: 3028 grouped entries / 3411 affected pairs
- `fr`: 3015 grouped entries / 3391 affected pairs
- `de`: 3004 grouped entries / 3390 affected pairs
- `ar`: 3053 grouped entries / 3294 affected pairs
- `ja`: 3185 grouped entries / 3478 affected pairs
- `pt`: 3018 grouped entries / 3416 affected pairs
- `zh`: 3190 grouped entries / 3484 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
