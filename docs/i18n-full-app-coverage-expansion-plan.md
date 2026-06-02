# Full App ICU Text Coverage Expansion Review Guide

Generated for branch `codex/i18n-expand-full-app-text-coverage`.

## Final PR Snapshot

- Required ICU message keys: 3970
- Required locale-message pairs: 83370
- Locale coverage: 100% across required ICU keys
- Stable UI scanner candidates: 416
- Uncovered stable UI scanner candidates: 0
- Production legacy lookup count: 0
- Residual production legacy literal ID count: 0
- Dynamic production i18n lookup count: 0
- Forbidden i18n endpoint scan: passed
- Focused i18n tests: passed
- Frontend production build: passed
- Outperformance gate: passed
- Final native-quality gate: not passed yet; native signoff remains tracked work

## Reviewer Map

Start with these files:

- `docs/localization-language-quality.md`: mechanical gate, final-quality status, and native-review debt.
- `docs/localization-human-review-queue.md`: grouped repair debt and native signoff debt.
- `docs/localization-human-review-triage.md`: priority order for remaining native review.
- `scripts/i18n/discover-stable-ui-text.mjs`: scanner and classification logic.
- `scripts/i18n/assert-language-quality.mjs`: locale quality gate.
- `scripts/i18n/assert-i18n-outperformance.mjs`: legacy-vs-new outperformance proof.
- `app/src/i18n/messages/stableUiMessages.js`: generated stable UI descriptors.
- `app/src/i18n/messages/staticCoverageMessages.js`: static coverage descriptors.

Treat these as deterministic machine artifacts rather than primary review text:

- `app/src/i18n/messages/compiled/*.json`
- `app/src/i18n/quality/humanReviewQueue.json`
- `app/src/i18n/quality/nativeReviewAudit.json`

## Scanner Trust Calibration

The scanner intentionally over-collects first, then filters:

- non-visible JSX attribute expressions such as `className`
- route/API/CSS/id/class-like tokens
- lowercase enum/status tokens such as method codes
- time-unit and unit labels such as `10s`, `ms`, `px`
- generated ICU catalogs and generated market message packs
- broad backend runtime code outside email/template surfaces

The final guard run has 416 stable UI candidates and 0 uncovered stable UI candidates.

## What Makes This Better Than The Legacy Layer

- Stable UI copy is pulled into deterministic ICU catalogs instead of runtime translation.
- The reviewed ICU layer now has 3970 source keys across 21 locales, compared with the legacy 2949-key, 20-locale layer.
- Locale-message coverage expands from 58980 legacy pairs to 83370 reviewed ICU pairs.
- Stable UI discovery is enforceable in CI, so new uncovered high-risk text becomes a failing condition.
- English fallback and native signoff debt is explicit, counted, and grouped instead of hidden.

## Verification Commands

- `npm --prefix app run i18n:check`
- `npm run scan:i18n-forbidden-endpoints`
- `npm run test:i18n`
- `npm run i18n:discover-text:check`
- `npm run i18n:language-quality`
- `npm run i18n:human-review-summary`
- `npm run i18n:outperform`
- `npm --prefix app run build`

## Review Queue

Every non-English entry that still uses an English fallback is tracked in `app/src/i18n/quality/humanReviewQueue.json`. Structurally valid promoted translations that still need native linguistic signoff are tracked in `app/src/i18n/quality/nativeReviewAudit.json`.

This PR is a major architecture and coverage improvement, not a claim that every locale is final native-quality. Final native certification remains gated by `npm run i18n:language-quality -- --final`.
