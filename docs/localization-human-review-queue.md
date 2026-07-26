# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3508
- Former raw review rows: 89155
- Actionable grouped queue entries: 3265
- Actionable affected locale-message pairs: 44733
- Native-review audit grouped entries: 2477
- Native-review audit affected locale-message pairs: 44422
- High-risk actionable entries: 1453 (22382 affected pairs)
- Medium-risk actionable entries: 657 (7987 affected pairs)
- Low-risk actionable entries: 1155 (14364 affected pairs)

## Actionable Queue By Locale

- `bn`: 1839 grouped entries / 1891 affected pairs
- `hi`: 2931 grouped entries / 3079 affected pairs
- `te`: 1906 grouped entries / 1961 affected pairs
- `mr`: 1912 grouped entries / 1967 affected pairs
- `ur`: 1893 grouped entries / 1947 affected pairs
- `gu`: 1939 grouped entries / 1998 affected pairs
- `pa`: 1927 grouped entries / 1985 affected pairs
- `ml`: 1909 grouped entries / 1963 affected pairs
- `kn`: 1904 grouped entries / 1959 affected pairs
- `or`: 1933 grouped entries / 1991 affected pairs
- `as`: 1893 grouped entries / 1948 affected pairs
- `sa`: 1911 grouped entries / 1967 affected pairs
- `es`: 2777 grouped entries / 2865 affected pairs
- `fr`: 2796 grouped entries / 2894 affected pairs
- `de`: 2771 grouped entries / 2863 affected pairs
- `ar`: 2691 grouped entries / 2785 affected pairs
- `ja`: 2807 grouped entries / 2906 affected pairs
- `pt`: 2783 grouped entries / 2869 affected pairs
- `zh`: 2798 grouped entries / 2895 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 52 grouped entries / 522 affected pairs
- `exact-english-fallback-needs-human-review`: 1708 grouped entries / 16815 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 105 grouped entries / 833 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1376 grouped entries / 26225 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2350 grouped entries / 2638 affected pairs
- `hi`: 1251 grouped entries / 1450 affected pairs
- `te`: 2448 grouped entries / 2772 affected pairs
- `mr`: 2441 grouped entries / 2766 affected pairs
- `ur`: 2339 grouped entries / 2626 affected pairs
- `gu`: 2413 grouped entries / 2735 affected pairs
- `pa`: 2424 grouped entries / 2748 affected pairs
- `ml`: 2442 grouped entries / 2770 affected pairs
- `kn`: 2451 grouped entries / 2774 affected pairs
- `or`: 2424 grouped entries / 2742 affected pairs
- `as`: 2466 grouped entries / 2785 affected pairs
- `sa`: 2450 grouped entries / 2766 affected pairs
- `es`: 1565 grouped entries / 1868 affected pairs
- `fr`: 1538 grouped entries / 1839 affected pairs
- `de`: 1566 grouped entries / 1870 affected pairs
- `ar`: 1588 grouped entries / 1744 affected pairs
- `ja`: 1626 grouped entries / 1827 affected pairs
- `pt`: 1550 grouped entries / 1864 affected pairs
- `zh`: 1637 grouped entries / 1838 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
