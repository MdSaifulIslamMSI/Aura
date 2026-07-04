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
- Source ICU message keys: 4513
- Stable UI scanner candidates: 422
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 39670
- Native signoff pairs tracked: 45305

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4513 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4513 | 1611 | 0 | 1618 | 2691 | 98.0% (2694/2895) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4513 | 2842 | 0 | 2836 | 1473 | 23.1% (670/1664) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4513 | 1681 | 0 | 1688 | 2825 | 96.6% (2680/2825) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4513 | 1687 | 0 | 1694 | 2819 | 97.5% (2674/2819) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4513 | 1670 | 0 | 1676 | 2677 | 97.8% (2681/2836) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4513 | 1720 | 0 | 1727 | 2786 | 96.8% (2641/2786) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4513 | 1707 | 0 | 1714 | 2799 | 97.0% (2653/2799) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4513 | 1683 | 0 | 1690 | 2823 | 97.7% (2678/2823) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4513 | 1680 | 0 | 1687 | 2826 | 96.8% (2681/2826) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4513 | 1713 | 0 | 1720 | 2793 | 95.1% (2645/2793) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4513 | 1668 | 0 | 1674 | 2839 | 96.7% (2689/2838) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4513 | 1687 | 0 | 1693 | 2820 | 95.0% (2673/2819) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4513 | 2595 | 0 | 2597 | 1916 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4513 | 2650 | 0 | 2652 | 1861 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4513 | 2621 | 0 | 2622 | 1891 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4513 | 2515 | 0 | 2516 | 1793 | 33.0% (626/1991) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4513 | 2642 | 0 | 2637 | 1876 | 15.8% (603/1864) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4513 | 2601 | 0 | 2603 | 1910 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4513 | 2625 | 0 | 2626 | 1887 | 11.8% (602/1881) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4513 | 0 | 0 | 0 | 0 | n/a | n/a |

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
