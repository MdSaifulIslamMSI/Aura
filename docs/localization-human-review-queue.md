# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3316
- Former raw review rows: 85108
- Actionable grouped queue entries: 3058
- Actionable affected locale-message pairs: 39803
- Native-review audit grouped entries: 2496
- Native-review audit affected locale-message pairs: 45305
- High-risk actionable entries: 1341 (19606 affected pairs)
- Medium-risk actionable entries: 649 (7823 affected pairs)
- Low-risk actionable entries: 1068 (12374 affected pairs)

## Actionable Queue By Locale

- `bn`: 1589 grouped entries / 1625 affected pairs
- `hi`: 2718 grouped entries / 2843 affected pairs
- `te`: 1656 grouped entries / 1695 affected pairs
- `mr`: 1662 grouped entries / 1701 affected pairs
- `ur`: 1645 grouped entries / 1683 affected pairs
- `gu`: 1690 grouped entries / 1734 affected pairs
- `pa`: 1678 grouped entries / 1721 affected pairs
- `ml`: 1659 grouped entries / 1697 affected pairs
- `kn`: 1655 grouped entries / 1694 affected pairs
- `or`: 1685 grouped entries / 1727 affected pairs
- `as`: 1641 grouped entries / 1681 affected pairs
- `sa`: 1659 grouped entries / 1700 affected pairs
- `es`: 2531 grouped entries / 2604 affected pairs
- `fr`: 2577 grouped entries / 2659 affected pairs
- `de`: 2553 grouped entries / 2629 affected pairs
- `ar`: 2449 grouped entries / 2523 affected pairs
- `ja`: 2566 grouped entries / 2644 affected pairs
- `pt`: 2538 grouped entries / 2610 affected pairs
- `zh`: 2556 grouped entries / 2633 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 55 grouped entries / 537 affected pairs
- `exact-english-fallback-needs-human-review`: 1468 grouped entries / 11350 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1403 grouped entries / 26704 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2390 grouped entries / 2691 affected pairs
- `hi`: 1261 grouped entries / 1473 affected pairs
- `te`: 2488 grouped entries / 2825 affected pairs
- `mr`: 2481 grouped entries / 2819 affected pairs
- `ur`: 2378 grouped entries / 2677 affected pairs
- `gu`: 2452 grouped entries / 2786 affected pairs
- `pa`: 2464 grouped entries / 2799 affected pairs
- `ml`: 2482 grouped entries / 2823 affected pairs
- `kn`: 2490 grouped entries / 2826 affected pairs
- `or`: 2462 grouped entries / 2793 affected pairs
- `as`: 2507 grouped entries / 2839 affected pairs
- `sa`: 2491 grouped entries / 2820 affected pairs
- `es`: 1600 grouped entries / 1916 affected pairs
- `fr`: 1548 grouped entries / 1861 affected pairs
- `de`: 1575 grouped entries / 1891 affected pairs
- `ar`: 1624 grouped entries / 1793 affected pairs
- `ja`: 1662 grouped entries / 1876 affected pairs
- `pt`: 1583 grouped entries / 1910 affected pairs
- `zh`: 1673 grouped entries / 1887 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
