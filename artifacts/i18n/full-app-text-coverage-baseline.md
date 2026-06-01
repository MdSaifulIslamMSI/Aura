# Full App Text Coverage Baseline

Generated: 2026-06-01T16:26:49.769Z
Base commit: bfe5ef003103d895651698829e911f7da23dd7ce

## Current Coverage

- Current required key count: 2834
- Production legacy lookup count: 0
- Residual production legacy literal ID count: 0
- Dynamic production i18n lookup count: 0
- Legacy inventory production stable references: 3062
- Legacy inventory unique production stable IDs: 2748

## Locale Coverage

- en: 2834.0% (100/100)
- bn: 2834.0% (100/100)
- hi: 2834.0% (100/100)
- te: 2834.0% (100/100)
- mr: 2834.0% (100/100)
- ur: 2834.0% (100/100)
- gu: 2834.0% (100/100)
- pa: 2834.0% (100/100)
- ml: 2834.0% (100/100)
- kn: 2834.0% (100/100)
- or: 2834.0% (100/100)
- as: 2834.0% (100/100)
- sa: 2834.0% (100/100)
- es: 2834.0% (100/100)
- fr: 2834.0% (100/100)
- de: 2834.0% (100/100)
- ar: 2834.0% (100/100)
- ja: 2834.0% (100/100)
- pt: 2834.0% (100/100)
- zh: 2834.0% (100/100)

## Required Locales

en, hi, bn, ur, ar, en-XA

## Catalog Paths

- app/src/i18n/messages/source/en.json
- app/src/i18n/messages/reviewed/*.json
- app/src/i18n/messages/compiled/*.json
- app/src/config/marketMessagePacks/*.js

## Dynamic Content Exclusions

- seller product titles and descriptions
- user reviews and chat messages
- support conversation bodies
- AI-generated response bodies
- database/catalog seed content
- profile names, addresses, order IDs, notes, uploaded document text

## Baseline Commands

- npm --prefix app run i18n:check: passed
- npm run scan:i18n-forbidden-endpoints: passed
- npm run test:i18n: passed
- npm --prefix app run build: passed
- npm run i18n:legacy-report: passed
- npm run i18n:inventory: passed
- npm --prefix app run audit:locale: passed

## Discovery Baseline

- Stable candidates: 1549
- High risk: 428
- Medium risk: 219
- Low risk: 902
- Dynamic exclusions: 9
- False positives / non-production exclusions: 15374
