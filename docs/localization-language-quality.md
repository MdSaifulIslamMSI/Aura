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
- Source ICU message keys: 4913
- Stable UI scanner candidates: 417
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 28896
- Native signoff pairs tracked: 63679

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4913 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4913 | 1462 | 0 | 1464 | 3245 | 98.0% (3247/3448) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4913 | 1427 | 0 | 1410 | 3299 | 58.1% (2516/3483) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4913 | 1542 | 0 | 1544 | 3369 | 96.6% (3222/3368) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4913 | 1536 | 0 | 1538 | 3375 | 97.4% (3229/3374) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4913 | 1526 | 0 | 1527 | 3226 | 97.8% (3228/3384) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4913 | 1571 | 0 | 1573 | 3340 | 97.0% (3194/3339) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4913 | 1557 | 0 | 1559 | 3354 | 97.0% (3207/3353) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4913 | 1545 | 0 | 1547 | 3366 | 97.8% (3219/3365) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4913 | 1539 | 0 | 1541 | 3372 | 96.9% (3225/3371) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4913 | 1581 | 0 | 1583 | 3330 | 95.1% (3180/3329) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4913 | 1525 | 0 | 1526 | 3387 | 96.9% (3236/3385) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4913 | 1555 | 0 | 1556 | 3357 | 95.5% (3209/3355) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4913 | 1537 | 0 | 1532 | 3381 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4913 | 1555 | 0 | 1551 | 3362 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4913 | 1562 | 0 | 1552 | 3361 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4913 | 1449 | 0 | 1445 | 3264 | 68.6% (2168/3461) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4913 | 1474 | 0 | 1464 | 3449 | 47.1% (2247/3436) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4913 | 1532 | 0 | 1526 | 3387 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4913 | 1462 | 0 | 1458 | 3455 | 38.9% (2241/3448) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4913 | 0 | 0 | 0 | 0 | n/a | n/a |

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
