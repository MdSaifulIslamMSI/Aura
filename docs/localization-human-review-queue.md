# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3704
- Former raw review rows: 90542
- Actionable grouped queue entries: 129
- Actionable affected locale-message pairs: 1030
- Native-review audit grouped entries: 4471
- Native-review audit affected locale-message pairs: 89512
- High-risk actionable entries: 49 (458 affected pairs)
- Medium-risk actionable entries: 32 (257 affected pairs)
- Low-risk actionable entries: 48 (315 affected pairs)

## Actionable Queue By Locale

- `bn`: 42 grouped entries / 45 affected pairs
- `hi`: 41 grouped entries / 45 affected pairs
- `te`: 47 grouped entries / 51 affected pairs
- `mr`: 43 grouped entries / 47 affected pairs
- `ur`: 46 grouped entries / 50 affected pairs
- `gu`: 45 grouped entries / 49 affected pairs
- `pa`: 44 grouped entries / 48 affected pairs
- `ml`: 43 grouped entries / 46 affected pairs
- `kn`: 46 grouped entries / 50 affected pairs
- `or`: 45 grouped entries / 49 affected pairs
- `as`: 42 grouped entries / 45 affected pairs
- `sa`: 44 grouped entries / 48 affected pairs
- `es`: 66 grouped entries / 73 affected pairs
- `fr`: 74 grouped entries / 82 affected pairs
- `de`: 88 grouped entries / 95 affected pairs
- `ar`: 41 grouped entries / 44 affected pairs
- `ja`: 47 grouped entries / 51 affected pairs
- `pt`: 59 grouped entries / 64 affected pairs
- `zh`: 44 grouped entries / 48 affected pairs

## Actionable Queue By Reason

- `exact-english-fallback-needs-human-review`: 53 grouped entries / 408 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 1 grouped entries / 19 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 75 grouped entries / 603 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 3293 grouped entries / 3683 affected pairs
- `hi`: 3249 grouped entries / 3683 affected pairs
- `te`: 4516 grouped entries / 4991 affected pairs
- `mr`: 4522 grouped entries / 4995 affected pairs
- `ur`: 3290 grouped entries / 3678 affected pairs
- `gu`: 4516 grouped entries / 4993 affected pairs
- `pa`: 4520 grouped entries / 4994 affected pairs
- `ml`: 4516 grouped entries / 4996 affected pairs
- `kn`: 4519 grouped entries / 4992 affected pairs
- `or`: 4520 grouped entries / 4993 affected pairs
- `as`: 4526 grouped entries / 4997 affected pairs
- `sa`: 4532 grouped entries / 4994 affected pairs
- `es`: 4500 grouped entries / 4969 affected pairs
- `fr`: 4490 grouped entries / 4960 affected pairs
- `de`: 4476 grouped entries / 4947 affected pairs
- `ar`: 3250 grouped entries / 3684 affected pairs
- `ja`: 4466 grouped entries / 4991 affected pairs
- `pt`: 4495 grouped entries / 4978 affected pairs
- `zh`: 4469 grouped entries / 4994 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
