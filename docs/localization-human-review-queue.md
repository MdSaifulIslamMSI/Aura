# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.

## Summary

- Stable ICU message IDs: 3704
- Former raw review rows: 90542
- Actionable grouped queue entries: 128
- Actionable affected locale-message pairs: 1022
- Native-review audit grouped entries: 4471
- Native-review audit affected locale-message pairs: 89520
- High-risk actionable entries: 49 (452 affected pairs)
- Medium-risk actionable entries: 31 (255 affected pairs)
- Low-risk actionable entries: 48 (315 affected pairs)

## Actionable Queue By Locale

- `bn`: 42 grouped entries / 45 affected pairs
- `hi`: 40 grouped entries / 43 affected pairs
- `te`: 47 grouped entries / 51 affected pairs
- `mr`: 43 grouped entries / 47 affected pairs
- `ur`: 46 grouped entries / 50 affected pairs
- `gu`: 45 grouped entries / 49 affected pairs
- `pa`: 44 grouped entries / 48 affected pairs
- `ml`: 43 grouped entries / 46 affected pairs
- `kn`: 46 grouped entries / 50 affected pairs
- `or`: 45 grouped entries / 49 affected pairs
- `as`: 42 grouped entries / 45 affected pairs
- `sa`: 43 grouped entries / 46 affected pairs
- `es`: 65 grouped entries / 71 affected pairs
- `fr`: 74 grouped entries / 82 affected pairs
- `de`: 88 grouped entries / 95 affected pairs
- `ar`: 41 grouped entries / 44 affected pairs
- `ja`: 47 grouped entries / 51 affected pairs
- `pt`: 59 grouped entries / 64 affected pairs
- `zh`: 43 grouped entries / 46 affected pairs

## Actionable Queue By Reason

- `exact-english-fallback-needs-human-review`: 52 grouped entries / 400 affected pairs
- `missing-foundation-locale-uses-english-fallback`: 1 grouped entries / 19 affected pairs
- `missing-legacy-locale-uses-english-fallback`: 75 grouped entries / 603 affected pairs

## Native Review Audit

Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.

- `bn`: 3296 grouped entries / 3683 affected pairs
- `hi`: 3247 grouped entries / 3685 affected pairs
- `te`: 4522 grouped entries / 4991 affected pairs
- `mr`: 4524 grouped entries / 4995 affected pairs
- `ur`: 3295 grouped entries / 3678 affected pairs
- `gu`: 4520 grouped entries / 4993 affected pairs
- `pa`: 4522 grouped entries / 4994 affected pairs
- `ml`: 4520 grouped entries / 4996 affected pairs
- `kn`: 4524 grouped entries / 4992 affected pairs
- `or`: 4524 grouped entries / 4993 affected pairs
- `as`: 4530 grouped entries / 4997 affected pairs
- `sa`: 4536 grouped entries / 4996 affected pairs
- `es`: 4505 grouped entries / 4971 affected pairs
- `fr`: 4491 grouped entries / 4960 affected pairs
- `de`: 4477 grouped entries / 4947 affected pairs
- `ar`: 3246 grouped entries / 3684 affected pairs
- `ja`: 4465 grouped entries / 4991 affected pairs
- `pt`: 4498 grouped entries / 4978 affected pairs
- `zh`: 4467 grouped entries / 4996 affected pairs

## Review Order

1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.
2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Resolve low-risk actionable fallbacks last.
4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.

Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.

Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.
