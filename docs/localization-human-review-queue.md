# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3666
- Former raw review rows: 92157
- Actionable grouped queue entries: 3413
- Actionable affected locale-message pairs: 48187
- Native-review audit grouped entries: 2456
- Native-review audit affected locale-message pairs: 43970
- High-risk actionable entries: 1469 (22923 affected pairs)
- Medium-risk actionable entries: 657 (8006 affected pairs)
- Low-risk actionable entries: 1287 (17258 affected pairs)

## Actionable Queue By Locale

- `bn`: 2015 grouped entries / 2074 affected pairs
- `hi`: 3080 grouped entries / 3241 affected pairs
- `te`: 2082 grouped entries / 2144 affected pairs
- `mr`: 2088 grouped entries / 2150 affected pairs
- `ur`: 2069 grouped entries / 2130 affected pairs
- `gu`: 2115 grouped entries / 2181 affected pairs
- `pa`: 2103 grouped entries / 2168 affected pairs
- `ml`: 2085 grouped entries / 2146 affected pairs
- `kn`: 2080 grouped entries / 2142 affected pairs
- `or`: 2109 grouped entries / 2174 affected pairs
- `as`: 2069 grouped entries / 2131 affected pairs
- `sa`: 2087 grouped entries / 2150 affected pairs
- `es`: 2950 grouped entries / 3048 affected pairs
- `fr`: 2969 grouped entries / 3077 affected pairs
- `de`: 2944 grouped entries / 3045 affected pairs
- `ar`: 2861 grouped entries / 2968 affected pairs
- `ja`: 2977 grouped entries / 3089 affected pairs
- `pt`: 2956 grouped entries / 3051 affected pairs
- `zh`: 2968 grouped entries / 3078 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 51 grouped entries / 520 affected pairs
- `exact-english-fallback-needs-human-review`: 1853 grouped entries / 20195 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 106 grouped entries / 852 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1379 grouped entries / 26282 affected pairs

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
