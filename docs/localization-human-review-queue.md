# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3517
- Former raw review rows: 89326
- Actionable grouped queue entries: 3274
- Actionable affected locale-message pairs: 45047
- Native-review audit grouped entries: 2469
- Native-review audit affected locale-message pairs: 44279
- High-risk actionable entries: 1453 (22382 affected pairs)
- Medium-risk actionable entries: 657 (7987 affected pairs)
- Low-risk actionable entries: 1164 (14678 affected pairs)

## Actionable Queue By Locale

- `bn`: 1855 grouped entries / 1908 affected pairs
- `hi`: 2941 grouped entries / 3089 affected pairs
- `te`: 1922 grouped entries / 1978 affected pairs
- `mr`: 1928 grouped entries / 1984 affected pairs
- `ur`: 1909 grouped entries / 1964 affected pairs
- `gu`: 1955 grouped entries / 2015 affected pairs
- `pa`: 1943 grouped entries / 2002 affected pairs
- `ml`: 1925 grouped entries / 1980 affected pairs
- `kn`: 1920 grouped entries / 1976 affected pairs
- `or`: 1949 grouped entries / 2008 affected pairs
- `as`: 1909 grouped entries / 1965 affected pairs
- `sa`: 1927 grouped entries / 1984 affected pairs
- `es`: 2793 grouped entries / 2882 affected pairs
- `fr`: 2812 grouped entries / 2911 affected pairs
- `de`: 2787 grouped entries / 2879 affected pairs
- `ar`: 2707 grouped entries / 2802 affected pairs
- `ja`: 2823 grouped entries / 2923 affected pairs
- `pt`: 2799 grouped entries / 2885 affected pairs
- `zh`: 2814 grouped entries / 2912 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 51 grouped entries / 520 affected pairs
- `exact-english-fallback-needs-human-review`: 1716 grouped entries / 17093 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 105 grouped entries / 833 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1378 grouped entries / 26263 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2342 grouped entries / 2630 affected pairs
- `hi`: 1249 grouped entries / 1449 affected pairs
- `te`: 2440 grouped entries / 2764 affected pairs
- `mr`: 2433 grouped entries / 2758 affected pairs
- `ur`: 2331 grouped entries / 2618 affected pairs
- `gu`: 2405 grouped entries / 2727 affected pairs
- `pa`: 2416 grouped entries / 2740 affected pairs
- `ml`: 2434 grouped entries / 2762 affected pairs
- `kn`: 2443 grouped entries / 2766 affected pairs
- `or`: 2416 grouped entries / 2734 affected pairs
- `as`: 2458 grouped entries / 2777 affected pairs
- `sa`: 2442 grouped entries / 2758 affected pairs
- `es`: 1557 grouped entries / 1860 affected pairs
- `fr`: 1530 grouped entries / 1831 affected pairs
- `de`: 1558 grouped entries / 1863 affected pairs
- `ar`: 1580 grouped entries / 1736 affected pairs
- `ja`: 1618 grouped entries / 1819 affected pairs
- `pt`: 1542 grouped entries / 1857 affected pairs
- `zh`: 1629 grouped entries / 1830 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
