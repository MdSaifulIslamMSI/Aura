# Localization Legacy Migration Plan

Date: 2026-06-01

## Completed Stable-Literal Migration

The complete pre-migration inventory is committed under `artifacts/i18n/` and
generated with:

```sh
npm run i18n:inventory
```

Baseline inventory:

- Source files scanned: 333
- Tracked localization files: 85
- Production files with stable literals: 54
- Production stable-literal references: 2,936
- Unique production stable IDs: 2,647
- Dynamic lookup references held for review: 32
- Dynamic runtime-content files: 18
- Legacy pack internal files: 21
- Unresolved English defaults: 0

The stable UI registry now routes reviewed literals through
`useStableIcuMessages()`. Unknown computed IDs delegate to the legacy
translator so compatibility behavior remains intact.

## Residual Compatibility Inventory

Run:

```sh
npm run i18n:legacy-report
```

Latest local report:

- Files represented in the compatibility report: 86
- Production files with direct residual stable literals: 0
- Computed translator lookup files: 28
- Dynamic runtime-content files: 18
- Legacy pack import files: 21
- Delegated stable-ICU files: 2
- Test-only residual literal probes: 4

The four residual literals are `MarketContext.test.jsx` runtime-fallback
probes. They are deliberately outside production code.

## Remaining Review Work

1. Review the human-translation queue by locale and product priority.
2. Convert finite computed-key maps into explicit ICU descriptor maps.
3. Retire compatibility packs only after computed lookups reach zero and
   non-reviewed locale behavior has a replacement.

## Runtime Translation Boundary

Runtime translation must not be used for stable UI copy. It remains reserved
for backend-supplied and user-authored content and is disabled/noop by default
in production. See `docs/localization-dynamic-exclusions.md`.
