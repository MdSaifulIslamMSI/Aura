# Localization Human Review Queue

The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. Existing foundation entries keep their prior reviewed status. Newly promoted locale entries remain queued for human linguistic review.

## Summary

- Stable ICU message IDs: 2647
- Queue entries: 10584
- High-risk queue entries: 2932
- Medium-risk queue entries: 3684
- Low-risk queue entries: 3968

## By Locale

- `ar`: 2646
- `bn`: 2646
- `hi`: 2646
- `ur`: 2646

## By Reason

- `legacy-pack-promotion-needs-human-review`: 7820
- `exact-english-fallback-needs-human-review`: 2488
- `brand-term-corruption-uses-english-fallback`: 125
- `legacy-placeholder-mismatch-uses-english-fallback`: 150
- `forbidden-transliteration-uses-english-fallback`: 1

## Review Order

1. Review high-risk checkout, cart, payment, authentication, seller, and support copy first.
2. Review medium-risk navigation, discovery, listing, search, filters, and voice copy next.
3. Review low-risk operational and secondary UI copy last.
4. Resolve English fallbacks and placeholder mismatches before marking a locale batch reviewed.

The full machine-readable queue is committed at `app/src/i18n/quality/humanReviewQueue.json`.
