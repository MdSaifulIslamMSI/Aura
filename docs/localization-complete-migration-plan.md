# Complete Legacy UI ICU Migration Plan

## Goal

Move stable user-interface copy from legacy market-pack `t()` lookup calls into reviewed FormatJS ICU catalogs while preserving runtime translation for dynamic seller, user, catalog, chat, notification, and support content.

## Appetite

One controlled pull request with focused commits. Keep the existing market-formatting architecture, legacy locale packs, dynamic translation service, authentication behavior, security controls, CSP, and deployment contracts intact.

## No-Go Zones

- Do not route dynamic user-generated or backend-supplied content into the reviewed static UI catalog.
- Do not change authentication, payment, billing, CSP, production environment, or deployment behavior as part of this migration.
- Do not delete legacy packs until the post-migration compatibility report proves they are no longer needed.
- Do not auto-rewrite computed `t()` keys. Track and review them explicitly.

## Migration Buckets

1. Stable UI literals: migrate to the reviewed ICU descriptor registry and locale catalogs.
2. Computed UI keys: keep as explicit manual-review exclusions until converted to finite descriptor maps.
3. Dynamic runtime content: keep on `useDynamicTranslations()` or the runtime translation service.
4. Legacy pack internals: retain as compatibility inputs during the transition.
5. Test harness literals: track separately and migrate only where the production API changes require it.

## Verification

1. Generate the full inventory and confirm zero parse errors and zero unresolved English defaults.
2. Run the codemod in dry-run mode, inspect skips, then apply the reviewed migration.
3. Run ICU extraction, pseudo-locale generation, compilation, verification, and locale QA.
4. Run focused localization tests and the forbidden-endpoint scan.
5. Run frontend tests, lint, build, locale browser visual QA, and locale accessibility QA.
6. Run root regression, environment validation, CI doctor, production fallback scan, hardening audit, CSP checks, and the available security harness.
7. Push one pull request, fix direct CI failures, merge only when required checks pass, then watch the main branch checks.

