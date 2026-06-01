# Localization Legacy Migration Plan

Date: 2026-06-01

## Completed Stable-Literal Migration

The complete pre-migration inventory is committed under `artifacts/i18n/` and
generated with:

```sh
npm run i18n:inventory
```

Latest inventory:

- Source files scanned: 336
- Tracked localization files: 85
- Production files with stable literals: 54
- Production stable-literal references: 3,064
- Unique production stable IDs: 2,748
- Dynamic lookup references held for review: 0
- Runtime enum compatibility references: 1
- Dynamic runtime-content files: 18
- Legacy pack internal files: 21
- Unresolved English defaults: 0

The stable UI registry now routes reviewed literals through
`useStableIcuMessages()`. Finite computed UI keys have been converted into
explicit ICU calls, so they now generate descriptors and reviewed catalog
entries like ordinary stable UI copy.

## Residual Compatibility Inventory

Run:

```sh
npm run i18n:legacy-report
```

Latest local report:

- Files represented in the compatibility report: 86
- Production files with direct residual stable literals: 0
- Residual production legacy literal IDs: 0
- Computed translator lookup files: 0
- Runtime enum compatibility files: 1
- Dynamic runtime-content files: 18
- Legacy pack import files: 21
- Delegated stable-ICU files: 2
- Test-only residual literal probes: 4

The four residual literals are `MarketContext.test.jsx` runtime-fallback
probes. They are deliberately outside production code. The one runtime enum
compatibility file is `app/src/utils/enumLocalization.js`, which formats
backend enum values through reviewed prefixes and humanized fallbacks.

## Remaining Review Work

1. Review the human-translation queue by locale and product priority.
2. Keep runtime enum values and backend/user-authored content outside stable
   UI catalogs.
3. Retire compatibility packs only after non-reviewed locale behavior has a
   replacement.

## Runtime Translation Boundary

Runtime translation must not be used for stable UI copy. It remains reserved
for backend-supplied and user-authored content and is disabled/noop by default
in production. See `docs/localization-dynamic-exclusions.md`.
