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
- Source ICU message keys: 4922
- Stable UI scanner candidates: 418
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 29029
- Native signoff pairs tracked: 63717

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4922 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4922 | 1469 | 0 | 1471 | 3247 | 98.0% (3249/3450) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4922 | 1434 | 0 | 1417 | 3301 | 58.1% (2518/3485) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4922 | 1549 | 0 | 1551 | 3371 | 96.7% (3224/3370) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4922 | 1543 | 0 | 1545 | 3377 | 97.4% (3231/3376) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4922 | 1533 | 0 | 1534 | 3228 | 97.8% (3230/3386) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4922 | 1578 | 0 | 1580 | 3342 | 97.0% (3196/3341) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4922 | 1564 | 0 | 1566 | 3356 | 97.0% (3209/3355) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4922 | 1552 | 0 | 1554 | 3368 | 97.8% (3221/3367) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4922 | 1546 | 0 | 1548 | 3374 | 96.9% (3227/3373) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4922 | 1588 | 0 | 1590 | 3332 | 95.1% (3182/3331) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4922 | 1532 | 0 | 1533 | 3389 | 96.9% (3238/3387) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4922 | 1562 | 0 | 1563 | 3359 | 95.5% (3211/3357) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4922 | 1544 | 0 | 1539 | 3383 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4922 | 1562 | 0 | 1558 | 3364 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4922 | 1569 | 0 | 1559 | 3363 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4922 | 1456 | 0 | 1452 | 3266 | 68.6% (2170/3463) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4922 | 1481 | 0 | 1471 | 3451 | 47.1% (2249/3438) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4922 | 1539 | 0 | 1533 | 3389 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4922 | 1469 | 0 | 1465 | 3457 | 39.0% (2243/3450) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4922 | 0 | 0 | 0 | 0 | n/a | n/a |

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
