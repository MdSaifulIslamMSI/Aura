# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3469
- Former raw review rows: 88414
- Actionable grouped queue entries: 3235
- Actionable affected locale-message pairs: 43753
- Native-review audit grouped entries: 2491
- Native-review audit affected locale-message pairs: 44661
- High-risk actionable entries: 1454 (22346 affected pairs)
- Medium-risk actionable entries: 657 (7987 affected pairs)
- Low-risk actionable entries: 1124 (13420 affected pairs)

## Actionable Queue By Locale

- `bn`: 1789 grouped entries / 1838 affected pairs
- `hi`: 2898 grouped entries / 3044 affected pairs
- `te`: 1856 grouped entries / 1908 affected pairs
- `mr`: 1862 grouped entries / 1914 affected pairs
- `ur`: 1844 grouped entries / 1895 affected pairs
- `gu`: 1890 grouped entries / 1947 affected pairs
- `pa`: 1878 grouped entries / 1934 affected pairs
- `ml`: 1859 grouped entries / 1910 affected pairs
- `kn`: 1855 grouped entries / 1907 affected pairs
- `or`: 1884 grouped entries / 1939 affected pairs
- `as`: 1843 grouped entries / 1895 affected pairs
- `sa`: 1861 grouped entries / 1914 affected pairs
- `es`: 2727 grouped entries / 2812 affected pairs
- `fr`: 2746 grouped entries / 2841 affected pairs
- `de`: 2721 grouped entries / 2811 affected pairs
- `ar`: 2642 grouped entries / 2732 affected pairs
- `ja`: 2758 grouped entries / 2853 affected pairs
- `pt`: 2733 grouped entries / 2817 affected pairs
- `zh`: 2749 grouped entries / 2842 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 54 grouped entries / 545 affected pairs
- `exact-english-fallback-needs-human-review`: 1628 grouped entries / 14859 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1421 grouped entries / 27137 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2362 grouped entries / 2652 affected pairs
- `hi`: 1244 grouped entries / 1446 affected pairs
- `te`: 2460 grouped entries / 2786 affected pairs
- `mr`: 2453 grouped entries / 2780 affected pairs
- `ur`: 2351 grouped entries / 2639 affected pairs
- `gu`: 2424 grouped entries / 2747 affected pairs
- `pa`: 2436 grouped entries / 2760 affected pairs
- `ml`: 2454 grouped entries / 2784 affected pairs
- `kn`: 2462 grouped entries / 2787 affected pairs
- `or`: 2435 grouped entries / 2755 affected pairs
- `as`: 2478 grouped entries / 2799 affected pairs
- `sa`: 2462 grouped entries / 2780 affected pairs
- `es`: 1576 grouped entries / 1882 affected pairs
- `fr`: 1550 grouped entries / 1853 affected pairs
- `de`: 1577 grouped entries / 1883 affected pairs
- `ar`: 1599 grouped entries / 1758 affected pairs
- `ja`: 1637 grouped entries / 1841 affected pairs
- `pt`: 1560 grouped entries / 1877 affected pairs
- `zh`: 1648 grouped entries / 1852 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
