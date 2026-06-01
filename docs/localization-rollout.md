# Localization Rollout

Date: 2026-06-01

## Safe Rollout Sequence

1. Keep new i18n feature flags disabled in production until staging evidence is
   reviewed.
2. Run catalog generation, ICU checks, legacy locale audits, focused tests, and
   browser QA in pull requests.
3. Review the staged human-translation queue. Generated English fallback
   entries remain visible as QA warnings until a translator approves them.
4. Enable `VITE_I18N_FORMATJS_ENABLED` in staging.
5. Use `en-XA`, `ar`, and `ur` in staging QA for expansion and direction checks.
6. Enable production FormatJS only after staging evidence is reviewed.
7. Consider dynamic provider enablement separately. Keep provider `noop` until
   privacy, cost, capacity, and operational ownership are approved.

## Completed Stable Migration

Literal UI copy has migrated to reviewed ICU descriptors. Legacy JavaScript
packs remain compatibility inputs for computed UI keys and non-reviewed locales
only. `npm run i18n:legacy-report` fails when production code adds a direct
stable literal bypass.

The dynamic-content boundary is documented in
`docs/localization-dynamic-exclusions.md`. Do not delete the compatibility packs
until the computed-key inventory reaches zero and non-reviewed locale behavior
has a replacement.

## Rollback

Disable `VITE_I18N_FORMATJS_ENABLED` to return migrated surfaces to English ICU
fallback behavior. Disable `I18N_RUNTIME_TRANSLATION_ENABLED` to force dynamic
translation to `noop`. Neither rollback changes market selection, browse
currency, or direction handling.
