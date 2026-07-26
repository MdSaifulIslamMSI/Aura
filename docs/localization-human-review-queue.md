# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3635
- Former raw review rows: 91568
- Actionable grouped queue entries: 3385
- Actionable affected locale-message pairs: 47598
- Native-review audit grouped entries: 2456
- Native-review audit affected locale-message pairs: 43970
- High-risk actionable entries: 1469 (22923 affected pairs)
- Medium-risk actionable entries: 657 (7987 affected pairs)
- Low-risk actionable entries: 1259 (16688 affected pairs)

## Actionable Queue By Locale

- `bn`: 1986 grouped entries / 2043 affected pairs
- `hi`: 3052 grouped entries / 3210 affected pairs
- `te`: 2053 grouped entries / 2113 affected pairs
- `mr`: 2059 grouped entries / 2119 affected pairs
- `ur`: 2040 grouped entries / 2099 affected pairs
- `gu`: 2086 grouped entries / 2150 affected pairs
- `pa`: 2074 grouped entries / 2137 affected pairs
- `ml`: 2056 grouped entries / 2115 affected pairs
- `kn`: 2051 grouped entries / 2111 affected pairs
- `or`: 2080 grouped entries / 2143 affected pairs
- `as`: 2040 grouped entries / 2100 affected pairs
- `sa`: 2058 grouped entries / 2119 affected pairs
- `es`: 2921 grouped entries / 3017 affected pairs
- `fr`: 2940 grouped entries / 3046 affected pairs
- `de`: 2915 grouped entries / 3014 affected pairs
- `ar`: 2833 grouped entries / 2937 affected pairs
- `ja`: 2949 grouped entries / 3058 affected pairs
- `pt`: 2927 grouped entries / 3020 affected pairs
- `zh`: 2940 grouped entries / 3047 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 51 grouped entries / 520 affected pairs
- `exact-english-fallback-needs-human-review`: 1798 grouped entries / 19093 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 106 grouped entries / 852 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1406 grouped entries / 26795 affected pairs

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
