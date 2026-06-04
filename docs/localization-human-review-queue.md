# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3303
- Former raw review rows: 83097
- Actionable grouped queue entries: 2956
- Actionable affected locale-message pairs: 37922
- Native-review audit grouped entries: 2488
- Native-review audit affected locale-message pairs: 45175
- High-risk actionable entries: 1246 (17869 affected pairs)
- Medium-risk actionable entries: 650 (7831 affected pairs)
- Low-risk actionable entries: 1060 (12222 affected pairs)

## Actionable Queue By Locale

- `bn`: 1531 grouped entries / 1565 affected pairs
- `hi`: 2661 grouped entries / 2784 affected pairs
- `te`: 1553 grouped entries / 1588 affected pairs
- `mr`: 1559 grouped entries / 1594 affected pairs
- `ur`: 1544 grouped entries / 1579 affected pairs
- `gu`: 1587 grouped entries / 1627 affected pairs
- `pa`: 1575 grouped entries / 1614 affected pairs
- `ml`: 1556 grouped entries / 1590 affected pairs
- `kn`: 1552 grouped entries / 1587 affected pairs
- `or`: 1582 grouped entries / 1620 affected pairs
- `as`: 1538 grouped entries / 1574 affected pairs
- `sa`: 1556 grouped entries / 1593 affected pairs
- `es`: 2429 grouped entries / 2498 affected pairs
- `fr`: 2475 grouped entries / 2553 affected pairs
- `de`: 2451 grouped entries / 2523 affected pairs
- `ar`: 2392 grouped entries / 2464 affected pairs
- `ja`: 2464 grouped entries / 2538 affected pairs
- `pt`: 2436 grouped entries / 2504 affected pairs
- `zh`: 2454 grouped entries / 2527 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 55 grouped entries / 537 affected pairs
- `exact-english-fallback-needs-human-review`: 1464 grouped entries / 11244 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1305 grouped entries / 24929 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2389 grouped entries / 2690 affected pairs
- `hi`: 1260 grouped entries / 1472 affected pairs
- `te`: 2480 grouped entries / 2817 affected pairs
- `mr`: 2473 grouped entries / 2811 affected pairs
- `ur`: 2377 grouped entries / 2676 affected pairs
- `gu`: 2444 grouped entries / 2778 affected pairs
- `pa`: 2456 grouped entries / 2791 affected pairs
- `ml`: 2474 grouped entries / 2815 affected pairs
- `kn`: 2482 grouped entries / 2818 affected pairs
- `or`: 2454 grouped entries / 2785 affected pairs
- `as`: 2499 grouped entries / 2831 affected pairs
- `sa`: 2483 grouped entries / 2812 affected pairs
- `es`: 1591 grouped entries / 1907 affected pairs
- `fr`: 1539 grouped entries / 1852 affected pairs
- `de`: 1566 grouped entries / 1882 affected pairs
- `ar`: 1623 grouped entries / 1792 affected pairs
- `ja`: 1653 grouped entries / 1867 affected pairs
- `pt`: 1574 grouped entries / 1901 affected pairs
- `zh`: 1664 grouped entries / 1878 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
