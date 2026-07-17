# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3324
- Former raw review rows: 85374
- Actionable grouped queue entries: 3071
- Actionable affected locale-message pairs: 40075
- Native-review audit grouped entries: 2518
- Native-review audit affected locale-message pairs: 45299
- High-risk actionable entries: 1338 (19624 affected pairs)
- Medium-risk actionable entries: 659 (7991 affected pairs)
- Low-risk actionable entries: 1074 (12460 affected pairs)

## Actionable Queue By Locale

- `bn`: 1607 grouped entries / 1643 affected pairs
- `hi`: 2734 grouped entries / 2859 affected pairs
- `te`: 1674 grouped entries / 1713 affected pairs
- `mr`: 1680 grouped entries / 1719 affected pairs
- `ur`: 1662 grouped entries / 1700 affected pairs
- `gu`: 1708 grouped entries / 1752 affected pairs
- `pa`: 1696 grouped entries / 1739 affected pairs
- `ml`: 1677 grouped entries / 1715 affected pairs
- `kn`: 1673 grouped entries / 1712 affected pairs
- `or`: 1702 grouped entries / 1744 affected pairs
- `as`: 1660 grouped entries / 1700 affected pairs
- `sa`: 1678 grouped entries / 1719 affected pairs
- `es`: 2547 grouped entries / 2619 affected pairs
- `fr`: 2568 grouped entries / 2649 affected pairs
- `de`: 2543 grouped entries / 2619 affected pairs
- `ar`: 2465 grouped entries / 2539 affected pairs
- `ja`: 2582 grouped entries / 2660 affected pairs
- `pt`: 2554 grouped entries / 2625 affected pairs
- `zh`: 2572 grouped entries / 2649 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 53 grouped entries / 526 affected pairs
- `exact-english-fallback-needs-human-review`: 1477 grouped entries / 11529 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1409 grouped entries / 26808 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2388 grouped entries / 2687 affected pairs
- `hi`: 1261 grouped entries / 1471 affected pairs
- `te`: 2486 grouped entries / 2821 affected pairs
- `mr`: 2479 grouped entries / 2815 affected pairs
- `ur`: 2377 grouped entries / 2674 affected pairs
- `gu`: 2450 grouped entries / 2782 affected pairs
- `pa`: 2462 grouped entries / 2795 affected pairs
- `ml`: 2480 grouped entries / 2819 affected pairs
- `kn`: 2488 grouped entries / 2822 affected pairs
- `or`: 2461 grouped entries / 2790 affected pairs
- `as`: 2504 grouped entries / 2834 affected pairs
- `sa`: 2488 grouped entries / 2815 affected pairs
- `es`: 1599 grouped entries / 1915 affected pairs
- `fr`: 1572 grouped entries / 1885 affected pairs
- `de`: 1600 grouped entries / 1915 affected pairs
- `ar`: 1624 grouped entries / 1791 affected pairs
- `ja`: 1662 grouped entries / 1874 affected pairs
- `pt`: 1582 grouped entries / 1909 affected pairs
- `zh`: 1673 grouped entries / 1885 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
