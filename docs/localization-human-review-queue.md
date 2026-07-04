# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3312
- Former raw review rows: 84956
- Actionable grouped queue entries: 3051
- Actionable affected locale-message pairs: 39651
- Native-review audit grouped entries: 2496
- Native-review audit affected locale-message pairs: 45305
- High-risk actionable entries: 1334 (19454 affected pairs)
- Medium-risk actionable entries: 649 (7823 affected pairs)
- Low-risk actionable entries: 1068 (12374 affected pairs)

## Actionable Queue By Locale

- `bn`: 1582 grouped entries / 1617 affected pairs
- `hi`: 2711 grouped entries / 2835 affected pairs
- `te`: 1649 grouped entries / 1687 affected pairs
- `mr`: 1655 grouped entries / 1693 affected pairs
- `ur`: 1638 grouped entries / 1675 affected pairs
- `gu`: 1683 grouped entries / 1726 affected pairs
- `pa`: 1671 grouped entries / 1713 affected pairs
- `ml`: 1652 grouped entries / 1689 affected pairs
- `kn`: 1648 grouped entries / 1686 affected pairs
- `or`: 1678 grouped entries / 1719 affected pairs
- `as`: 1634 grouped entries / 1673 affected pairs
- `sa`: 1652 grouped entries / 1692 affected pairs
- `es`: 2524 grouped entries / 2596 affected pairs
- `fr`: 2570 grouped entries / 2651 affected pairs
- `de`: 2546 grouped entries / 2621 affected pairs
- `ar`: 2442 grouped entries / 2515 affected pairs
- `ja`: 2559 grouped entries / 2636 affected pairs
- `pt`: 2531 grouped entries / 2602 affected pairs
- `zh`: 2549 grouped entries / 2625 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 55 grouped entries / 537 affected pairs
- `exact-english-fallback-needs-human-review`: 1465 grouped entries / 11274 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1399 grouped entries / 26628 affected pairs

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
