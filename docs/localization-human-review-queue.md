# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3274
- Former raw review rows: 82529
- Actionable grouped queue entries: 2859
- Actionable affected locale-message pairs: 37384
- Native-review audit grouped entries: 2488
- Native-review audit affected locale-message pairs: 45145
- High-risk actionable entries: 1205 (17388 affected pairs)
- Medium-risk actionable entries: 632 (7883 affected pairs)
- Low-risk actionable entries: 1022 (12113 affected pairs)

## Actionable Queue By Locale

- `ar`: 2371 grouped entries / 2438 affected pairs
- `as`: 1516 grouped entries / 1544 affected pairs
- `bn`: 1509 grouped entries / 1535 affected pairs
- `de`: 2430 grouped entries / 2497 affected pairs
- `es`: 2408 grouped entries / 2472 affected pairs
- `fr`: 2453 grouped entries / 2527 affected pairs
- `gu`: 1565 grouped entries / 1597 affected pairs
- `hi`: 2641 grouped entries / 2758 affected pairs
- `ja`: 2442 grouped entries / 2512 affected pairs
- `kn`: 1530 grouped entries / 1557 affected pairs
- `ml`: 1534 grouped entries / 1560 affected pairs
- `mr`: 1537 grouped entries / 1564 affected pairs
- `or`: 1560 grouped entries / 1590 affected pairs
- `pa`: 1553 grouped entries / 1584 affected pairs
- `pt`: 2414 grouped entries / 2478 affected pairs
- `sa`: 1534 grouped entries / 1563 affected pairs
- `te`: 1531 grouped entries / 1558 affected pairs
- `ur`: 1522 grouped entries / 1549 affected pairs
- `zh`: 2433 grouped entries / 2501 affected pairs

## Actionable Queue By Reason

- `missing-legacy-locale-uses-english-fallback`: 397 grouped entries / 7695 affected pairs
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
