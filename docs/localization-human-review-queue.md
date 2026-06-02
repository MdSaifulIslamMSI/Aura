# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3276
- Former raw review rows: 74834
- Actionable grouped queue entries: 2462
- Actionable affected locale-message pairs: 29689
- Native-review audit grouped entries: 2488
- Native-review audit affected locale-message pairs: 45145
- High-risk actionable entries: 1026 (13911 affected pairs)
- Medium-risk actionable entries: 587 (7009 affected pairs)
- Low-risk actionable entries: 849 (8769 affected pairs)

## Actionable Queue By Locale

- `ar`: 1974 grouped entries / 2033 affected pairs
- `as`: 1119 grouped entries / 1139 affected pairs
- `bn`: 1112 grouped entries / 1130 affected pairs
- `de`: 2033 grouped entries / 2092 affected pairs
- `fr`: 2056 grouped entries / 2122 affected pairs
- `gu`: 1168 grouped entries / 1192 affected pairs
- `hi`: 2244 grouped entries / 2353 affected pairs
- `ja`: 2045 grouped entries / 2107 affected pairs
- `kn`: 1133 grouped entries / 1152 affected pairs
- `ml`: 1137 grouped entries / 1155 affected pairs
- `mr`: 1140 grouped entries / 1159 affected pairs
- `or`: 1163 grouped entries / 1185 affected pairs
- `pa`: 1156 grouped entries / 1179 affected pairs
- `pt`: 2017 grouped entries / 2073 affected pairs
- `sa`: 1137 grouped entries / 1158 affected pairs
- `te`: 1134 grouped entries / 1153 affected pairs
- `ur`: 1125 grouped entries / 1144 affected pairs
- `zh`: 2036 grouped entries / 2096 affected pairs
- `es`: 2011 grouped entries / 2067 affected pairs

## Actionable Queue By Reason

- `reviewed-catalog-english-fallback-needs-human-review`: 2462 grouped entries / 29689 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `as`: 2499 grouped entries / 2831 affected pairs
- `de`: 1562 grouped entries / 1878 affected pairs
- `es`: 1587 grouped entries / 1903 affected pairs
- `fr`: 1535 grouped entries / 1848 affected pairs
- `gu`: 2444 grouped entries / 2778 affected pairs
- `ja`: 1649 grouped entries / 1863 affected pairs
- `kn`: 2482 grouped entries / 2818 affected pairs
- `ml`: 2474 grouped entries / 2815 affected pairs
- `mr`: 2473 grouped entries / 2811 affected pairs
- `or`: 2454 grouped entries / 2785 affected pairs
- `pa`: 2456 grouped entries / 2791 affected pairs
- `pt`: 1570 grouped entries / 1897 affected pairs
- `sa`: 2483 grouped entries / 2812 affected pairs
- `te`: 2480 grouped entries / 2817 affected pairs
- `zh`: 1660 grouped entries / 1874 affected pairs
- `ar`: 1619 grouped entries / 1788 affected pairs
- `bn`: 2390 grouped entries / 2691 affected pairs
- `hi`: 1256 grouped entries / 1468 affected pairs
- `ur`: 2378 grouped entries / 2677 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
