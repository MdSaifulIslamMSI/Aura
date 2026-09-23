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
- Source ICU message keys: 4960
- Stable UI scanner candidates: 425
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 29466
- Native signoff pairs tracked: 64002

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4960 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4960 | 1492 | 0 | 1494 | 3262 | 98.0% (3264/3465) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4960 | 1457 | 0 | 1440 | 3316 | 58.3% (2533/3500) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4960 | 1572 | 0 | 1574 | 3386 | 96.6% (3239/3385) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4960 | 1566 | 0 | 1568 | 3392 | 97.4% (3246/3391) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4960 | 1556 | 0 | 1557 | 3243 | 97.8% (3245/3401) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4960 | 1601 | 0 | 1603 | 3357 | 97.0% (3211/3356) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4960 | 1587 | 0 | 1589 | 3371 | 97.0% (3224/3370) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4960 | 1575 | 0 | 1577 | 3383 | 97.8% (3236/3382) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4960 | 1569 | 0 | 1571 | 3389 | 96.9% (3242/3388) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4960 | 1611 | 0 | 1613 | 3347 | 95.1% (3197/3346) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4960 | 1555 | 0 | 1556 | 3404 | 96.9% (3253/3402) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4960 | 1585 | 0 | 1586 | 3374 | 95.5% (3226/3372) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4960 | 1567 | 0 | 1562 | 3398 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4960 | 1585 | 0 | 1581 | 3379 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4960 | 1592 | 0 | 1582 | 3378 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4960 | 1479 | 0 | 1475 | 3281 | 68.9% (2186/3478) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4960 | 1504 | 0 | 1494 | 3466 | 47.4% (2265/3453) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4960 | 1562 | 0 | 1556 | 3404 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4960 | 1492 | 0 | 1488 | 3472 | 39.2% (2259/3465) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4960 | 0 | 0 | 0 | 0 | n/a | n/a |

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
