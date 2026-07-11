# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3322
- Former raw review rows: 85222
- Actionable grouped queue entries: 3062
- Actionable affected locale-message pairs: 39904
- Native-review audit grouped entries: 2496
- Native-review audit affected locale-message pairs: 45318
- High-risk actionable entries: 1345 (19707 affected pairs)
- Medium-risk actionable entries: 649 (7823 affected pairs)
- Low-risk actionable entries: 1068 (12374 affected pairs)

## Actionable Queue By Locale

- `bn`: 1595 grouped entries / 1631 affected pairs
- `hi`: 2723 grouped entries / 2848 affected pairs
- `te`: 1661 grouped entries / 1700 affected pairs
- `mr`: 1668 grouped entries / 1707 affected pairs
- `ur`: 1650 grouped entries / 1688 affected pairs
- `gu`: 1696 grouped entries / 1740 affected pairs
- `pa`: 1684 grouped entries / 1727 affected pairs
- `ml`: 1664 grouped entries / 1702 affected pairs
- `kn`: 1660 grouped entries / 1699 affected pairs
- `or`: 1690 grouped entries / 1732 affected pairs
- `as`: 1647 grouped entries / 1687 affected pairs
- `sa`: 1665 grouped entries / 1706 affected pairs
- `es`: 2536 grouped entries / 2609 affected pairs
- `fr`: 2582 grouped entries / 2664 affected pairs
- `de`: 2558 grouped entries / 2634 affected pairs
- `ar`: 2454 grouped entries / 2528 affected pairs
- `ja`: 2571 grouped entries / 2649 affected pairs
- `pt`: 2543 grouped entries / 2615 affected pairs
- `zh`: 2561 grouped entries / 2638 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 54 grouped entries / 532 affected pairs
- `exact-english-fallback-needs-human-review`: 1470 grouped entries / 11399 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1406 grouped entries / 26761 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2390 grouped entries / 2691 affected pairs
- `hi`: 1262 grouped entries / 1474 affected pairs
- `te`: 2489 grouped entries / 2826 affected pairs
- `mr`: 2481 grouped entries / 2819 affected pairs
- `ur`: 2379 grouped entries / 2678 affected pairs
- `gu`: 2452 grouped entries / 2786 affected pairs
- `pa`: 2464 grouped entries / 2799 affected pairs
- `ml`: 2483 grouped entries / 2824 affected pairs
- `kn`: 2491 grouped entries / 2827 affected pairs
- `or`: 2463 grouped entries / 2794 affected pairs
- `as`: 2507 grouped entries / 2839 affected pairs
- `sa`: 2491 grouped entries / 2820 affected pairs
- `es`: 1601 grouped entries / 1917 affected pairs
- `fr`: 1549 grouped entries / 1862 affected pairs
- `de`: 1576 grouped entries / 1892 affected pairs
- `ar`: 1625 grouped entries / 1794 affected pairs
- `ja`: 1663 grouped entries / 1877 affected pairs
- `pt`: 1584 grouped entries / 1911 affected pairs
- `zh`: 1674 grouped entries / 1888 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
