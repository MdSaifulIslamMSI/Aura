# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3312
- Former raw review rows: 84429
- Actionable grouped queue entries: 3025
- Actionable affected locale-message pairs: 39139
- Native-review audit grouped entries: 2495
- Native-review audit affected locale-message pairs: 45290
- High-risk actionable entries: 1308 (18942 affected pairs)
- Medium-risk actionable entries: 649 (7823 affected pairs)
- Low-risk actionable entries: 1068 (12374 affected pairs)

## Actionable Queue By Locale

- `bn`: 1550 grouped entries / 1585 affected pairs
- `hi`: 2679 grouped entries / 2803 affected pairs
- `te`: 1623 grouped entries / 1661 affected pairs
- `mr`: 1629 grouped entries / 1667 affected pairs
- `ur`: 1612 grouped entries / 1649 affected pairs
- `gu`: 1657 grouped entries / 1700 affected pairs
- `pa`: 1645 grouped entries / 1687 affected pairs
- `ml`: 1626 grouped entries / 1663 affected pairs
- `kn`: 1622 grouped entries / 1660 affected pairs
- `or`: 1652 grouped entries / 1693 affected pairs
- `as`: 1608 grouped entries / 1647 affected pairs
- `sa`: 1626 grouped entries / 1666 affected pairs
- `es`: 2498 grouped entries / 2570 affected pairs
- `fr`: 2544 grouped entries / 2625 affected pairs
- `de`: 2520 grouped entries / 2595 affected pairs
- `ar`: 2410 grouped entries / 2483 affected pairs
- `ja`: 2533 grouped entries / 2610 affected pairs
- `pt`: 2505 grouped entries / 2576 affected pairs
- `zh`: 2523 grouped entries / 2599 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 55 grouped entries / 537 affected pairs
- `exact-english-fallback-needs-human-review`: 1465 grouped entries / 11274 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1373 grouped entries / 26116 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2390 grouped entries / 2691 affected pairs
- `hi`: 1261 grouped entries / 1473 affected pairs
- `te`: 2487 grouped entries / 2824 affected pairs
- `mr`: 2480 grouped entries / 2818 affected pairs
- `ur`: 2378 grouped entries / 2677 affected pairs
- `gu`: 2451 grouped entries / 2785 affected pairs
- `pa`: 2463 grouped entries / 2798 affected pairs
- `ml`: 2481 grouped entries / 2822 affected pairs
- `kn`: 2489 grouped entries / 2825 affected pairs
- `or`: 2461 grouped entries / 2792 affected pairs
- `as`: 2506 grouped entries / 2838 affected pairs
- `sa`: 2490 grouped entries / 2819 affected pairs
- `es`: 1599 grouped entries / 1915 affected pairs
- `fr`: 1547 grouped entries / 1860 affected pairs
- `de`: 1574 grouped entries / 1890 affected pairs
- `ar`: 1624 grouped entries / 1793 affected pairs
- `ja`: 1661 grouped entries / 1875 affected pairs
- `pt`: 1582 grouped entries / 1909 affected pairs
- `zh`: 1672 grouped entries / 1886 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
