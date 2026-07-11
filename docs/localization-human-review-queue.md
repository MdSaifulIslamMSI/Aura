# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3318
- Former raw review rows: 85146
- Actionable grouped queue entries: 3057
- Actionable affected locale-message pairs: 39844
- Native-review audit grouped entries: 2494
- Native-review audit affected locale-message pairs: 45302
- High-risk actionable entries: 1340 (19647 affected pairs)
- Medium-risk actionable entries: 649 (7823 affected pairs)
- Low-risk actionable entries: 1068 (12374 affected pairs)

## Actionable Queue By Locale

- `bn`: 1592 grouped entries / 1628 affected pairs
- `hi`: 2719 grouped entries / 2844 affected pairs
- `te`: 1659 grouped entries / 1698 affected pairs
- `mr`: 1665 grouped entries / 1704 affected pairs
- `ur`: 1647 grouped entries / 1685 affected pairs
- `gu`: 1693 grouped entries / 1737 affected pairs
- `pa`: 1681 grouped entries / 1724 affected pairs
- `ml`: 1662 grouped entries / 1700 affected pairs
- `kn`: 1658 grouped entries / 1697 affected pairs
- `or`: 1687 grouped entries / 1729 affected pairs
- `as`: 1645 grouped entries / 1685 affected pairs
- `sa`: 1663 grouped entries / 1704 affected pairs
- `es`: 2532 grouped entries / 2605 affected pairs
- `fr`: 2578 grouped entries / 2660 affected pairs
- `de`: 2554 grouped entries / 2630 affected pairs
- `ar`: 2450 grouped entries / 2524 affected pairs
- `ja`: 2567 grouped entries / 2645 affected pairs
- `pt`: 2539 grouped entries / 2611 affected pairs
- `zh`: 2557 grouped entries / 2634 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 53 grouped entries / 526 affected pairs
- `exact-english-fallback-needs-human-review`: 1466 grouped entries / 11345 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1406 grouped entries / 26761 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2389 grouped entries / 2690 affected pairs
- `hi`: 1262 grouped entries / 1474 affected pairs
- `te`: 2487 grouped entries / 2824 affected pairs
- `mr`: 2480 grouped entries / 2818 affected pairs
- `ur`: 2378 grouped entries / 2677 affected pairs
- `gu`: 2451 grouped entries / 2785 affected pairs
- `pa`: 2463 grouped entries / 2798 affected pairs
- `ml`: 2481 grouped entries / 2822 affected pairs
- `kn`: 2489 grouped entries / 2825 affected pairs
- `or`: 2462 grouped entries / 2793 affected pairs
- `as`: 2505 grouped entries / 2837 affected pairs
- `sa`: 2489 grouped entries / 2818 affected pairs
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
