# Localization Dynamic Exclusions

## Purpose

Stable user-interface copy now routes through reviewed FormatJS ICU descriptors. Runtime content stays outside the stable catalog so seller text, user text, catalog data, chat messages, notification payloads, and support conversations are never promoted into static locale files by accident.

## Explicit Compatibility Buckets

### Computed UI keys

The complete inventory tracks 32 computed `t()` lookups. These calls select finite UI labels from maps, enum values, or status keys. `useStableIcuMessages()` delegates an ID that has no static descriptor to the legacy translator so these paths remain functional while they are converted to explicit descriptor maps in later review passes.

Examples include:

- Delivery-window and filter labels.
- Checkout payment rail labels selected from capability data.
- Marketplace category, sort, condition, proximity, and heat labels.
- Notification type and priority labels.
- Profile payment and support priority labels.
- Shared enum localization helpers.

### Dynamic runtime content

The following surfaces intentionally use runtime translation for backend-supplied or user-authored content:

- Product cards, listings, marketplace discovery, and listing detail content.
- Search suggestions and mission-control content.
- Chat messages and inline product cards.
- User notification payloads.
- Customer support threads and admin support operations.
- `MarketAutoLocalizer`, `useDynamicTranslations()`, and the runtime translation service.

### Legacy pack internals

Legacy market packs remain compatibility inputs for computed UI keys and non-reviewed locales during the transition. They are not the source of truth for migrated stable UI literals.

## Guardrail

Run:

```sh
npm run i18n:legacy-report
```

The report fails when a production file introduces a direct stable literal that bypasses `useStableIcuMessages()`. It separately records ICU-routed literals, delegated translators, computed-key compatibility paths, dynamic runtime translation files, pack internals, and test harness usage.

