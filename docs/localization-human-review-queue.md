# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3539
- Former raw review rows: 89744
- Actionable grouped queue entries: 3296
- Actionable affected locale-message pairs: 45647
- Native-review audit grouped entries: 2458
- Native-review audit affected locale-message pairs: 44097
- High-risk actionable entries: 1451 (22399 affected pairs)
- Medium-risk actionable entries: 657 (7987 affected pairs)
- Low-risk actionable entries: 1188 (15261 affected pairs)

## Actionable Queue By Locale

- `bn`: 1885 grouped entries / 1940 affected pairs
- `hi`: 2963 grouped entries / 3113 affected pairs
- `te`: 1952 grouped entries / 2010 affected pairs
- `mr`: 1958 grouped entries / 2016 affected pairs
- `ur`: 1939 grouped entries / 1996 affected pairs
- `gu`: 1985 grouped entries / 2047 affected pairs
- `pa`: 1973 grouped entries / 2034 affected pairs
- `ml`: 1955 grouped entries / 2012 affected pairs
- `kn`: 1950 grouped entries / 2008 affected pairs
- `or`: 1979 grouped entries / 2040 affected pairs
- `as`: 1939 grouped entries / 1997 affected pairs
- `sa`: 1957 grouped entries / 2016 affected pairs
- `es`: 2823 grouped entries / 2914 affected pairs
- `fr`: 2842 grouped entries / 2943 affected pairs
- `de`: 2817 grouped entries / 2911 affected pairs
- `ar`: 2737 grouped entries / 2834 affected pairs
- `ja`: 2853 grouped entries / 2955 affected pairs
- `pt`: 2829 grouped entries / 2917 affected pairs
- `zh`: 2844 grouped entries / 2944 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 51 grouped entries / 520 affected pairs
- `exact-english-fallback-needs-human-review`: 1716 grouped entries / 17256 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 106 grouped entries / 852 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1399 grouped entries / 26681 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2333 grouped entries / 2620 affected pairs
- `hi`: 1248 grouped entries / 1447 affected pairs
- `te`: 2431 grouped entries / 2754 affected pairs
- `mr`: 2424 grouped entries / 2748 affected pairs
- `ur`: 2322 grouped entries / 2608 affected pairs
- `gu`: 2396 grouped entries / 2717 affected pairs
- `pa`: 2407 grouped entries / 2730 affected pairs
- `ml`: 2425 grouped entries / 2752 affected pairs
- `kn`: 2434 grouped entries / 2756 affected pairs
- `or`: 2407 grouped entries / 2724 affected pairs
- `as`: 2449 grouped entries / 2767 affected pairs
- `sa`: 2433 grouped entries / 2748 affected pairs
- `es`: 1548 grouped entries / 1850 affected pairs
- `fr`: 1521 grouped entries / 1821 affected pairs
- `de`: 1549 grouped entries / 1853 affected pairs
- `ar`: 1571 grouped entries / 1726 affected pairs
- `ja`: 1609 grouped entries / 1809 affected pairs
- `pt`: 1533 grouped entries / 1847 affected pairs
- `zh`: 1620 grouped entries / 1820 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
