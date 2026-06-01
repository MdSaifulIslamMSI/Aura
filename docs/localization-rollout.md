# Localization Rollout

Date: 2026-06-01

## Safe Rollout Sequence

1. Keep all new i18n feature flags disabled in production.
2. Run ICU extraction, compilation, legacy locale audits, focused tests, and
   browser QA in pull requests.
3. Migrate stable UI call sites by risk: authentication, checkout, navigation,
   errors, accessibility labels, then lower-risk surfaces.
4. Enable `VITE_I18N_FORMATJS_ENABLED` in staging after reviewed catalogs cover
   the migrated surfaces.
5. Use `en-XA`, `ar`, and `ur` in staging QA for expansion and direction checks.
6. Enable production FormatJS only after staging evidence is reviewed.
7. Consider dynamic provider enablement separately. Keep provider `noop` until
   privacy, cost, capacity, and operational ownership are approved.

## Rollback

Disable `VITE_I18N_FORMATJS_ENABLED` to return migrated surfaces to English ICU
fallback behavior. Disable `I18N_RUNTIME_TRANSLATION_ENABLED` to force dynamic
translation to `noop`. Neither rollback changes market selection, browse
currency, or direction handling.

## Remaining Migration Work

The broad legacy JavaScript packs remain the active source for most existing UI
copy. Continue migrating call sites in small reviewed batches. Do not delete
legacy packs until coverage and browser evidence show they are unused.
