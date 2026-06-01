# Localization Dynamic Exclusions

## Purpose

Stable user-interface copy now routes through reviewed FormatJS ICU descriptors. Runtime content stays outside the stable catalog so seller text, user text, catalog data, chat messages, notification payloads, and support conversations are never promoted into static locale files by accident.

## Explicit Compatibility Buckets

### Finite computed UI keys

The complete inventory now tracks 0 computed `t()` lookups requiring manual review. The finite UI labels previously selected from maps, enum values, or status keys have been converted into explicit ICU descriptor calls and are generated into the reviewed stable catalog.

Converted examples include:

- Delivery-window and filter labels.
- Checkout payment rail labels selected from capability data.
- Marketplace category, sort, condition, proximity, and heat labels.
- Notification type and priority labels.
- Profile payment and support priority labels.

### Runtime enum compatibility

`app/src/utils/enumLocalization.js` remains as the single runtime enum compatibility file. It formats backend-provided enum values through reviewed prefixes when a catalog entry exists, and falls back to a humanized runtime label for unknown values. This is intentionally separate from stable UI migration because backend enum value sets can grow without a frontend release.

### Dynamic runtime content

The following surfaces intentionally use runtime translation for backend-supplied or user-authored content:

- Product cards, listings, marketplace discovery, and listing detail content.
- Search suggestions and mission-control content.
- Chat messages and inline product cards.
- User notification payloads.
- Customer support threads and admin support operations.
- `MarketAutoLocalizer`, `useDynamicTranslations()`, and the runtime translation service.

### Legacy pack internals

Legacy market packs remain compatibility inputs for non-reviewed locales during the transition. They are not the source of truth for migrated stable UI literals.

## Guardrail

Run:

```sh
npm run i18n:legacy-report
```

The report fails when a production file introduces a direct stable literal that bypasses `useStableIcuMessages()`. It separately records ICU-routed literals, delegated translators, runtime enum compatibility, dynamic runtime translation files, pack internals, and test harness usage.
