# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3667
- Former raw review rows: 92309
- Actionable grouped queue entries: 3420
- Actionable affected locale-message pairs: 48339
- Native-review audit grouped entries: 2456
- Native-review audit affected locale-message pairs: 43970
- High-risk actionable entries: 1469 (22923 affected pairs)
- Medium-risk actionable entries: 660 (8082 affected pairs)
- Low-risk actionable entries: 1291 (17334 affected pairs)

## Actionable Queue By Locale

- `bn`: 2022 grouped entries / 2082 affected pairs
- `hi`: 3087 grouped entries / 3249 affected pairs
- `te`: 2089 grouped entries / 2152 affected pairs
- `mr`: 2095 grouped entries / 2158 affected pairs
- `ur`: 2076 grouped entries / 2138 affected pairs
- `gu`: 2122 grouped entries / 2189 affected pairs
- `pa`: 2110 grouped entries / 2176 affected pairs
- `ml`: 2092 grouped entries / 2154 affected pairs
- `kn`: 2087 grouped entries / 2150 affected pairs
- `or`: 2116 grouped entries / 2182 affected pairs
- `as`: 2076 grouped entries / 2139 affected pairs
- `sa`: 2094 grouped entries / 2158 affected pairs
- `es`: 2957 grouped entries / 3056 affected pairs
- `fr`: 2976 grouped entries / 3085 affected pairs
- `de`: 2951 grouped entries / 3053 affected pairs
- `ar`: 2868 grouped entries / 2976 affected pairs
- `ja`: 2984 grouped entries / 3097 affected pairs
- `pt`: 2963 grouped entries / 3059 affected pairs
- `zh`: 2975 grouped entries / 3086 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 51 grouped entries / 520 affected pairs
- `exact-english-fallback-needs-human-review`: 1853 grouped entries / 20195 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 106 grouped entries / 852 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1386 grouped entries / 26434 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2331 grouped entries / 2613 affected pairs
- `hi`: 1249 grouped entries / 1446 affected pairs
- `te`: 2429 grouped entries / 2747 affected pairs
- `mr`: 2422 grouped entries / 2741 affected pairs
- `ur`: 2320 grouped entries / 2601 affected pairs
- `gu`: 2394 grouped entries / 2710 affected pairs
- `pa`: 2405 grouped entries / 2723 affected pairs
- `ml`: 2423 grouped entries / 2745 affected pairs
- `kn`: 2432 grouped entries / 2749 affected pairs
- `or`: 2405 grouped entries / 2717 affected pairs
- `as`: 2447 grouped entries / 2760 affected pairs
- `sa`: 2431 grouped entries / 2741 affected pairs
- `es`: 1544 grouped entries / 1843 affected pairs
- `fr`: 1519 grouped entries / 1814 affected pairs
- `de`: 1545 grouped entries / 1846 affected pairs
- `ar`: 1566 grouped entries / 1719 affected pairs
- `ja`: 1604 grouped entries / 1802 affected pairs
- `pt`: 1529 grouped entries / 1840 affected pairs
- `zh`: 1615 grouped entries / 1813 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
