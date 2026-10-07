# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3731
- Former raw review rows: 93715
- Actionable grouped queue entries: 1765
- Actionable affected locale-message pairs: 29618
- Native-review audit grouped entries: 3064
- Native-review audit affected locale-message pairs: 64097
- High-risk actionable entries: 950 (16585 affected pairs)
- Medium-risk actionable entries: 308 (4771 affected pairs)
- Low-risk actionable entries: 507 (8262 affected pairs)

## Actionable Queue By Locale

- `bn`: 1463 grouped entries / 1502 affected pairs
- `hi`: 1411 grouped entries / 1448 affected pairs
- `te`: 1540 grouped entries / 1582 affected pairs
- `mr`: 1534 grouped entries / 1576 affected pairs
- `ur`: 1524 grouped entries / 1565 affected pairs
- `gu`: 1565 grouped entries / 1611 affected pairs
- `pa`: 1552 grouped entries / 1597 affected pairs
- `ml`: 1544 grouped entries / 1585 affected pairs
- `kn`: 1537 grouped entries / 1579 affected pairs
- `or`: 1575 grouped entries / 1621 affected pairs
- `as`: 1522 grouped entries / 1564 affected pairs
- `sa`: 1551 grouped entries / 1594 affected pairs
- `es`: 1527 grouped entries / 1570 affected pairs
- `fr`: 1537 grouped entries / 1589 affected pairs
- `de`: 1542 grouped entries / 1590 affected pairs
- `ar`: 1444 grouped entries / 1483 affected pairs
- `ja`: 1460 grouped entries / 1502 affected pairs
- `pt`: 1524 grouped entries / 1564 affected pairs
- `zh`: 1456 grouped entries / 1496 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 74 grouped entries / 749 affected pairs
- `exact-english-fallback-needs-human-review`: 163 grouped entries / 1416 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 3 grouped entries / 4 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `invalid-legacy-icu-uses-english-fallback`: 1 grouped entries / 18 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 119 grouped entries / 718 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1382 grouped entries / 26377 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2923 grouped entries / 3267 affected pairs
- `hi`: 2977 grouped entries / 3321 affected pairs
- `te`: 3016 grouped entries / 3391 affected pairs
- `mr`: 3019 grouped entries / 3397 affected pairs
- `ur`: 2909 grouped entries / 3248 affected pairs
- `gu`: 2988 grouped entries / 3362 affected pairs
- `pa`: 3000 grouped entries / 3376 affected pairs
- `ml`: 3005 grouped entries / 3388 affected pairs
- `kn`: 3020 grouped entries / 3394 affected pairs
- `or`: 2982 grouped entries / 3352 affected pairs
- `as`: 3037 grouped entries / 3409 affected pairs
- `sa`: 3014 grouped entries / 3379 affected pairs
- `es`: 3021 grouped entries / 3403 affected pairs
- `fr`: 3008 grouped entries / 3384 affected pairs
- `de`: 2997 grouped entries / 3383 affected pairs
- `ar`: 3045 grouped entries / 3286 affected pairs
- `ja`: 3178 grouped entries / 3471 affected pairs
- `pt`: 3012 grouped entries / 3409 affected pairs
- `zh`: 3183 grouped entries / 3477 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
