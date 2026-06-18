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
- Source ICU message keys: 4421
- Stable UI scanner candidates: 422
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 38218
- Native signoff pairs tracked: 45185

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4421 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4421 | 1574 | 0 | 1581 | 2691 | 98.1% (2694/2840) | 97.2% (57/149) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4421 | 2805 | 0 | 2799 | 1473 | 23.2% (670/1609) | 96.5% (56/149) |
| te | PASS | NOT_FINAL | translation-repair-required | 4421 | 1597 | 0 | 1604 | 2817 | 97.7% (2680/2817) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4421 | 1603 | 0 | 1610 | 2811 | 98.7% (2674/2811) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4421 | 1589 | 0 | 1595 | 2677 | 98.6% (2678/2825) | 97.9% (56/149) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4421 | 1636 | 0 | 1643 | 2778 | 97.9% (2641/2778) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4421 | 1623 | 0 | 1630 | 2791 | 98.1% (2653/2791) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4421 | 1599 | 0 | 1606 | 2815 | 98.6% (2678/2815) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4421 | 1596 | 0 | 1603 | 2818 | 97.8% (2681/2818) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4421 | 1629 | 0 | 1636 | 2785 | 96.1% (2645/2785) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4421 | 1584 | 0 | 1590 | 2831 | 97.7% (2689/2830) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4421 | 1603 | 0 | 1609 | 2812 | 96.1% (2673/2811) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4421 | 2511 | 0 | 2513 | 1908 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4421 | 2566 | 0 | 2568 | 1853 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4421 | 2537 | 0 | 2538 | 1883 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4421 | 2478 | 0 | 2479 | 1793 | 33.1% (626/1936) | 97.8% (56/149) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4421 | 2558 | 0 | 2553 | 1868 | 16.0% (603/1856) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4421 | 2517 | 0 | 2519 | 1902 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4421 | 2541 | 0 | 2542 | 1879 | 12.0% (602/1873) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4421 | 0 | 0 | 0 | 0 | n/a | n/a |

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
