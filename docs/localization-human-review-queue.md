# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3389
- Former raw review rows: 86894
- Actionable grouped queue entries: 3160
- Actionable affected locale-message pairs: 42214
- Native-review audit grouped entries: 2491
- Native-review audit affected locale-message pairs: 44680
- High-risk actionable entries: 1422 (21657 affected pairs)
- Medium-risk actionable entries: 658 (7990 affected pairs)
- Low-risk actionable entries: 1080 (12567 affected pairs)

## Actionable Queue By Locale

- `bn`: 1712 grouped entries / 1757 affected pairs
- `hi`: 2823 grouped entries / 2963 affected pairs
- `te`: 1779 grouped entries / 1827 affected pairs
- `mr`: 1785 grouped entries / 1833 affected pairs
- `ur`: 1767 grouped entries / 1814 affected pairs
- `gu`: 1813 grouped entries / 1866 affected pairs
- `pa`: 1801 grouped entries / 1853 affected pairs
- `ml`: 1782 grouped entries / 1829 affected pairs
- `kn`: 1778 grouped entries / 1826 affected pairs
- `or`: 1807 grouped entries / 1858 affected pairs
- `as`: 1766 grouped entries / 1814 affected pairs
- `sa`: 1784 grouped entries / 1833 affected pairs
- `es`: 2650 grouped entries / 2731 affected pairs
- `fr`: 2670 grouped entries / 2760 affected pairs
- `de`: 2644 grouped entries / 2730 affected pairs
- `ar`: 2565 grouped entries / 2651 affected pairs
- `ja`: 2682 grouped entries / 2772 affected pairs
- `pt`: 2656 grouped entries / 2736 affected pairs
- `zh`: 2673 grouped entries / 2761 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 54 grouped entries / 545 affected pairs
- `exact-english-fallback-needs-human-review`: 1598 grouped entries / 14232 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1376 grouped entries / 26225 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2363 grouped entries / 2653 affected pairs
- `hi`: 1244 grouped entries / 1447 affected pairs
- `te`: 2461 grouped entries / 2787 affected pairs
- `mr`: 2454 grouped entries / 2781 affected pairs
- `ur`: 2352 grouped entries / 2640 affected pairs
- `gu`: 2425 grouped entries / 2748 affected pairs
- `pa`: 2437 grouped entries / 2761 affected pairs
- `ml`: 2455 grouped entries / 2785 affected pairs
- `kn`: 2463 grouped entries / 2788 affected pairs
- `or`: 2436 grouped entries / 2756 affected pairs
- `as`: 2479 grouped entries / 2800 affected pairs
- `sa`: 2463 grouped entries / 2781 affected pairs
- `es`: 1577 grouped entries / 1883 affected pairs
- `fr`: 1551 grouped entries / 1854 affected pairs
- `de`: 1578 grouped entries / 1884 affected pairs
- `ar`: 1600 grouped entries / 1759 affected pairs
- `ja`: 1638 grouped entries / 1842 affected pairs
- `pt`: 1561 grouped entries / 1878 affected pairs
- `zh`: 1649 grouped entries / 1853 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
