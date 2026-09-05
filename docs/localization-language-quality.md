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
- Source ICU message keys: 4915
- Stable UI scanner candidates: 418
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 28953
- Native signoff pairs tracked: 63660

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4915 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4915 | 1465 | 0 | 1467 | 3244 | 98.0% (3246/3447) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4915 | 1430 | 0 | 1413 | 3298 | 58.1% (2515/3482) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4915 | 1545 | 0 | 1547 | 3368 | 96.6% (3221/3367) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4915 | 1539 | 0 | 1541 | 3374 | 97.4% (3228/3373) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4915 | 1529 | 0 | 1530 | 3225 | 97.8% (3227/3383) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4915 | 1574 | 0 | 1576 | 3339 | 97.0% (3193/3338) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4915 | 1560 | 0 | 1562 | 3353 | 97.0% (3206/3352) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4915 | 1548 | 0 | 1550 | 3365 | 97.8% (3218/3364) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4915 | 1542 | 0 | 1544 | 3371 | 96.9% (3224/3370) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4915 | 1584 | 0 | 1586 | 3329 | 95.1% (3179/3328) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4915 | 1528 | 0 | 1529 | 3386 | 96.9% (3235/3384) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4915 | 1558 | 0 | 1559 | 3356 | 95.4% (3208/3354) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4915 | 1540 | 0 | 1535 | 3380 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4915 | 1558 | 0 | 1554 | 3361 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4915 | 1565 | 0 | 1555 | 3360 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4915 | 1452 | 0 | 1448 | 3263 | 68.6% (2167/3460) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4915 | 1477 | 0 | 1467 | 3448 | 47.1% (2246/3435) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4915 | 1535 | 0 | 1529 | 3386 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4915 | 1465 | 0 | 1461 | 3454 | 38.9% (2240/3447) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4915 | 0 | 0 | 0 | 0 | n/a | n/a |

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
