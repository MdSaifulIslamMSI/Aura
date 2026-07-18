# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3387
- Former raw review rows: 86856
- Actionable grouped queue entries: 3166
- Actionable affected locale-message pairs: 42195
- Native-review audit grouped entries: 2490
- Native-review audit affected locale-message pairs: 44661
- High-risk actionable entries: 1428 (21638 affected pairs)
- Medium-risk actionable entries: 658 (7990 affected pairs)
- Low-risk actionable entries: 1080 (12567 affected pairs)

## Actionable Queue By Locale

- `bn`: 1716 grouped entries / 1756 affected pairs
- `hi`: 2829 grouped entries / 2962 affected pairs
- `te`: 1783 grouped entries / 1826 affected pairs
- `mr`: 1789 grouped entries / 1832 affected pairs
- `ur`: 1771 grouped entries / 1813 affected pairs
- `gu`: 1817 grouped entries / 1865 affected pairs
- `pa`: 1805 grouped entries / 1852 affected pairs
- `ml`: 1786 grouped entries / 1828 affected pairs
- `kn`: 1782 grouped entries / 1825 affected pairs
- `or`: 1811 grouped entries / 1857 affected pairs
- `as`: 1769 grouped entries / 1813 affected pairs
- `sa`: 1787 grouped entries / 1832 affected pairs
- `es`: 2653 grouped entries / 2730 affected pairs
- `fr`: 2673 grouped entries / 2759 affected pairs
- `de`: 2648 grouped entries / 2729 affected pairs
- `ar`: 2569 grouped entries / 2650 affected pairs
- `ja`: 2686 grouped entries / 2771 affected pairs
- `pt`: 2659 grouped entries / 2735 affected pairs
- `zh`: 2676 grouped entries / 2760 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 53 grouped entries / 526 affected pairs
- `exact-english-fallback-needs-human-review`: 1554 grouped entries / 13269 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 1 grouped entries / 2 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 108 grouped entries / 874 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1427 grouped entries / 27188 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2362 grouped entries / 2652 affected pairs
- `hi`: 1243 grouped entries / 1446 affected pairs
- `te`: 2460 grouped entries / 2786 affected pairs
- `mr`: 2453 grouped entries / 2780 affected pairs
- `ur`: 2351 grouped entries / 2639 affected pairs
- `gu`: 2424 grouped entries / 2747 affected pairs
- `pa`: 2436 grouped entries / 2760 affected pairs
- `ml`: 2454 grouped entries / 2784 affected pairs
- `kn`: 2462 grouped entries / 2787 affected pairs
- `or`: 2435 grouped entries / 2755 affected pairs
- `as`: 2478 grouped entries / 2799 affected pairs
- `sa`: 2462 grouped entries / 2780 affected pairs
- `es`: 1576 grouped entries / 1882 affected pairs
- `fr`: 1550 grouped entries / 1853 affected pairs
- `de`: 1577 grouped entries / 1883 affected pairs
- `ar`: 1599 grouped entries / 1758 affected pairs
- `ja`: 1637 grouped entries / 1841 affected pairs
- `pt`: 1560 grouped entries / 1877 affected pairs
- `zh`: 1648 grouped entries / 1852 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
