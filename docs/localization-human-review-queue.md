# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3730
- Former raw review rows: 93639
- Actionable grouped queue entries: 1762
- Actionable affected locale-message pairs: 29561
- Native-review audit grouped entries: 3063
- Native-review audit affected locale-message pairs: 64078
- High-risk actionable entries: 947 (16528 affected pairs)
- Medium-risk actionable entries: 308 (4771 affected pairs)
- Low-risk actionable entries: 507 (8262 affected pairs)

## Actionable Queue By Locale

- `bn`: 1460 grouped entries / 1499 affected pairs
- `hi`: 1408 grouped entries / 1445 affected pairs
- `te`: 1537 grouped entries / 1579 affected pairs
- `mr`: 1531 grouped entries / 1573 affected pairs
- `ur`: 1521 grouped entries / 1562 affected pairs
- `gu`: 1562 grouped entries / 1608 affected pairs
- `pa`: 1549 grouped entries / 1594 affected pairs
- `ml`: 1541 grouped entries / 1582 affected pairs
- `kn`: 1534 grouped entries / 1576 affected pairs
- `or`: 1572 grouped entries / 1618 affected pairs
- `as`: 1519 grouped entries / 1561 affected pairs
- `sa`: 1548 grouped entries / 1591 affected pairs
- `es`: 1524 grouped entries / 1567 affected pairs
- `fr`: 1534 grouped entries / 1586 affected pairs
- `de`: 1539 grouped entries / 1587 affected pairs
- `ar`: 1441 grouped entries / 1480 affected pairs
- `ja`: 1457 grouped entries / 1499 affected pairs
- `pt`: 1521 grouped entries / 1561 affected pairs
- `zh`: 1453 grouped entries / 1493 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 74 grouped entries / 749 affected pairs
- `exact-english-fallback-needs-human-review`: 163 grouped entries / 1416 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 3 grouped entries / 4 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `invalid-legacy-icu-uses-english-fallback`: 1 grouped entries / 18 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 119 grouped entries / 718 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1379 grouped entries / 26320 affected pairs

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
