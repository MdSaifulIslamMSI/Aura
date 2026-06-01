# Localization QA

Date: 2026-06-01

## Blocking Gates

`npm --prefix app run i18n:check` extracts source messages, generates `en-XA`,
compiles reviewed catalogs, verifies structural equality, and runs locale QA.

The QA script fails on:

- missing or empty translations
- ICU parse errors
- dropped ICU arguments or plural branches
- unsafe HTML-like content
- brand corruption or forbidden transliteration
- mojibake patterns
- invalid RTL manifest direction
- English leakage outside the allowlist

Compact-label expansion is reported as a warning for human layout review.

## Browser QA

```sh
npm --prefix app run test:e2e:locale
npm --prefix app run test:e2e:locale:a11y
```

Visual QA exercises login, marketplace, product, and review shells on desktop
and mobile. Accessibility QA runs axe against the login shell for `en-XA`,
`bn`, `hi`, `ur`, and `ar`, blocking serious and critical findings.

Generated reports live under `app/artifacts/i18n/` and `app/test-results/`.
They are local artifacts and are uploaded by `.github/workflows/localization-quality.yml`.
