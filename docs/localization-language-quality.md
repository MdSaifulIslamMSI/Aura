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
- Source ICU message keys: 4979
- Stable UI scanner candidates: 425
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 29586
- Native signoff pairs tracked: 64243

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4979 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4979 | 1498 | 0 | 1500 | 3275 | 98.0% (3277/3478) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4979 | 1464 | 0 | 1447 | 3328 | 58.5% (2545/3512) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4979 | 1578 | 0 | 1580 | 3399 | 96.7% (3252/3398) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4979 | 1572 | 0 | 1574 | 3405 | 97.4% (3259/3404) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4979 | 1562 | 0 | 1563 | 3256 | 97.8% (3258/3414) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4979 | 1607 | 0 | 1609 | 3370 | 97.0% (3224/3369) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4979 | 1593 | 0 | 1595 | 3384 | 97.0% (3237/3383) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4979 | 1581 | 0 | 1583 | 3396 | 97.8% (3249/3395) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4979 | 1575 | 0 | 1577 | 3402 | 96.9% (3255/3401) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4979 | 1617 | 0 | 1619 | 3360 | 95.1% (3210/3359) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4979 | 1561 | 0 | 1562 | 3417 | 96.9% (3266/3415) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4979 | 1591 | 0 | 1592 | 3387 | 95.5% (3239/3385) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4979 | 1573 | 0 | 1568 | 3411 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4979 | 1592 | 0 | 1588 | 3391 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4979 | 1599 | 0 | 1589 | 3390 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4979 | 1485 | 0 | 1481 | 3294 | 69.1% (2199/3491) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4979 | 1511 | 0 | 1501 | 3478 | 47.6% (2277/3465) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4979 | 1569 | 0 | 1563 | 3416 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4979 | 1499 | 0 | 1495 | 3484 | 39.4% (2271/3477) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4979 | 0 | 0 | 0 | 0 | n/a | n/a |

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
