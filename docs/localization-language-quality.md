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
- Source ICU message keys: 4694
- Stable UI scanner candidates: 425
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 43753
- Native signoff pairs tracked: 44661

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4694 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4694 | 1834 | 0 | 1838 | 2652 | 98.3% (2655/2855) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4694 | 3057 | 0 | 3044 | 1446 | 23.8% (667/1632) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4694 | 1904 | 0 | 1908 | 2786 | 96.6% (2640/2785) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4694 | 1910 | 0 | 1914 | 2780 | 97.5% (2635/2779) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4694 | 1892 | 0 | 1895 | 2639 | 97.8% (2642/2797) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4694 | 1943 | 0 | 1947 | 2747 | 97.0% (2602/2746) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4694 | 1930 | 0 | 1934 | 2760 | 97.1% (2614/2759) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4694 | 1906 | 0 | 1910 | 2784 | 97.7% (2638/2783) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4694 | 1903 | 0 | 1907 | 2787 | 96.9% (2641/2786) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4694 | 1935 | 0 | 1939 | 2755 | 94.8% (2606/2754) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4694 | 1892 | 0 | 1895 | 2799 | 96.8% (2649/2797) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4694 | 1911 | 0 | 1914 | 2780 | 95.3% (2633/2778) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4694 | 2813 | 0 | 2812 | 1882 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4694 | 2842 | 0 | 2841 | 1853 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4694 | 2813 | 0 | 2811 | 1883 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4694 | 2734 | 0 | 2732 | 1758 | 33.9% (623/1955) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4694 | 2861 | 0 | 2853 | 1841 | 16.3% (600/1828) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4694 | 2818 | 0 | 2817 | 1877 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4694 | 2844 | 0 | 2842 | 1852 | 12.2% (599/1845) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4694 | 0 | 0 | 0 | 0 | n/a | n/a |

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
