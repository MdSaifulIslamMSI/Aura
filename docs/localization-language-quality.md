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
- Source ICU message keys: 4892
- Stable UI scanner candidates: 423
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 48206
- Native signoff pairs tracked: 43970

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4892 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4892 | 2073 | 0 | 2075 | 2613 | 98.1% (2615/2816) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4892 | 3259 | 0 | 3242 | 1446 | 23.9% (664/1630) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4892 | 2143 | 0 | 2145 | 2747 | 96.4% (2600/2746) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4892 | 2149 | 0 | 2151 | 2741 | 97.3% (2595/2740) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4892 | 2130 | 0 | 2131 | 2601 | 97.7% (2603/2759) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4892 | 2180 | 0 | 2182 | 2710 | 96.8% (2564/2709) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4892 | 2167 | 0 | 2169 | 2723 | 96.9% (2576/2722) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4892 | 2145 | 0 | 2147 | 2745 | 97.5% (2598/2744) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4892 | 2141 | 0 | 2143 | 2749 | 96.7% (2602/2748) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4892 | 2173 | 0 | 2175 | 2717 | 94.6% (2567/2716) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4892 | 2131 | 0 | 2132 | 2760 | 96.6% (2609/2758) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4892 | 2150 | 0 | 2151 | 2741 | 95.1% (2593/2739) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4892 | 3052 | 0 | 3049 | 1843 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4892 | 3081 | 0 | 3078 | 1814 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4892 | 3050 | 0 | 3046 | 1846 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4892 | 2973 | 0 | 2969 | 1719 | 34.4% (622/1916) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4892 | 3100 | 0 | 3090 | 1802 | 16.7% (599/1789) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4892 | 3055 | 0 | 3052 | 1840 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4892 | 3083 | 0 | 3079 | 1813 | 12.5% (598/1806) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4892 | 0 | 0 | 0 | 0 | n/a | n/a |

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
