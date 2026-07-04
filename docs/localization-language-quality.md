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
- Source ICU message keys: 4483
- Stable UI scanner candidates: 422
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 4
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 39263
- Native signoff pairs tracked: 45290

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4483 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | FAIL | NOT_FINAL | translation-repair-required | 4483 | 1629 | 0 | 1636 | 2691 | 97.0% (2694/2847) | 52.2% (57/156) |
| hi | FAIL | NOT_FINAL | translation-repair-required | 4483 | 2860 | 0 | 2854 | 1473 | 22.8% (670/1616) | 47.1% (56/156) |
| te | PASS | NOT_FINAL | translation-repair-required | 4483 | 1652 | 0 | 1659 | 2824 | 96.5% (2680/2824) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4483 | 1658 | 0 | 1665 | 2818 | 97.5% (2674/2818) | n/a (0 messages) |
| ur | FAIL | NOT_FINAL | translation-repair-required | 4483 | 1644 | 0 | 1650 | 2677 | 97.8% (2678/2832) | 60.0% (56/156) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4483 | 1691 | 0 | 1698 | 2785 | 96.7% (2641/2785) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4483 | 1678 | 0 | 1685 | 2798 | 96.9% (2653/2798) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4483 | 1654 | 0 | 1661 | 2822 | 97.6% (2678/2822) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4483 | 1651 | 0 | 1658 | 2825 | 96.8% (2681/2825) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4483 | 1684 | 0 | 1691 | 2792 | 95.0% (2645/2792) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4483 | 1639 | 0 | 1645 | 2838 | 96.6% (2689/2837) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4483 | 1658 | 0 | 1664 | 2819 | 95.0% (2673/2818) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4483 | 2566 | 0 | 2568 | 1915 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4483 | 2621 | 0 | 2623 | 1860 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4483 | 2592 | 0 | 2593 | 1890 | n/a | n/a |
| ar | FAIL | NOT_FINAL | translation-repair-required | 4483 | 2533 | 0 | 2534 | 1793 | 32.6% (626/1943) | 59.0% (56/156) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4483 | 2613 | 0 | 2608 | 1875 | 15.8% (603/1863) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4483 | 2572 | 0 | 2574 | 1909 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4483 | 2596 | 0 | 2597 | 1886 | 11.8% (602/1880) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4483 | 0 | 0 | 0 | 0 | n/a | n/a |

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
