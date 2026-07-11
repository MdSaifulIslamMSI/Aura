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
- Source ICU message keys: 4522
- Stable UI scanner candidates: 425
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 39844
- Native signoff pairs tracked: 45302

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4522 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4522 | 1621 | 0 | 1628 | 2690 | 98.0% (2693/2894) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4522 | 2850 | 0 | 2844 | 1474 | 23.1% (670/1665) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4522 | 1691 | 0 | 1698 | 2824 | 96.4% (2678/2824) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4522 | 1697 | 0 | 1704 | 2818 | 97.5% (2673/2818) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4522 | 1679 | 0 | 1685 | 2677 | 97.7% (2680/2836) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4522 | 1730 | 0 | 1737 | 2785 | 96.8% (2640/2785) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4522 | 1717 | 0 | 1724 | 2798 | 97.0% (2652/2798) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4522 | 1693 | 0 | 1700 | 2822 | 97.5% (2676/2822) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4522 | 1690 | 0 | 1697 | 2825 | 96.7% (2679/2825) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4522 | 1722 | 0 | 1729 | 2793 | 94.9% (2644/2793) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4522 | 1679 | 0 | 1685 | 2837 | 96.7% (2687/2836) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4522 | 1698 | 0 | 1704 | 2818 | 95.1% (2671/2817) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4522 | 2603 | 0 | 2605 | 1917 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4522 | 2658 | 0 | 2660 | 1862 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4522 | 2629 | 0 | 2630 | 1892 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4522 | 2523 | 0 | 2524 | 1794 | 32.9% (626/1992) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4522 | 2650 | 0 | 2645 | 1877 | 15.8% (603/1865) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4522 | 2609 | 0 | 2611 | 1911 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4522 | 2633 | 0 | 2634 | 1888 | 11.8% (602/1882) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4522 | 0 | 0 | 0 | 0 | n/a | n/a |

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
