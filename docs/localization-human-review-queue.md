# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3690
- Former raw review rows: 92746
- Actionable grouped queue entries: 1737
- Actionable affected locale-message pairs: 29029
- Native-review audit grouped entries: 3045
- Native-review audit affected locale-message pairs: 63717
- High-risk actionable entries: 926 (16091 affected pairs)
- Medium-risk actionable entries: 308 (4771 affected pairs)
- Low-risk actionable entries: 503 (8167 affected pairs)

## Actionable Queue By Locale

- `bn`: 1434 grouped entries / 1471 affected pairs
- `hi`: 1382 grouped entries / 1417 affected pairs
- `te`: 1511 grouped entries / 1551 affected pairs
- `mr`: 1505 grouped entries / 1545 affected pairs
- `ur`: 1495 grouped entries / 1534 affected pairs
- `gu`: 1536 grouped entries / 1580 affected pairs
- `pa`: 1523 grouped entries / 1566 affected pairs
- `ml`: 1515 grouped entries / 1554 affected pairs
- `kn`: 1508 grouped entries / 1548 affected pairs
- `or`: 1546 grouped entries / 1590 affected pairs
- `as`: 1493 grouped entries / 1533 affected pairs
- `sa`: 1522 grouped entries / 1563 affected pairs
- `es`: 1499 grouped entries / 1539 affected pairs
- `fr`: 1509 grouped entries / 1558 affected pairs
- `de`: 1513 grouped entries / 1559 affected pairs
- `ar`: 1415 grouped entries / 1452 affected pairs
- `ja`: 1431 grouped entries / 1471 affected pairs
- `pt`: 1496 grouped entries / 1533 affected pairs
- `zh`: 1427 grouped entries / 1465 affected pairs

## Actionable Queue By Reason

- `brand-term-corruption-uses-english-fallback`: 74 grouped entries / 749 affected pairs
- `exact-english-fallback-needs-human-review`: 144 grouped entries / 1017 affected pairs
- `forbidden-transliteration-uses-english-fallback`: 3 grouped entries / 4 affected pairs
- `foundation-placeholder-mismatch-uses-english-fallback`: 2 grouped entries / 30 affected pairs
- `invalid-legacy-icu-uses-english-fallback`: 1 grouped entries / 18 affected pairs
- `legacy-placeholder-mismatch-uses-english-fallback`: 119 grouped entries / 718 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 21 grouped entries / 306 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 1373 grouped entries / 26187 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 2904 grouped entries / 3247 affected pairs
- `hi`: 2957 grouped entries / 3301 affected pairs
- `te`: 2996 grouped entries / 3371 affected pairs
- `mr`: 2999 grouped entries / 3377 affected pairs
- `ur`: 2888 grouped entries / 3228 affected pairs
- `gu`: 2968 grouped entries / 3342 affected pairs
- `pa`: 2980 grouped entries / 3356 affected pairs
- `ml`: 2985 grouped entries / 3368 affected pairs
- `kn`: 3000 grouped entries / 3374 affected pairs
- `or`: 2962 grouped entries / 3332 affected pairs
- `as`: 3017 grouped entries / 3389 affected pairs
- `sa`: 2993 grouped entries / 3359 affected pairs
- `es`: 3001 grouped entries / 3383 affected pairs
- `fr`: 2988 grouped entries / 3364 affected pairs
- `de`: 2977 grouped entries / 3363 affected pairs
- `ar`: 3024 grouped entries / 3266 affected pairs
- `ja`: 3157 grouped entries / 3451 affected pairs
- `pt`: 2992 grouped entries / 3389 affected pairs
- `zh`: 3163 grouped entries / 3457 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
