# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3274
- Former raw review rows: 82529
- Actionable grouped queue entries: 2930
- Actionable affected locale-message pairs: 37384
- Native-review audit grouped entries: 2488
- Native-review audit affected locale-message pairs: 45145
- High-risk actionable entries: 1230 (17521 affected pairs)
- Medium-risk actionable entries: 649 (7823 affected pairs)
- Low-risk actionable entries: 1051 (12040 affected pairs)

## Actionable Queue By Locale

- `bn`: 1501 grouped entries / 1535 affected pairs
- `hi`: 2635 grouped entries / 2758 affected pairs
- `te`: 1523 grouped entries / 1558 affected pairs
- `mr`: 1529 grouped entries / 1564 affected pairs
- `ur`: 1514 grouped entries / 1549 affected pairs
- `gu`: 1557 grouped entries / 1597 affected pairs
- `pa`: 1545 grouped entries / 1584 affected pairs
- `ml`: 1526 grouped entries / 1560 affected pairs
- `kn`: 1522 grouped entries / 1557 affected pairs
- `or`: 1552 grouped entries / 1590 affected pairs
- `as`: 1508 grouped entries / 1544 affected pairs
- `sa`: 1526 grouped entries / 1563 affected pairs
- `es`: 2403 grouped entries / 2472 affected pairs
- `fr`: 2449 grouped entries / 2527 affected pairs
- `de`: 2425 grouped entries / 2497 affected pairs
- `ar`: 2366 grouped entries / 2438 affected pairs
- `ja`: 2438 grouped entries / 2512 affected pairs
- `pt`: 2410 grouped entries / 2478 affected pairs
- `zh`: 2428 grouped entries / 2501 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 55 grouped entries / 537 affected pairs
- `exact-english-fallback-needs-human-review`: 1438 grouped entries / 10706 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1305 grouped entries / 24929 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2390 grouped entries / 2691 affected pairs
- `hi`: 1256 grouped entries / 1468 affected pairs
- `te`: 2480 grouped entries / 2817 affected pairs
- `mr`: 2473 grouped entries / 2811 affected pairs
- `ur`: 2378 grouped entries / 2677 affected pairs
- `gu`: 2444 grouped entries / 2778 affected pairs
- `pa`: 2456 grouped entries / 2791 affected pairs
- `ml`: 2474 grouped entries / 2815 affected pairs
- `kn`: 2482 grouped entries / 2818 affected pairs
- `or`: 2454 grouped entries / 2785 affected pairs
- `as`: 2499 grouped entries / 2831 affected pairs
- `sa`: 2483 grouped entries / 2812 affected pairs
- `es`: 1587 grouped entries / 1903 affected pairs
- `fr`: 1535 grouped entries / 1848 affected pairs
- `de`: 1562 grouped entries / 1878 affected pairs
- `ar`: 1619 grouped entries / 1788 affected pairs
- `ja`: 1649 grouped entries / 1863 affected pairs
- `pt`: 1570 grouped entries / 1897 affected pairs
- `zh`: 1660 grouped entries / 1874 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
