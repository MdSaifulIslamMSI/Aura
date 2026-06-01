# Localization Architecture

Date: 2026-06-01

## Current Shape

Aura now has an additive localization architecture. Existing market behavior is
preserved while reviewed ICU catalogs are introduced beside the legacy message
packs.

| Layer | Responsibility | Primary files |
| --- | --- | --- |
| Market selection | Country, browse currency, language, locale, and direction | `app/src/context/MarketContext.jsx`, `app/src/config/marketConfig.js` |
| Legacy catalog | Existing broad UI coverage during migration | `app/src/config/marketMessagePacks/*.js` |
| Reviewed ICU catalog | Translator-reviewed stable copy with plural, date, and number semantics | `app/src/i18n/messages/reviewed/*.json` |
| Compiled ICU catalog | Runtime-ready FormatJS catalogs | `app/src/i18n/messages/compiled/*.json` |
| Dynamic translation | Optional provider-backed translation for dynamic content only | `app/src/services/runtimeTranslation.js`, `server/services/translation/` |
| QA | Extraction, ICU compile, glossary rules, locale checks, visual and accessibility smoke | `app/scripts/i18n/`, `app/e2e/locale.*.spec.js` |

## Stable Copy Policy

Stable navigation, checkout, authentication, error, and accessibility copy
belongs in reviewed ICU catalogs. New ICU messages use semantic IDs and
descriptions in `app/src/i18n/messages/criticalMessages.js`.

The first reviewed foundation covers `en`, `hi`, `bn`, `ur`, and `ar`.
`en-XA` is generated for expansion QA. The broad legacy packs remain active
until their call sites migrate incrementally.

Batch A has started that migration for critical checkout, cart, auth, payment,
and order status labels. The remaining legacy surface is tracked by
`npm run i18n:legacy-report`, with artifacts written under `artifacts/i18n/`.

## Dynamic Copy Policy

Runtime translation is reserved for dynamic content such as seller text,
reviews, product titles, chat, and support messages. Stable UI runtime fallback
is disabled unless the explicit legacy switch is enabled.

## Direction And Formatting

`MarketProvider` remains the owner of `document.documentElement.lang`,
`document.documentElement.dir`, browse currency, and locale-aware `Intl`
formatting. RTL locales are currently `ar` and `ur`.

## Verification

Run:

```sh
npm --prefix app run i18n:check
npm --prefix app run audit:locale
npm --prefix app run audit:locale:quality
npm run i18n:legacy-report
npm run test:i18n
npm --prefix app run test:e2e:locale
npm --prefix app run test:e2e:locale:a11y
```
