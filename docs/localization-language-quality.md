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
- Source ICU message keys: 4908
- Stable UI scanner candidates: 417
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 28897
- Native signoff pairs tracked: 63583

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4908 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4908 | 1462 | 0 | 1464 | 3240 | 98.0% (3242/3443) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4908 | 1428 | 0 | 1411 | 3293 | 58.1% (2512/3477) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4908 | 1542 | 0 | 1544 | 3364 | 96.6% (3217/3363) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4908 | 1536 | 0 | 1538 | 3370 | 97.4% (3224/3369) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4908 | 1526 | 0 | 1527 | 3221 | 97.8% (3223/3379) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4908 | 1571 | 0 | 1573 | 3335 | 97.0% (3189/3334) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4908 | 1557 | 0 | 1559 | 3349 | 97.0% (3202/3348) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4908 | 1545 | 0 | 1547 | 3361 | 97.8% (3214/3360) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4908 | 1539 | 0 | 1541 | 3367 | 96.9% (3220/3366) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4908 | 1581 | 0 | 1583 | 3325 | 95.1% (3175/3324) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4908 | 1525 | 0 | 1526 | 3382 | 96.9% (3231/3380) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4908 | 1555 | 0 | 1556 | 3352 | 95.5% (3204/3350) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4908 | 1537 | 0 | 1532 | 3376 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4908 | 1555 | 0 | 1551 | 3357 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4908 | 1562 | 0 | 1552 | 3356 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4908 | 1449 | 0 | 1445 | 3259 | 68.5% (2163/3456) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4908 | 1474 | 0 | 1464 | 3444 | 47.0% (2242/3431) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4908 | 1532 | 0 | 1526 | 3382 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4908 | 1462 | 0 | 1458 | 3450 | 38.9% (2236/3443) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4908 | 0 | 0 | 0 | 0 | n/a | n/a |

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
