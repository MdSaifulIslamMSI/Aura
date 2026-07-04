# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3312
- Former raw review rows: 84975
- Actionable grouped queue entries: 3052
- Actionable affected locale-message pairs: 39670
- Native-review audit grouped entries: 2496
- Native-review audit affected locale-message pairs: 45305
- High-risk actionable entries: 1335 (19473 affected pairs)
- Medium-risk actionable entries: 649 (7823 affected pairs)
- Low-risk actionable entries: 1068 (12374 affected pairs)

## Actionable Queue By Locale

- `bn`: 1583 grouped entries / 1618 affected pairs
- `hi`: 2712 grouped entries / 2836 affected pairs
- `te`: 1650 grouped entries / 1688 affected pairs
- `mr`: 1656 grouped entries / 1694 affected pairs
- `ur`: 1639 grouped entries / 1676 affected pairs
- `gu`: 1684 grouped entries / 1727 affected pairs
- `pa`: 1672 grouped entries / 1714 affected pairs
- `ml`: 1653 grouped entries / 1690 affected pairs
- `kn`: 1649 grouped entries / 1687 affected pairs
- `or`: 1679 grouped entries / 1720 affected pairs
- `as`: 1635 grouped entries / 1674 affected pairs
- `sa`: 1653 grouped entries / 1693 affected pairs
- `es`: 2525 grouped entries / 2597 affected pairs
- `fr`: 2571 grouped entries / 2652 affected pairs
- `de`: 2547 grouped entries / 2622 affected pairs
- `ar`: 2443 grouped entries / 2516 affected pairs
- `ja`: 2560 grouped entries / 2637 affected pairs
- `pt`: 2532 grouped entries / 2603 affected pairs
- `zh`: 2550 grouped entries / 2626 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 55 grouped entries / 537 affected pairs
- `exact-english-fallback-needs-human-review`: 1465 grouped entries / 11274 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1400 grouped entries / 26647 affected pairs

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
