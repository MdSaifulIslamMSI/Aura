# Localization Language Quality

This report is the per-language quality gate for the reviewed ICU catalog system. It certifies mechanical translation safety and keeps native-language signoff visible instead of hiding it behind a single coverage percentage.

## Gate Rules

- Every required locale must contain every required ICU message.
- ICU syntax and source/translation placeholder structure must match.
- Unsafe HTML-like content, mojibake, corrupted brand terms, and forbidden transliterations are blocking.
- Exact English fallback is blocking unless the locale/message pair is explicitly tracked in the actionable queue or native-review audit.
- Native-script locales must keep confirmed translated non-fallback text above the native-letter floor; text still in actionable/native review is reported but not hidden as certified.

## Summary

- Required locales: 21
- Source ICU message keys: 4973
- Stable UI scanner candidates: 425
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 29618
- Native signoff pairs tracked: 64097

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4973 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4973 | 1500 | 0 | 1502 | 3267 | 98.0% (3269/3470) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4973 | 1465 | 0 | 1448 | 3321 | 58.4% (2538/3505) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4973 | 1580 | 0 | 1582 | 3391 | 96.7% (3244/3390) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4973 | 1574 | 0 | 1576 | 3397 | 97.4% (3251/3396) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4973 | 1564 | 0 | 1565 | 3248 | 97.8% (3250/3406) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4973 | 1609 | 0 | 1611 | 3362 | 97.0% (3216/3361) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4973 | 1595 | 0 | 1597 | 3376 | 97.0% (3229/3375) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4973 | 1583 | 0 | 1585 | 3388 | 97.8% (3241/3387) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4973 | 1577 | 0 | 1579 | 3394 | 96.9% (3247/3393) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4973 | 1619 | 0 | 1621 | 3352 | 95.1% (3202/3351) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4973 | 1563 | 0 | 1564 | 3409 | 96.9% (3258/3407) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4973 | 1593 | 0 | 1594 | 3379 | 95.5% (3231/3377) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4973 | 1575 | 0 | 1570 | 3403 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4973 | 1593 | 0 | 1589 | 3384 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4973 | 1600 | 0 | 1590 | 3383 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4973 | 1487 | 0 | 1483 | 3286 | 68.9% (2191/3483) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4973 | 1512 | 0 | 1502 | 3471 | 47.5% (2270/3458) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4973 | 1570 | 0 | 1564 | 3409 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4973 | 1500 | 0 | 1496 | 3477 | 39.3% (2264/3470) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4973 | 0 | 0 | 0 | 0 | n/a | n/a |

## Interpretation

- `PASS` means the locale is mechanically safe: complete catalog, valid ICU, matching placeholders, no unsafe content, no mojibake, and no hidden English fallback.
- `FINAL_READY` means the locale has no exact English fallback, no actionable repair queue, and no native audit signoff debt.
- `NOT_FINAL` means the locale is safe to ship mechanically but is not native-quality complete.
- `translation-repair-required` means the locale still has explicit English fallback debt in `humanReviewQueue.json`.
- `native-signoff-required` means promoted legacy/foundation translations are structurally safe but still need native linguistic signoff.
- `n/a (0 messages)` in the confirmed-text column means that no non-fallback messages have graduated out of the actionable/native-audit queues for that native-script locale yet; it is a zero-denominator signoff status, not missing key coverage.
- Run `npm run i18n:language-quality -- --final` when final native-quality release certification must block on all remaining repair/signoff debt.
- This is stronger than the legacy market-pack quality audit because it covers the full reviewed ICU catalog surface, not only the 599-key legacy pack.

Machine-readable report: `artifacts/i18n/language-quality-report.json`.
