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
- Actionable review pairs tracked: 42195
- Native signoff pairs tracked: 44661

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4612 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4612 | 1752 | 0 | 1756 | 2652 | 98.3% (2656/2855) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4612 | 2975 | 0 | 2962 | 1446 | 23.8% (667/1632) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4612 | 1822 | 0 | 1826 | 2786 | 96.7% (2641/2785) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4612 | 1828 | 0 | 1832 | 2780 | 97.6% (2636/2779) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4612 | 1810 | 0 | 1813 | 2639 | 97.9% (2643/2797) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4612 | 1861 | 0 | 1865 | 2747 | 97.1% (2603/2746) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4612 | 1848 | 0 | 1852 | 2760 | 97.2% (2615/2759) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4612 | 1824 | 0 | 1828 | 2784 | 97.7% (2639/2783) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4612 | 1821 | 0 | 1825 | 2787 | 97.0% (2642/2786) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4612 | 1853 | 0 | 1857 | 2755 | 94.9% (2607/2754) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4612 | 1810 | 0 | 1813 | 2799 | 96.8% (2650/2797) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4612 | 1829 | 0 | 1832 | 2780 | 95.4% (2634/2778) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4612 | 2731 | 0 | 2730 | 1882 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4612 | 2760 | 0 | 2759 | 1853 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4612 | 2731 | 0 | 2729 | 1883 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4612 | 2652 | 0 | 2650 | 1758 | 33.9% (623/1955) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4612 | 2779 | 0 | 2771 | 1841 | 16.3% (600/1828) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4612 | 2736 | 0 | 2735 | 1877 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4612 | 2762 | 0 | 2760 | 1852 | 12.2% (599/1845) | n/a (0 messages) |
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
