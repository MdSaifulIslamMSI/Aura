# Localization Worktree Separation

Date: 2026-06-01

Branch: `codex/world-class-localization-followup`

## Goal

Separate localization work from unrelated dirty security/hardening changes in
the same worktree. The localization commit must not include CSP hardening,
staging operations, AI access defaults, email webhook limiter work,
recommendation auth handling, scanner evidence, or desktop signing changes.

## Staged For Localization

These files are localization-only or intentionally part of the i18n migration:

- `.github/workflows/localization-quality.yml`
- `.gitignore`
- `app/e2e/locale.accessibility.spec.js`
- `app/e2e/locale.visual.spec.js`
- `app/eslint.config.js`
- `app/package-lock.json`
- `app/package.json`
- `app/playwright.locale-qa.config.js`
- `app/scripts/generate_market_message_packs.mjs`
- `app/scripts/generate_market_messages.mjs`
- `app/scripts/i18n/*.mjs`
- `app/scripts/run_locale_accessibility_qa.mjs`
- `app/scripts/run_locale_visual_qa.mjs`
- `app/src/App.jsx`
- `app/src/components/features/chat/ProductCardInline.jsx`
- `app/src/components/features/chat/ProductCardInline.test.jsx`
- `app/src/config/marketConfig.js`
- `app/src/config/runtimeTranslationPolicy.js`
- `app/src/config/runtimeTranslationPolicy.test.js`
- `app/src/context/MarketContext.jsx`
- `app/src/context/MarketContext.test.jsx`
- `app/src/i18n/**`
- `app/src/pages/Cart/index.jsx`
- `app/src/pages/Checkout/components/StepPayment.jsx`
- `app/src/pages/Checkout/components/StepPayment.test.jsx`
- `app/src/pages/Checkout/components/StepReview.jsx`
- `app/src/pages/Login/LoginView.jsx`
- `app/src/pages/Orders/Orders.test.jsx`
- `app/src/pages/Orders/index.jsx`
- `app/src/services/runtimeTranslation.js`
- `app/translation-coverage.csv`
- `app/translation-quality.csv`
- `config/environments/development.example.env`
- `config/environments/production.example.env`
- `config/environments/staging.example.env`
- `docs/localization-*.md`
- `package.json` localization hunks only
- `scripts/i18n/*.mjs`
- `server/middleware/i18nTranslationPolicy.js`
- `server/routes/i18nRoutes.js`
- `server/services/i18n/translationService.js`
- `server/services/translation/**`
- `server/tests/i18nRateLimitPolicy.test.js`
- `server/tests/i18nTranslationPolicy.test.js`
- `server/tests/translationPrivacy.test.js`
- `server/tests/translationService.test.js`

## Intentionally Left Unstaged

These files are existing security, CSP, staging, AI, webhook, desktop signing,
or recommendation-auth work and are not part of the localization commit:

- `.github/workflows/staging-ops-watch.yml`
- `SECURITY_ARCHITECTURE_REVIEW.md`
- `app/config/vercelRoutingContract.mjs`
- `app/index.html`
- `app/src/components/layout/Navbar/Navbar.test.jsx`
- `app/src/components/layout/Navbar/index.jsx`
- `app/src/config/cspPolicy.test.js`
- `app/src/pages/Home/index.jsx`
- `app/src/services/api/recommendationApi.js`
- `app/src/services/api/recommendationApi.test.js`
- `app/vercel.json`
- `app/vite.config.js`
- `docs/security/risk-register.md`
- `docs/staging-operations-upgrades.md`
- `infra/aws/docker-compose.ec2.yml`
- `netlify.toml`
- `scripts/security-free-scanners.mjs`
- `scripts/security-harness-check.mjs`
- `server/routes/aiRoutes.js`
- `server/routes/emailWebhookRoutes.js`
- `server/scripts/audit_production_hardening_contract.js`
- `server/tests/aiRateLimitPolicy.test.js`
- `server/tests/emailWebhookRateLimitPolicy.test.js`
- `server/tests/emailWebhookRoutes.test.js`
- `vercel.json`

## Ambiguous Decisions

- `package.json`: stage only i18n scripts and focused i18n test expansion. Leave
  desktop signing/update verification hardening unstaged.
- `.gitignore`: stage `artifacts/` and `**/test-results/` ignores because
  localization QA emits those paths.
- Environment examples: stage only i18n runtime/provider defaults.
- `server/routes/i18nRoutes.js`: stage because it is the i18n route limiter and
  auth policy for runtime translation.

## Verification Run So Far

- `python C:\Users\mdsai\.codex_new\skills\project-bootstrap\scripts\bootstrap_repo.py ... --no-agents-body`: passed.
- `npm --prefix app run i18n:check`: passed with 26 ICU messages and 0 warnings.
- `npm run i18n:legacy-report`: passed, reporting 86 files with remaining legacy usage.
- `npm run test:i18n`: passed, including 18 backend tests and 34 frontend focused tests.

## Remaining Risk

The largest risk is accidental staging of adjacent security work in mixed files.
The mitigation is exact-path staging plus a partial-stage check for
`package.json`, followed by `git diff --cached --name-only` and
`git diff --cached` review before commit.
