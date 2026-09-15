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
- Source ICU message keys: 4944
- Stable UI scanner candidates: 418
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 29409
- Native signoff pairs tracked: 63755

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4944 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4944 | 1489 | 0 | 1491 | 3249 | 98.0% (3251/3452) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4944 | 1454 | 0 | 1437 | 3303 | 58.2% (2520/3487) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4944 | 1569 | 0 | 1571 | 3373 | 96.7% (3226/3372) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4944 | 1563 | 0 | 1565 | 3379 | 97.4% (3233/3378) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4944 | 1553 | 0 | 1554 | 3230 | 97.8% (3232/3388) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4944 | 1598 | 0 | 1600 | 3344 | 97.0% (3198/3343) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4944 | 1584 | 0 | 1586 | 3358 | 97.0% (3211/3357) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4944 | 1572 | 0 | 1574 | 3370 | 97.8% (3223/3369) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4944 | 1566 | 0 | 1568 | 3376 | 96.9% (3229/3375) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4944 | 1608 | 0 | 1610 | 3334 | 95.1% (3184/3333) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4944 | 1552 | 0 | 1553 | 3391 | 96.9% (3240/3389) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4944 | 1582 | 0 | 1583 | 3361 | 95.5% (3213/3359) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4944 | 1564 | 0 | 1559 | 3385 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4944 | 1582 | 0 | 1578 | 3366 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4944 | 1589 | 0 | 1579 | 3365 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4944 | 1476 | 0 | 1472 | 3268 | 68.7% (2173/3465) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4944 | 1501 | 0 | 1491 | 3453 | 47.2% (2252/3440) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4944 | 1559 | 0 | 1553 | 3391 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4944 | 1489 | 0 | 1485 | 3459 | 39.0% (2246/3452) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4944 | 0 | 0 | 0 | 0 | n/a | n/a |

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
