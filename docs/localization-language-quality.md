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
- Source ICU message keys: 4534
- Stable UI scanner candidates: 425
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 40075
- Native signoff pairs tracked: 45299

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 4534 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 4534 | 1636 | 0 | 1643 | 2687 | 98.0% (2690/2891) | 91.8% (57/204) |
| hi | PASS | NOT_FINAL | translation-repair-required | 4534 | 2865 | 0 | 2859 | 1471 | 23.0% (667/1662) | 89.5% (56/204) |
| te | PASS | NOT_FINAL | translation-repair-required | 4534 | 1706 | 0 | 1713 | 2821 | 96.4% (2675/2821) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 4534 | 1712 | 0 | 1719 | 2815 | 97.5% (2670/2815) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 4534 | 1694 | 0 | 1700 | 2674 | 97.7% (2677/2833) | 61.7% (59/160) |
| gu | PASS | NOT_FINAL | translation-repair-required | 4534 | 1745 | 0 | 1752 | 2782 | 96.8% (2637/2782) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 4534 | 1732 | 0 | 1739 | 2795 | 97.0% (2649/2795) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 4534 | 1708 | 0 | 1715 | 2819 | 97.5% (2673/2819) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 4534 | 1705 | 0 | 1712 | 2822 | 96.7% (2676/2822) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 4534 | 1737 | 0 | 1744 | 2790 | 94.9% (2641/2790) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 4534 | 1694 | 0 | 1700 | 2834 | 96.7% (2684/2833) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 4534 | 1713 | 0 | 1719 | 2815 | 95.1% (2668/2814) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 4534 | 2617 | 0 | 2619 | 1915 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 4534 | 2647 | 0 | 2649 | 1885 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 4534 | 2618 | 0 | 2619 | 1915 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 4534 | 2538 | 0 | 2539 | 1791 | 32.9% (623/1989) | 90.5% (56/204) |
| ja | PASS | NOT_FINAL | translation-repair-required | 4534 | 2665 | 0 | 2660 | 1874 | 15.7% (600/1862) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 4534 | 2623 | 0 | 2625 | 1909 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 4534 | 2648 | 0 | 2649 | 1885 | 11.7% (599/1879) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 4534 | 0 | 0 | 0 | 0 | n/a | n/a |

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
