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
- Source ICU message keys: 4375
- Stable UI scanner candidates: 419
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 37384
- Native signoff pairs tracked: 45145

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4375 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4375 | 1528 | 0 | 1535 | 2691 | 98.1% (2694/2840) | 97.2% (57/149) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4375 | 2764 | 0 | 2758 | 1468 | 23.4% (670/1604) | 96.5% (56/149) |
| te | PASS | NOT_FINAL | translation-repair-required | 4375 | 1551 | 0 | 1558 | 2817 | 97.7% (2680/2817) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4375 | 1557 | 0 | 1564 | 2811 | 98.7% (2674/2811) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4375 | 1543 | 0 | 1549 | 2677 | 98.6% (2678/2825) | 97.9% (56/149) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4375 | 1590 | 0 | 1597 | 2778 | 97.9% (2641/2778) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4375 | 1577 | 0 | 1584 | 2791 | 98.1% (2653/2791) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4375 | 1553 | 0 | 1560 | 2815 | 98.6% (2678/2815) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4375 | 1550 | 0 | 1557 | 2818 | 97.8% (2681/2818) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4375 | 1583 | 0 | 1590 | 2785 | 96.1% (2645/2785) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4375 | 1538 | 0 | 1544 | 2831 | 97.7% (2689/2830) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4375 | 1557 | 0 | 1563 | 2812 | 96.1% (2673/2811) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4375 | 2470 | 0 | 2472 | 1903 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4375 | 2525 | 0 | 2527 | 1848 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4375 | 2496 | 0 | 2497 | 1878 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4375 | 2437 | 0 | 2438 | 1788 | 33.5% (626/1931) | 97.8% (56/149) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4375 | 2517 | 0 | 2512 | 1863 | 16.1% (603/1851) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4375 | 2476 | 0 | 2478 | 1897 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4375 | 2500 | 0 | 2501 | 1874 | 12.1% (602/1868) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4375 | 0 | 0 | 0 | 0 | n/a | n/a |

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
