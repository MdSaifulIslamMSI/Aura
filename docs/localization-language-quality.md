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
- Source ICU message keys: 4969
- Stable UI scanner candidates: 424
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 29561
- Native signoff pairs tracked: 64078

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4969 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4969 | 1497 | 0 | 1499 | 3266 | 98.0% (3268/3469) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4969 | 1462 | 0 | 1445 | 3320 | 58.4% (2537/3504) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4969 | 1577 | 0 | 1579 | 3390 | 96.6% (3243/3389) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4969 | 1571 | 0 | 1573 | 3396 | 97.4% (3250/3395) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4969 | 1561 | 0 | 1562 | 3247 | 97.8% (3249/3405) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4969 | 1606 | 0 | 1608 | 3361 | 97.0% (3215/3360) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4969 | 1592 | 0 | 1594 | 3375 | 97.0% (3228/3374) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4969 | 1580 | 0 | 1582 | 3387 | 97.8% (3240/3386) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4969 | 1574 | 0 | 1576 | 3393 | 96.9% (3246/3392) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4969 | 1616 | 0 | 1618 | 3351 | 95.1% (3201/3350) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4969 | 1560 | 0 | 1561 | 3408 | 96.9% (3257/3406) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4969 | 1590 | 0 | 1591 | 3378 | 95.5% (3230/3376) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4969 | 1572 | 0 | 1567 | 3402 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4969 | 1590 | 0 | 1586 | 3383 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4969 | 1597 | 0 | 1587 | 3382 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4969 | 1484 | 0 | 1480 | 3285 | 68.9% (2190/3482) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4969 | 1509 | 0 | 1499 | 3470 | 47.5% (2269/3457) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4969 | 1567 | 0 | 1561 | 3408 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4969 | 1497 | 0 | 1493 | 3476 | 39.3% (2263/3469) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4969 | 0 | 0 | 0 | 0 | n/a | n/a |

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
