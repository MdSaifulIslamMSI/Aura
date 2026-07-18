# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3384
- Former raw review rows: 86856
- Actionable grouped queue entries: 3166
- Actionable affected locale-message pairs: 42157
- Native-review audit grouped entries: 2489
- Native-review audit affected locale-message pairs: 44699
- High-risk actionable entries: 1427 (21581 affected pairs)
- Medium-risk actionable entries: 658 (7990 affected pairs)
- Low-risk actionable entries: 1081 (12586 affected pairs)

## Actionable Queue By Locale

- `bn`: 1715 grouped entries / 1754 affected pairs
- `hi`: 2829 grouped entries / 2960 affected pairs
- `te`: 1782 grouped entries / 1824 affected pairs
- `mr`: 1788 grouped entries / 1830 affected pairs
- `ur`: 1770 grouped entries / 1811 affected pairs
- `gu`: 1816 grouped entries / 1863 affected pairs
- `pa`: 1804 grouped entries / 1850 affected pairs
- `ml`: 1785 grouped entries / 1826 affected pairs
- `kn`: 1781 grouped entries / 1823 affected pairs
- `or`: 1810 grouped entries / 1855 affected pairs
- `as`: 1768 grouped entries / 1811 affected pairs
- `sa`: 1786 grouped entries / 1830 affected pairs
- `es`: 2652 grouped entries / 2728 affected pairs
- `fr`: 2672 grouped entries / 2757 affected pairs
- `de`: 2647 grouped entries / 2727 affected pairs
- `ar`: 2569 grouped entries / 2648 affected pairs
- `ja`: 2686 grouped entries / 2769 affected pairs
- `pt`: 2658 grouped entries / 2733 affected pairs
- `zh`: 2676 grouped entries / 2758 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 53 grouped entries / 526 affected pairs
- `exact-english-fallback-needs-human-review`: 1554 grouped entries / 13269 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1427 grouped entries / 27150 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2360 grouped entries / 2654 affected pairs
- `hi`: 1242 grouped entries / 1448 affected pairs
- `te`: 2458 grouped entries / 2788 affected pairs
- `mr`: 2451 grouped entries / 2782 affected pairs
- `ur`: 2349 grouped entries / 2641 affected pairs
- `gu`: 2422 grouped entries / 2749 affected pairs
- `pa`: 2434 grouped entries / 2762 affected pairs
- `ml`: 2452 grouped entries / 2786 affected pairs
- `kn`: 2460 grouped entries / 2789 affected pairs
- `or`: 2433 grouped entries / 2757 affected pairs
- `as`: 2476 grouped entries / 2801 affected pairs
- `sa`: 2460 grouped entries / 2782 affected pairs
- `es`: 1573 grouped entries / 1884 affected pairs
- `fr`: 1547 grouped entries / 1855 affected pairs
- `de`: 1575 grouped entries / 1885 affected pairs
- `ar`: 1598 grouped entries / 1760 affected pairs
- `ja`: 1636 grouped entries / 1843 affected pairs
- `pt`: 1557 grouped entries / 1879 affected pairs
- `zh`: 1647 grouped entries / 1854 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
