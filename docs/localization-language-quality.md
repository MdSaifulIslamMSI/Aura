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
- Source ICU message keys: 4742
- Stable UI scanner candidates: 425
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 45047
- Native signoff pairs tracked: 44279

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4742 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4742 | 1906 | 0 | 1908 | 2630 | 98.1% (2632/2833) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4742 | 3106 | 0 | 3089 | 1449 | 23.8% (667/1633) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4742 | 1976 | 0 | 1978 | 2764 | 96.5% (2617/2763) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4742 | 1982 | 0 | 1984 | 2758 | 97.3% (2612/2757) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4742 | 1963 | 0 | 1964 | 2618 | 97.7% (2620/2776) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4742 | 2013 | 0 | 2015 | 2727 | 96.8% (2581/2726) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4742 | 2000 | 0 | 2002 | 2740 | 96.9% (2593/2739) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4742 | 1978 | 0 | 1980 | 2762 | 97.5% (2615/2761) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4742 | 1974 | 0 | 1976 | 2766 | 96.7% (2619/2765) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4742 | 2006 | 0 | 2008 | 2734 | 94.7% (2584/2733) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4742 | 1964 | 0 | 1965 | 2777 | 96.6% (2626/2775) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4742 | 1983 | 0 | 1984 | 2758 | 95.1% (2610/2756) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4742 | 2885 | 0 | 2882 | 1860 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4742 | 2914 | 0 | 2911 | 1831 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4742 | 2883 | 0 | 2879 | 1863 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4742 | 2806 | 0 | 2802 | 1736 | 34.1% (622/1933) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4742 | 2933 | 0 | 2923 | 1819 | 16.5% (599/1806) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4742 | 2888 | 0 | 2885 | 1857 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4742 | 2916 | 0 | 2912 | 1830 | 12.3% (598/1823) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4742 | 0 | 0 | 0 | 0 | n/a | n/a |

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
