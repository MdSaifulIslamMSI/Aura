# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. Existing foundation entries keep their prior reviewed status. Newly promoted locale entries remain queued for human linguistic review.

## Summary

- Stable ICU message IDs: 2748
- Queue entries: 10988
- High-risk queue entries: 3020
- Medium-risk queue entries: 3856
- Low-risk queue entries: 4112

## By Locale

- `ar`: 2747
- `bn`: 2747
- `hi`: 2747
- `ur`: 2747

## By Reason

- `legacy-pack-promotion-needs-human-review`: 7949
- `exact-english-fallback-needs-human-review`: 2769
- `brand-term-corruption-uses-english-fallback`: 121
- `legacy-placeholder-mismatch-uses-english-fallback`: 148
- `forbidden-transliteration-uses-english-fallback`: 1

## Review Order

1. Review high-risk checkout, cart, payment, authentication, seller, and support copy first.
2. Review medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Review low-risk operational and secondary UI copy last.
4. Resolve English fallbacks and placeholder mismatches before marking a locale batch reviewed.

The full machine-readable queue is committed at `app/src/i18n/quality/humanReviewQueue.json`.
