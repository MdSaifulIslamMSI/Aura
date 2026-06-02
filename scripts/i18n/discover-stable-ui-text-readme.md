# Stable UI Text Discovery Scanner

`npm run i18n:discover-text` finds user-visible strings that are not obviously routed through ICU/FormatJS.

The scanner uses Babel AST parsing for JavaScript, JSX, TypeScript, and TSX. HTML and selected JSON files use a narrow static scanner. It classifies each hit before migration:

- stable UI text
- stable accessibility text
- stable validation/toast text
- stable static/SEO/template text
- dynamic user/seller/catalog/support/AI content
- developer/test-only text
- existing ICU/FormatJS text
- false positives

Outputs:

- `artifacts/i18n/discovered-stable-ui-text.json`
- `artifacts/i18n/discovered-stable-ui-text.md`
- `artifacts/i18n/discovered-dynamic-content-exclusions.json`
- `artifacts/i18n/discovered-false-positives.json`

Guard mode:

`npm run i18n:discover-text:check` fails when unallowlisted high-risk stable UI, accessibility, toast, or validation strings are found. Medium and low-risk hits are reported for review unless the CI threshold is tightened later.

Allowlist rules:

- Prefer fixing or localizing real stable UI text.
- Add an allowlist entry only when the text is dynamic, developer-only, test-only, static metadata without locale support, or a proven false positive.
- Every allowlist entry needs the exact file, exact text when practical, classification, and reason.
