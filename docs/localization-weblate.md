# Weblate Localization Workflow

Date: 2026-06-01

## Repository Shape

The reviewed catalogs are Weblate-ready flat JSON files:

```text
app/src/i18n/messages/reviewed/en.json
app/src/i18n/messages/reviewed/hi.json
app/src/i18n/messages/reviewed/bn.json
app/src/i18n/messages/reviewed/ur.json
app/src/i18n/messages/reviewed/ar.json
```

Use `en.json` as the source component. Treat reviewed locale files as the
translation targets. Do not edit `compiled/*.json` manually; generate them with
`npm --prefix app run i18n:compile`.

## Translator Inputs

Share:

- `docs/localization-glossary.md`
- `app/src/i18n/glossary/marketplace-glossary.json`
- `app/src/i18n/glossary/brand-terms.json`
- `app/src/i18n/glossary/forbidden-transliterations.json`

## Pull Request Gate

After Weblate opens a pull request, run:

```sh
npm --prefix app run i18n:check
npm --prefix app run test:e2e:locale
npm --prefix app run test:e2e:locale:a11y
```

Weblate service provisioning and credentials are intentionally outside this
repository. Configure them through the deployment owner, not committed files.
