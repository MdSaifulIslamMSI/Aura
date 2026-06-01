# Localization Inventory

Date: 2026-06-01

Status: Inventory baseline captured before the additive ICU migration. See
`docs/localization-architecture.md` for the implemented architecture. The
current working tree already contains unrelated uncommitted security/auth
changes, so branch switching and pull/merge operations should wait until those
changes are isolated.

## Executive Assessment

Aura already has a serious market shell: country, language, currency, locale,
direction, browse FX, generated locale packs, locale coverage audits, locale
quality audits, and Playwright visual locale checks.

It is not yet a production-grade localization pipeline in the strict sense. The
current message layer is custom JavaScript objects plus `{{token}}` replacement,
not ICU/FormatJS. Stable UI copy can still fall back to runtime machine
translation when keys are missing. Dynamic content translation and UI fallback
translation share the same runtime translation service. The server production
path directly calls an unofficial Google Translate endpoint.

The implemented path is incremental: preserve `MarketProvider`, keep the
existing market behavior, add a FormatJS/ICU message layer beside it, gate
runtime translation behind explicit flags, and harden `/api/i18n/translate`
before allowing any non-noop provider in production.

## Current Market Layer

Primary files:

- `app/src/config/marketConfig.js`
- `app/src/context/MarketContext.jsx`
- `app/src/utils/format.js`
- `app/src/services/marketRuntime.js`
- `server/services/markets/marketCatalog.js`
- `server/middleware/marketContextMiddleware.js`

Current behavior:

- Default market is India with `en`, `INR`, and an `en-IN` style runtime locale.
- Supported market state includes country, language, currency, locale, and
  direction.
- `MarketProvider` persists preferences in `aura_market_preferences_v1`.
- `MarketProvider` sets `document.documentElement.lang`, `dir`,
  `data-market-country`, `data-market-currency`, and `data-market-language`.
- Market headers are synchronized through `setActiveMarketHeaders`.
- Formatting helpers use `Intl.NumberFormat`, `Intl.DateTimeFormat`, and
  `Intl.DisplayNames`.
- Browse prices can convert from the INR catalog base currency using cached or
  live FX rates.

Risk notes:

- Market logic and message fallback logic currently live in the same provider.
  The target architecture should keep market selection in `MarketProvider` and
  move ICU message resolution into a dedicated locale/message provider.
- Several native labels in `marketConfig.js` render as mojibake in the current
  source view, for example Indic and Arabic native labels. Locale QA should
  explicitly detect replacement characters and mojibake patterns.

## Current Message Layer

Primary files:

- `app/src/config/marketConfig.js`
- `app/src/config/marketMessagePacks/*.js`
- `app/src/config/generatedMarketMessages.js`
- `app/src/config/generatedLocaleMessages.js`
- `app/src/config/generatedDynamicLocaleMessages.js`
- `app/src/config/priorityMarketMessages.js`
- `app/src/config/remainingUiLocaleMessages.js`
- `app/src/config/localePolishMessages.js`

Current supported message pack files:

- `ar`, `as`, `bn`, `de`, `en`, `es`, `fr`, `gu`, `hi`, `ja`, `kn`, `ml`,
  `mr`, `or`, `pa`, `pt`, `sa`, `te`, `ur`, `zh`

Current behavior:

- English messages are the runtime fallback source.
- Locale packs are JavaScript modules exported from
  `app/src/config/marketMessagePacks`.
- Locale packs are lazy-loaded with `import.meta.glob`.
- Translation call sites use the custom `t(key, values, fallback)` function from
  `MarketProvider`.
- Interpolation uses `{{token}}` replacement through `formatMessageTemplate`.
- There is no current `react-intl`, `@formatjs/cli`, `eslint-plugin-formatjs`,
  compiled message catalog, or ICU syntax enforcement.

Risk notes:

- `{{token}}` interpolation cannot validate plurals, selects, rich text
  placeholders, or dropped variables like ICU/FormatJS can.
- Because English fallback text is accepted at call sites, missing reviewed
  locale messages can be hidden until runtime.
- Existing generated packs are impressive in breadth, but they are not clearly
  review-controlled with glossary, translation memory, translator notes, or
  Weblate-ready source/reviewed/compiled separation.

## Runtime Translation Layer

Frontend files:

- `app/src/services/runtimeTranslation.js`
- `app/src/services/api/i18nApi.js`
- `app/src/hooks/useDynamicTranslations.js`
- `app/src/components/shared/MarketAutoLocalizer.jsx`

Known frontend runtime translation call sites:

- `app/src/context/MarketContext.jsx`
- `app/src/context/NotificationContext.jsx`
- `app/src/components/features/product/ProductCard/index.jsx`
- `app/src/components/features/chat/ProductCardInline.jsx`
- `app/src/components/shared/GlobalSearchBar.jsx`
- `app/src/pages/Admin/Dashboard.jsx`
- `app/src/pages/Admin/Support.jsx`
- `app/src/pages/ListingDetail/index.jsx`
- `app/src/pages/Marketplace/index.jsx`
- `app/src/pages/MissionControl/index.jsx`
- `app/src/pages/ProductDetails/index.jsx`
- `app/src/pages/Profile/components/SupportSection.jsx`
- `app/src/pages/TradeIn/index.jsx`

Current behavior:

- `runtimeTranslation.js` filters obvious non-translatable strings such as URLs,
  email addresses, API-looking paths, symbol-only values, identifiers, and code
  tokens.
- It persists client cache entries under `aura_runtime_translation_cache_v2`.
- It caps persisted translations to 500 entries per language.
- It deduplicates batches and falls back to original text on failure.
- `useDynamicTranslations` is the intended hook for product/listing/search/chat
  style dynamic content.
- `MarketContext` currently queues runtime translation for missing stable message
  templates after locale packs have loaded.
- `MarketAutoLocalizer` can scan raw DOM text and attributes and send them to
  runtime translation. It is present and tested, but it is not mounted in
  `app/src/main.jsx` or `app/src/App.jsx` in the current tree.

Risk notes:

- Runtime translation is currently able to serve stable UI fallback copy. The
  target policy should allow it only for dynamic content such as product titles,
  seller text, reviews, chat, support messages, and user-generated content.
- `MarketAutoLocalizer`, if enabled in production, would be too broad for stable
  UI copy because it mutates DOM text and attributes outside the reviewed
  message catalog.
- Client-side filtering is useful but not a privacy boundary. Server-side PII
  redaction and provider policy are still required.

## Server Translation Endpoint

Primary files:

- `server/routes/i18nRoutes.js`
- `server/controllers/i18nController.js`
- `server/validators/i18nValidators.js`
- `server/services/i18n/translationService.js`

Current behavior:

- `POST /api/i18n/translate` accepts `texts`, `language`, and
  `sourceLanguage`.
- Zod validation enforces 1 to 50 text values and 800 characters per text.
- The controller calls `translateTexts` directly.
- `translationService.js` caches in memory for six hours and deduplicates
  inflight requests.
- Translation concurrency is capped at 6.
- Translation failures return the original source text.

Risk notes:

- Production code hardcodes
  `https://translate.googleapis.com/translate_a/single`.
- There is no provider abstraction or no-op production default.
- Cache keys include raw normalized text.
- Logs include `textPreview` on upstream failure.
- There is no server-side PII redaction before provider calls.
- There is no i18n route-specific limiter today; the endpoint is covered by the
  global limiter when not skipped, but heavy usage needs a dedicated route policy
  with stricter anonymous limits and optional auth for batch usage.
- There is no circuit breaker around a provider beyond ordinary failure fallback.

## Existing Locale QA

Existing scripts:

- `npm --prefix app run audit:locale`
- `npm --prefix app run audit:locale:quality`
- `npm --prefix app run test:e2e:locale`

Primary files:

- `app/scripts/check_locale_coverage.mjs`
- `app/scripts/check_locale_quality.mjs`
- `app/scripts/run_locale_visual_qa.mjs`
- `app/playwright.locale-qa.config.js`
- `app/e2e/locale.visual.spec.js`
- `.github/workflows/ci.yml`

Current behavior:

- Coverage audit scans literal `t('key', ...)` usage and verifies locale pack
  presence.
- Quality audit checks missing keys, exact-English fallback ratio, and native
  script share for many locales.
- Visual locale QA covers login, marketplace, product detail, and product review
  shells.
- Visual QA checks direction and horizontal overflow for desktop and mobile
  projects.
- CI already runs locale coverage and locale quality audits.

Missing quality gates relative to the target:

- ICU parse/compile validation.
- Placeholder preservation for ICU variables.
- Plural/select branch validation.
- Glossary and brand-term validation.
- Forbidden transliteration checks.
- Pseudolocale expansion checks.
- Raw message ID detection in browser flows.
- English leakage with explicit allowlists.
- Mojibake detection with fail criteria.
- Runtime translation provider policy checks.
- Forbidden endpoint scan for production code.
- Accessibility scans for localized routes.

## Existing Tests

Frontend tests already covering localization behavior:

- `app/src/config/marketMessagesCoverage.test.js`
- `app/src/context/MarketContext.test.jsx`
- `app/src/hooks/useDynamicTranslations.test.js`
- `app/src/services/runtimeTranslation.test.js`
- `app/src/services/api/i18nApi.test.js`
- `app/src/components/shared/MarketAutoLocalizer.test.jsx`

Server tests already covering translation behavior:

- `server/tests/translationService.test.js`

Coverage strengths:

- Existing tests cover client cache hydration, translation request dedupe,
  dynamic-text filtering, locale coverage, document direction updates, and
  server translation cache behavior.

Coverage gaps:

- No tests for provider selection flags.
- No tests for no-op provider production default.
- No tests for PII redaction/restoration.
- No tests for route-specific i18n limiter behavior.
- No tests for heavy anonymous usage denial.
- No tests proving stable UI copy cannot call runtime translation.
- No tests for ICU syntax, plural rules, or dropped variables.
- No tests for glossary/brand-term corruption.
- No tests for forbidden production endpoint usage.

## Current CI Surface

Existing CI references:

- `.github/workflows/ci.yml` runs app locale coverage and locale quality audits.

Missing CI gates relative to the target:

- Dedicated localization workflow.
- FormatJS extract/compile/check.
- Locale QA report artifacts.
- Pseudo locale generation/check.
- Playwright localization smoke as a named CI job.
- Axe/accessibility localization smoke.
- Forbidden endpoint scan.
- Provider configuration audit.

## Recommended Migration Path

1. Preserve `MarketProvider` as the market/country/currency/locale source.
2. Add explicit environment flags before behavior changes:
   `I18N_FORMATJS_ENABLED`, `I18N_RUNTIME_TRANSLATION_ENABLED`,
   `I18N_TRANSLATION_PROVIDER`, `I18N_TRANSLATION_CACHE_ENABLED`,
   `I18N_TRANSLATION_REQUIRE_AUTH_FOR_HEAVY_USAGE`, and
   `I18N_PSEUDO_LOCALE_ENABLED`.
3. Add a dedicated FormatJS locale provider that can read locale from
   `MarketProvider` and fall back to English.
4. Create `app/src/i18n` with source, reviewed, compiled, glossary, and quality
   subdirectories.
5. Add `i18n:extract`, `i18n:compile`, `i18n:qa`, `i18n:pseudo`, and
   `i18n:check` scripts.
6. Start by migrating high-risk stable UI copy: checkout/payment, auth/security,
   cart/order, then navigation.
7. Keep dynamic content translation through `useDynamicTranslations`, but forbid
   runtime translation from stable UI paths.
8. Replace `server/services/i18n/translationService.js` with a provider-backed
   runtime translation service. Default provider should be `noop` unless a
   reviewed provider is explicitly enabled.
9. Add server-side PII redaction, normalized-hash cache keys, provider timeout,
   circuit breaker, and route-specific limiter.
10. Add glossary and locale QA gates before trusting migrated locale packs.
11. Add pseudolocale and RTL visual checks to catch layout regressions.
12. Add a forbidden endpoint scan that fails if production code calls
    `translate.googleapis.com/translate_a/single`.

## Safe Next Slice

The smallest safe implementation slice is:

1. Add i18n environment flag parsing without changing default behavior.
2. Add a server translation provider abstraction with `noop` and `mock`
   providers.
3. Move the current Google implementation behind a non-default legacy provider
   or remove it from production code entirely.
4. Add tests proving production defaults to no-op and does not call the
   unofficial endpoint.
5. Add a forbidden endpoint scan script in report-only mode first, then make it
   strict once the provider migration lands.

This keeps the app behavior rollback-safe while removing the most material
privacy and abuse risk first.
