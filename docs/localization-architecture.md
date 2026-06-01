# Localization Architecture

Date: 2026-06-01

## Current Shape

Aura separates reviewed stable interface copy from runtime content. Stable
literal UI messages route through FormatJS ICU catalogs. Legacy market packs
remain compatibility inputs for computed keys and non-reviewed locales only.

| Layer | Responsibility | Primary files |
| --- | --- | --- |
| Market selection | Country, browse currency, language, locale, and direction | `app/src/context/MarketContext.jsx`, `app/src/config/marketConfig.js` |
| Stable UI registry | Generated descriptors for reviewed literal interface copy | `app/src/i18n/messages/stableUiMessages.js` |
| Stable UI adapter | Formats registered ICU messages and delegates unknown computed keys | `app/src/i18n/useStableIcuMessages.js` |
| Reviewed ICU catalog | Translator-reviewed stable copy with plural, date, and number semantics | `app/src/i18n/messages/reviewed/*.json` |
| Compiled ICU catalog | Runtime-ready FormatJS catalogs | `app/src/i18n/messages/compiled/*.json` |
| Legacy compatibility | Computed-key and non-reviewed-locale fallback only | `app/src/config/marketMessagePacks/*.js` |
| Dynamic translation | Optional provider-backed translation for dynamic content only | `app/src/services/runtimeTranslation.js`, `server/services/translation/` |
| QA | Generation drift, ICU compile, glossary rules, locale checks, visual and accessibility smoke | `scripts/i18n/`, `app/scripts/i18n/`, `app/e2e/locale.*.spec.js` |

## Stable Copy Policy

Stable UI literal messages belong in reviewed ICU catalogs. The generated
registry contains 2,647 migrated descriptors. The reviewed catalogs contain
2,690 messages because the curated foundation remains anchored beside the
generated migration layer.

The reviewed locales are `en`, `hi`, `bn`, `ur`, and `ar`. `en-XA` is
generated for expansion QA. `VITE_I18N_FORMATJS_ENABLED` controls reviewed
locale rollout; when disabled, migrated surfaces resolve through the English
ICU fallback.

## Dynamic Copy Policy

Runtime translation is reserved for backend-supplied and user-authored content
such as seller text, reviews, product titles, chat, notifications, and support
messages. Computed UI-key compatibility paths and runtime-content exclusions
are documented in `docs/localization-dynamic-exclusions.md`.

## Direction And Formatting

`MarketProvider` remains the owner of `document.documentElement.lang`,
`document.documentElement.dir`, browse currency, and locale-aware `Intl`
formatting. RTL locales are currently `ar` and `ur`.

## Verification

Run:

```sh
npm run i18n:inventory
npm run i18n:stable-catalogs
npm run i18n:codemod:dry-run
npm --prefix app run i18n:check
npm --prefix app run audit:locale
npm --prefix app run audit:locale:quality
npm run i18n:legacy-report
npm run test:i18n
npm --prefix app run test:e2e:locale
npm --prefix app run test:e2e:locale:a11y
```
