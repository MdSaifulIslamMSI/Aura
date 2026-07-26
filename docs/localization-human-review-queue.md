# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3563
- Former raw review rows: 90200
- Actionable grouped queue entries: 3317
- Actionable affected locale-message pairs: 46103
- Native-review audit grouped entries: 2459
- Native-review audit affected locale-message pairs: 44097
- High-risk actionable entries: 1476 (22931 affected pairs)
- Medium-risk actionable entries: 656 (7968 affected pairs)
- Low-risk actionable entries: 1185 (15204 affected pairs)

## Actionable Queue By Locale

- `bn`: 1906 grouped entries / 1964 affected pairs
- `hi`: 2984 grouped entries / 3137 affected pairs
- `te`: 1973 grouped entries / 2034 affected pairs
- `mr`: 1979 grouped entries / 2040 affected pairs
- `ur`: 1960 grouped entries / 2020 affected pairs
- `gu`: 2006 grouped entries / 2071 affected pairs
- `pa`: 1994 grouped entries / 2058 affected pairs
- `ml`: 1976 grouped entries / 2036 affected pairs
- `kn`: 1971 grouped entries / 2032 affected pairs
- `or`: 2000 grouped entries / 2064 affected pairs
- `as`: 1960 grouped entries / 2021 affected pairs
- `sa`: 1978 grouped entries / 2040 affected pairs
- `es`: 2843 grouped entries / 2938 affected pairs
- `fr`: 2862 grouped entries / 2967 affected pairs
- `de`: 2837 grouped entries / 2935 affected pairs
- `ar`: 2757 grouped entries / 2858 affected pairs
- `ja`: 2873 grouped entries / 2979 affected pairs
- `pt`: 2849 grouped entries / 2941 affected pairs
- `zh`: 2864 grouped entries / 2968 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 51 grouped entries / 520 affected pairs
- `exact-english-fallback-needs-human-review`: 1734 grouped entries / 17708 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 106 grouped entries / 852 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1402 grouped entries / 26685 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2334 grouped entries / 2620 affected pairs
- `hi`: 1248 grouped entries / 1447 affected pairs
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
