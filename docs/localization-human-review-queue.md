# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3676
- Former raw review rows: 92480
- Actionable grouped queue entries: 3429
- Actionable affected locale-message pairs: 48605
- Native-review audit grouped entries: 2452
- Native-review audit affected locale-message pairs: 43875
- High-risk actionable entries: 1437 (22728 affected pairs)
- Medium-risk actionable entries: 672 (8163 affected pairs)
- Low-risk actionable entries: 1320 (17714 affected pairs)

## Actionable Queue By Locale

- `bn`: 2033 grouped entries / 2096 affected pairs
- `hi`: 3096 grouped entries / 3263 affected pairs
- `te`: 2100 grouped entries / 2166 affected pairs
- `mr`: 2106 grouped entries / 2172 affected pairs
- `ur`: 2087 grouped entries / 2152 affected pairs
- `gu`: 2133 grouped entries / 2203 affected pairs
- `pa`: 2121 grouped entries / 2190 affected pairs
- `ml`: 2103 grouped entries / 2168 affected pairs
- `kn`: 2098 grouped entries / 2164 affected pairs
- `or`: 2127 grouped entries / 2196 affected pairs
- `as`: 2087 grouped entries / 2153 affected pairs
- `sa`: 2105 grouped entries / 2172 affected pairs
- `es`: 2967 grouped entries / 3070 affected pairs
- `fr`: 2986 grouped entries / 3099 affected pairs
- `de`: 2961 grouped entries / 3067 affected pairs
- `ar`: 2878 grouped entries / 2990 affected pairs
- `ja`: 2994 grouped entries / 3111 affected pairs
- `pt`: 2973 grouped entries / 3073 affected pairs
- `zh`: 2985 grouped entries / 3100 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 51 grouped entries / 520 affected pairs
- `exact-english-fallback-needs-human-review`: 1874 grouped entries / 20689 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 98 grouped entries / 700 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1382 grouped entries / 26358 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2327 grouped entries / 2608 affected pairs
- `hi`: 1245 grouped entries / 1441 affected pairs
- `te`: 2425 grouped entries / 2742 affected pairs
- `mr`: 2418 grouped entries / 2736 affected pairs
- `ur`: 2316 grouped entries / 2596 affected pairs
- `gu`: 2390 grouped entries / 2705 affected pairs
- `pa`: 2401 grouped entries / 2718 affected pairs
- `ml`: 2419 grouped entries / 2740 affected pairs
- `kn`: 2428 grouped entries / 2744 affected pairs
- `or`: 2401 grouped entries / 2712 affected pairs
- `as`: 2443 grouped entries / 2755 affected pairs
- `sa`: 2427 grouped entries / 2736 affected pairs
- `es`: 1540 grouped entries / 1838 affected pairs
- `fr`: 1515 grouped entries / 1809 affected pairs
- `de`: 1541 grouped entries / 1841 affected pairs
- `ar`: 1562 grouped entries / 1714 affected pairs
- `ja`: 1600 grouped entries / 1797 affected pairs
- `pt`: 1525 grouped entries / 1835 affected pairs
- `zh`: 1611 grouped entries / 1808 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
