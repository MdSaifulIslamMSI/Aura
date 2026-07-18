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
- Source ICU message keys: 4612
- Stable UI scanner candidates: 425
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 42157
- Native signoff pairs tracked: 44699

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4612 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4612 | 1750 | 0 | 1754 | 2654 | 98.3% (2656/2857) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4612 | 2973 | 0 | 2960 | 1448 | 23.8% (667/1634) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4612 | 1820 | 0 | 1824 | 2788 | 96.7% (2641/2787) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4612 | 1826 | 0 | 1830 | 2782 | 97.6% (2636/2781) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4612 | 1808 | 0 | 1811 | 2641 | 97.9% (2643/2799) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4612 | 1859 | 0 | 1863 | 2749 | 97.1% (2603/2748) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4612 | 1846 | 0 | 1850 | 2762 | 97.2% (2615/2761) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4612 | 1822 | 0 | 1826 | 2786 | 97.7% (2639/2785) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4612 | 1819 | 0 | 1823 | 2789 | 97.0% (2642/2788) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4612 | 1851 | 0 | 1855 | 2757 | 94.9% (2607/2756) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4612 | 1808 | 0 | 1811 | 2801 | 96.8% (2650/2799) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4612 | 1827 | 0 | 1830 | 2782 | 95.4% (2634/2780) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4612 | 2729 | 0 | 2728 | 1884 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4612 | 2758 | 0 | 2757 | 1855 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4612 | 2729 | 0 | 2727 | 1885 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4612 | 2650 | 0 | 2648 | 1760 | 33.9% (623/1957) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4612 | 2777 | 0 | 2769 | 1843 | 16.3% (600/1830) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4612 | 2734 | 0 | 2733 | 1879 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4612 | 2760 | 0 | 2758 | 1854 | 12.2% (599/1847) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4612 | 0 | 0 | 0 | 0 | n/a | n/a |

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
