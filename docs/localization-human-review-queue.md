# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3367
- Former raw review rows: 86191
- Actionable grouped queue entries: 3110
- Actionable affected locale-message pairs: 40892
- Native-review audit grouped entries: 2518
- Native-review audit affected locale-message pairs: 45299
- High-risk actionable entries: 1372 (20328 affected pairs)
- Medium-risk actionable entries: 658 (7990 affected pairs)
- Low-risk actionable entries: 1080 (12574 affected pairs)

## Actionable Queue By Locale

- `bn`: 1649 grouped entries / 1686 affected pairs
- `hi`: 2773 grouped entries / 2902 affected pairs
- `te`: 1716 grouped entries / 1756 affected pairs
- `mr`: 1722 grouped entries / 1762 affected pairs
- `ur`: 1704 grouped entries / 1743 affected pairs
- `gu`: 1750 grouped entries / 1795 affected pairs
- `pa`: 1738 grouped entries / 1782 affected pairs
- `ml`: 1719 grouped entries / 1758 affected pairs
- `kn`: 1715 grouped entries / 1755 affected pairs
- `or`: 1744 grouped entries / 1787 affected pairs
- `as`: 1702 grouped entries / 1743 affected pairs
- `sa`: 1720 grouped entries / 1762 affected pairs
- `es`: 2589 grouped entries / 2662 affected pairs
- `fr`: 2610 grouped entries / 2692 affected pairs
- `de`: 2585 grouped entries / 2662 affected pairs
- `ar`: 2506 grouped entries / 2582 affected pairs
- `ja`: 2623 grouped entries / 2703 affected pairs
- `pt`: 2596 grouped entries / 2668 affected pairs
- `zh`: 2613 grouped entries / 2692 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 53 grouped entries / 526 affected pairs
- `exact-english-fallback-needs-human-review`: 1516 grouped entries / 12346 affected pairs
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
