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
- Source ICU message keys: 5042
- Stable UI scanner candidates: 398
- Uncovered stable UI scanner candidates: 0
- Blocking mechanical quality rows: 0
- Final native-quality rows not ready: 19
- Actionable review pairs tracked: 1066
- Native signoff pairs tracked: 89476

## Per-Language Status

| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| en | PASS | SOURCE | source | 5042 | 0 | 0 | 0 | 0 | n/a | n/a |
| bn | PASS | NOT_FINAL | translation-repair-required | 5042 | 30 | 0 | 45 | 3683 | 97.4% (4996/4997) | 96.2% (1314/1314) |
| hi | PASS | NOT_FINAL | translation-repair-required | 5042 | 28 | 0 | 43 | 3685 | 97.2% (4999/4999) | 95.5% (1314/1314) |
| te | PASS | NOT_FINAL | translation-repair-required | 5042 | 36 | 0 | 51 | 4991 | 97.1% (4991/4991) | n/a (0 messages) |
| mr | PASS | NOT_FINAL | translation-repair-required | 5042 | 32 | 0 | 47 | 4995 | 97.4% (4995/4995) | n/a (0 messages) |
| ur | PASS | NOT_FINAL | translation-repair-required | 5042 | 35 | 0 | 50 | 3678 | 98.0% (4992/4992) | 97.2% (1314/1314) |
| gu | PASS | NOT_FINAL | translation-repair-required | 5042 | 34 | 0 | 49 | 4993 | 97.2% (4993/4993) | n/a (0 messages) |
| pa | PASS | NOT_FINAL | translation-repair-required | 5042 | 33 | 0 | 48 | 4994 | 97.2% (4994/4994) | n/a (0 messages) |
| ml | PASS | NOT_FINAL | translation-repair-required | 5042 | 31 | 0 | 46 | 4996 | 97.9% (4996/4996) | n/a (0 messages) |
| kn | PASS | NOT_FINAL | translation-repair-required | 5042 | 35 | 0 | 50 | 4992 | 97.4% (4992/4992) | n/a (0 messages) |
| or | PASS | NOT_FINAL | translation-repair-required | 5042 | 34 | 0 | 49 | 4993 | 96.2% (4992/4993) | n/a (0 messages) |
| as | PASS | NOT_FINAL | translation-repair-required | 5042 | 30 | 0 | 45 | 4997 | 97.2% (4996/4997) | n/a (0 messages) |
| sa | PASS | NOT_FINAL | translation-repair-required | 5042 | 31 | 0 | 46 | 4996 | 96.6% (4993/4996) | n/a (0 messages) |
| es | PASS | NOT_FINAL | translation-repair-required | 5042 | 70 | 0 | 74 | 4968 | n/a | n/a |
| fr | PASS | NOT_FINAL | translation-repair-required | 5042 | 92 | 0 | 95 | 4947 | n/a | n/a |
| de | PASS | NOT_FINAL | translation-repair-required | 5042 | 108 | 0 | 102 | 4940 | n/a | n/a |
| ar | PASS | NOT_FINAL | translation-repair-required | 5042 | 29 | 0 | 44 | 3684 | 97.7% (4995/4998) | 96.7% (1314/1314) |
| ja | PASS | NOT_FINAL | translation-repair-required | 5042 | 36 | 0 | 51 | 4991 | 92.8% (4990/4991) | n/a (0 messages) |
| pt | PASS | NOT_FINAL | translation-repair-required | 5042 | 85 | 0 | 85 | 4957 | n/a | n/a |
| zh | PASS | NOT_FINAL | translation-repair-required | 5042 | 31 | 0 | 46 | 4996 | 94.2% (4992/4996) | n/a (0 messages) |
| en-XA | PASS | PSEUDO_LOCALE | pseudo-locale | 5042 | 0 | 0 | 0 | 0 | n/a | n/a |

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
