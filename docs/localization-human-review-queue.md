# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3521
- Former raw review rows: 89402
- Actionable grouped queue entries: 3278
- Actionable affected locale-message pairs: 45196
- Native-review audit grouped entries: 2463
- Native-review audit affected locale-message pairs: 44206
- High-risk actionable entries: 1453 (22382 affected pairs)
- Medium-risk actionable entries: 657 (7987 affected pairs)
- Low-risk actionable entries: 1168 (14827 affected pairs)

## Actionable Queue By Locale

- `bn`: 1862 grouped entries / 1916 affected pairs
- `hi`: 2945 grouped entries / 3094 affected pairs
- `te`: 1929 grouped entries / 1986 affected pairs
- `mr`: 1935 grouped entries / 1992 affected pairs
- `ur`: 1916 grouped entries / 1972 affected pairs
- `gu`: 1962 grouped entries / 2023 affected pairs
- `pa`: 1950 grouped entries / 2010 affected pairs
- `ml`: 1932 grouped entries / 1988 affected pairs
- `kn`: 1927 grouped entries / 1984 affected pairs
- `or`: 1956 grouped entries / 2016 affected pairs
- `as`: 1916 grouped entries / 1973 affected pairs
- `sa`: 1934 grouped entries / 1992 affected pairs
- `es`: 2800 grouped entries / 2890 affected pairs
- `fr`: 2819 grouped entries / 2919 affected pairs
- `de`: 2794 grouped entries / 2887 affected pairs
- `ar`: 2714 grouped entries / 2810 affected pairs
- `ja`: 2830 grouped entries / 2931 affected pairs
- `pt`: 2806 grouped entries / 2893 affected pairs
- `zh`: 2821 grouped entries / 2920 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 51 grouped entries / 520 affected pairs
- `exact-english-fallback-needs-human-review`: 1711 grouped entries / 17106 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 106 grouped entries / 852 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1386 grouped entries / 26380 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2338 grouped entries / 2626 affected pairs
- `hi`: 1248 grouped entries / 1448 affected pairs
- `te`: 2436 grouped entries / 2760 affected pairs
- `mr`: 2429 grouped entries / 2754 affected pairs
- `ur`: 2327 grouped entries / 2614 affected pairs
- `gu`: 2401 grouped entries / 2723 affected pairs
- `pa`: 2412 grouped entries / 2736 affected pairs
- `ml`: 2430 grouped entries / 2758 affected pairs
- `kn`: 2439 grouped entries / 2762 affected pairs
- `or`: 2412 grouped entries / 2730 affected pairs
- `as`: 2454 grouped entries / 2773 affected pairs
- `sa`: 2438 grouped entries / 2754 affected pairs
- `es`: 1553 grouped entries / 1856 affected pairs
- `fr`: 1526 grouped entries / 1827 affected pairs
- `de`: 1554 grouped entries / 1859 affected pairs
- `ar`: 1576 grouped entries / 1732 affected pairs
- `ja`: 1614 grouped entries / 1815 affected pairs
- `pt`: 1538 grouped entries / 1853 affected pairs
- `zh`: 1625 grouped entries / 1826 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
