# Localization Glossary

Date: 2026-06-01

## Files

- `app/src/i18n/glossary/marketplace-glossary.json`
- `app/src/i18n/glossary/brand-terms.json`
- `app/src/i18n/glossary/forbidden-transliterations.json`

## Rules

`Aura` and `Aura Points` are brand terms. They must not be translated or
transliterated. `OTP` is an approved technical term and remains unchanged.

Marketplace concepts such as cart, checkout, seller, and refund include
descriptions, contexts, and approved foundation translations for `hi`, `bn`,
`ur`, and `ar`.

## Review Workflow

1. Add or change the English ICU message with a semantic ID and description.
2. Update the glossary when a domain term, brand term, or forbidden
   transliteration changes.
3. Run `npm --prefix app run i18n:check`.
4. Review warnings for compact labels manually before release.
