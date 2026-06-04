# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3303
- Former raw review rows: 83080
- Actionable grouped queue entries: 2954
- Actionable affected locale-message pairs: 37895
- Native-review audit grouped entries: 2488
- Native-review audit affected locale-message pairs: 45185
- High-risk actionable entries: 1246 (17869 affected pairs)
- Medium-risk actionable entries: 649 (7823 affected pairs)
- Low-risk actionable entries: 1059 (12203 affected pairs)

## Actionable Queue By Locale

- `bn`: 1530 grouped entries / 1564 affected pairs
- `hi`: 2659 grouped entries / 2782 affected pairs
- `te`: 1552 grouped entries / 1587 affected pairs
- `mr`: 1558 grouped entries / 1593 affected pairs
- `ur`: 1543 grouped entries / 1578 affected pairs
- `gu`: 1586 grouped entries / 1626 affected pairs
- `pa`: 1574 grouped entries / 1613 affected pairs
- `ml`: 1555 grouped entries / 1589 affected pairs
- `kn`: 1551 grouped entries / 1586 affected pairs
- `or`: 1581 grouped entries / 1619 affected pairs
- `as`: 1537 grouped entries / 1573 affected pairs
- `sa`: 1555 grouped entries / 1592 affected pairs
- `es`: 2427 grouped entries / 2496 affected pairs
- `fr`: 2473 grouped entries / 2551 affected pairs
- `de`: 2449 grouped entries / 2521 affected pairs
- `ar`: 2390 grouped entries / 2462 affected pairs
- `ja`: 2462 grouped entries / 2536 affected pairs
- `pt`: 2434 grouped entries / 2502 affected pairs
- `zh`: 2452 grouped entries / 2525 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 55 grouped entries / 537 affected pairs
- `exact-english-fallback-needs-human-review`: 1462 grouped entries / 11217 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1305 grouped entries / 24929 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2390 grouped entries / 2691 affected pairs
- `hi`: 1261 grouped entries / 1473 affected pairs
- `te`: 2480 grouped entries / 2817 affected pairs
- `mr`: 2473 grouped entries / 2811 affected pairs
- `ur`: 2378 grouped entries / 2677 affected pairs
- `gu`: 2444 grouped entries / 2778 affected pairs
- `pa`: 2456 grouped entries / 2791 affected pairs
- `ml`: 2474 grouped entries / 2815 affected pairs
- `kn`: 2482 grouped entries / 2818 affected pairs
- `or`: 2454 grouped entries / 2785 affected pairs
- `as`: 2499 grouped entries / 2831 affected pairs
- `sa`: 2483 grouped entries / 2812 affected pairs
- `es`: 1592 grouped entries / 1908 affected pairs
- `fr`: 1540 grouped entries / 1853 affected pairs
- `de`: 1567 grouped entries / 1883 affected pairs
- `ar`: 1624 grouped entries / 1793 affected pairs
- `ja`: 1654 grouped entries / 1868 affected pairs
- `pt`: 1575 grouped entries / 1902 affected pairs
- `zh`: 1665 grouped entries / 1879 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
