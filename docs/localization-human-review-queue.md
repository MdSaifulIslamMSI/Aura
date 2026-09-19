# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3718
- Former raw review rows: 93278
- Actionable grouped queue entries: 1755
- Actionable affected locale-message pairs: 29409
- Native-review audit grouped entries: 3053
- Native-review audit affected locale-message pairs: 63869
- High-risk actionable entries: 944 (16471 affected pairs)
- Medium-risk actionable entries: 308 (4771 affected pairs)
- Low-risk actionable entries: 503 (8167 affected pairs)

## Actionable Queue By Locale

- `bn`: 1453 grouped entries / 1491 affected pairs
- `hi`: 1401 grouped entries / 1437 affected pairs
- `te`: 1530 grouped entries / 1571 affected pairs
- `mr`: 1524 grouped entries / 1565 affected pairs
- `ur`: 1514 grouped entries / 1554 affected pairs
- `gu`: 1555 grouped entries / 1600 affected pairs
- `pa`: 1542 grouped entries / 1586 affected pairs
- `ml`: 1534 grouped entries / 1574 affected pairs
- `kn`: 1527 grouped entries / 1568 affected pairs
- `or`: 1565 grouped entries / 1610 affected pairs
- `as`: 1512 grouped entries / 1553 affected pairs
- `sa`: 1541 grouped entries / 1583 affected pairs
- `es`: 1517 grouped entries / 1559 affected pairs
- `fr`: 1527 grouped entries / 1578 affected pairs
- `de`: 1532 grouped entries / 1579 affected pairs
- `ar`: 1434 grouped entries / 1472 affected pairs
- `ja`: 1450 grouped entries / 1491 affected pairs
- `pt`: 1514 grouped entries / 1553 affected pairs
- `zh`: 1446 grouped entries / 1485 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 74 grouped entries / 749 affected pairs
- `exact-english-fallback-needs-human-review`: 162 grouped entries / 1397 affected pairs
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
