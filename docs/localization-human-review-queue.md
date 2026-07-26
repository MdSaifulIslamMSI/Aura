# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3607
- Former raw review rows: 91036
- Actionable grouped queue entries: 3352
- Actionable affected locale-message pairs: 46935
- Native-review audit grouped entries: 2459
- Native-review audit affected locale-message pairs: 44101
- High-risk actionable entries: 1469 (22923 affected pairs)
- Medium-risk actionable entries: 657 (7987 affected pairs)
- Low-risk actionable entries: 1226 (16025 affected pairs)

## Actionable Queue By Locale

- `bn`: 1951 grouped entries / 2008 affected pairs
- `hi`: 3019 grouped entries / 3177 affected pairs
- `te`: 2018 grouped entries / 2078 affected pairs
- `mr`: 2024 grouped entries / 2084 affected pairs
- `ur`: 2005 grouped entries / 2064 affected pairs
- `gu`: 2051 grouped entries / 2115 affected pairs
- `pa`: 2039 grouped entries / 2102 affected pairs
- `ml`: 2021 grouped entries / 2080 affected pairs
- `kn`: 2016 grouped entries / 2076 affected pairs
- `or`: 2045 grouped entries / 2108 affected pairs
- `as`: 2005 grouped entries / 2065 affected pairs
- `sa`: 2023 grouped entries / 2084 affected pairs
- `es`: 2886 grouped entries / 2982 affected pairs
- `fr`: 2905 grouped entries / 3011 affected pairs
- `de`: 2880 grouped entries / 2979 affected pairs
- `ar`: 2798 grouped entries / 2902 affected pairs
- `ja`: 2914 grouped entries / 3023 affected pairs
- `pt`: 2892 grouped entries / 2985 affected pairs
- `zh`: 2905 grouped entries / 3012 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 51 grouped entries / 520 affected pairs
- `exact-english-fallback-needs-human-review`: 1751 grouped entries / 18164 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 106 grouped entries / 852 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1420 grouped entries / 27061 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2334 grouped entries / 2620 affected pairs
- `hi`: 1252 grouped entries / 1451 affected pairs
- `te`: 2432 grouped entries / 2754 affected pairs
- `mr`: 2425 grouped entries / 2748 affected pairs
- `ur`: 2323 grouped entries / 2608 affected pairs
- `gu`: 2397 grouped entries / 2717 affected pairs
- `pa`: 2408 grouped entries / 2730 affected pairs
- `ml`: 2426 grouped entries / 2752 affected pairs
- `kn`: 2435 grouped entries / 2756 affected pairs
- `or`: 2408 grouped entries / 2724 affected pairs
- `as`: 2450 grouped entries / 2767 affected pairs
- `sa`: 2434 grouped entries / 2748 affected pairs
- `es`: 1549 grouped entries / 1850 affected pairs
- `fr`: 1522 grouped entries / 1821 affected pairs
- `de`: 1550 grouped entries / 1853 affected pairs
- `ar`: 1572 grouped entries / 1726 affected pairs
- `ja`: 1610 grouped entries / 1809 affected pairs
- `pt`: 1534 grouped entries / 1847 affected pairs
- `zh`: 1621 grouped entries / 1820 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
