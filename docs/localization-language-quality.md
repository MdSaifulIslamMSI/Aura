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
- Source ICU message keys: 4925
- Stable UI scanner candidates: 418
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 29029
- Native signoff pairs tracked: 63774

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4925 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4925 | 1469 | 0 | 1471 | 3250 | 98.0% (3252/3453) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4925 | 1434 | 0 | 1417 | 3304 | 58.2% (2521/3488) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4925 | 1549 | 0 | 1551 | 3374 | 96.7% (3227/3373) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4925 | 1543 | 0 | 1545 | 3380 | 97.4% (3234/3379) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4925 | 1533 | 0 | 1534 | 3231 | 97.8% (3233/3389) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4925 | 1578 | 0 | 1580 | 3345 | 97.0% (3199/3344) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4925 | 1564 | 0 | 1566 | 3359 | 97.0% (3212/3358) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4925 | 1552 | 0 | 1554 | 3371 | 97.8% (3224/3370) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4925 | 1546 | 0 | 1548 | 3377 | 96.9% (3230/3376) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4925 | 1588 | 0 | 1590 | 3335 | 95.1% (3185/3334) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4925 | 1532 | 0 | 1533 | 3392 | 96.9% (3241/3390) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4925 | 1562 | 0 | 1563 | 3362 | 95.5% (3214/3360) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4925 | 1544 | 0 | 1539 | 3386 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4925 | 1562 | 0 | 1558 | 3367 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4925 | 1569 | 0 | 1559 | 3366 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4925 | 1456 | 0 | 1452 | 3269 | 68.7% (2173/3466) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4925 | 1481 | 0 | 1471 | 3454 | 47.2% (2252/3441) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4925 | 1539 | 0 | 1533 | 3392 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4925 | 1469 | 0 | 1465 | 3460 | 39.0% (2246/3453) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4925 | 0 | 0 | 0 | 0 | n/a | n/a |

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
