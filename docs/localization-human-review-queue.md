# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. Existing foundation entries keep their prior reviewed status. Newly promoted locale entries remain queued for human linguistic review.

## Summary

- Stable ICU message IDs: 2967
- Queue entries: 11692
- High-risk queue entries: 3700
- Medium-risk queue entries: 3860
- Low-risk queue entries: 4132

## By Locale

- `ar`: 2923
- `bn`: 2923
- `hi`: 2923
- `ur`: 2923

## By Reason

- `legacy-pack-promotion-needs-human-review`: 7949
- `exact-english-fallback-needs-human-review`: 3473
- `legacy-placeholder-mismatch-uses-english-fallback`: 148
- `brand-term-corruption-uses-english-fallback`: 121
- `forbidden-transliteration-uses-english-fallback`: 1

## Review Order

1. Review high-risk checkout, cart, payment, authentication, seller, and support copy first.
2. Review medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Review low-risk operational and secondary UI copy last.
4. Resolve English fallbacks and placeholder mismatches before marking a locale batch reviewed.

The full machine-readable queue is committed at `app/src/i18n/quality/humanReviewQueue.json`.
