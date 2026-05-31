# Code Quality Baseline

Baseline date: 2026-05-31.

## Must fix before merge

- Secret leaks.
- Critical dependency or infrastructure vulnerabilities.
- Blocking ESLint security rules.
- Test or build failures.
- Workflow syntax failures.

## Recorded legacy backlog

- ESLint now parses JavaScript and JSX. The non-blocking report currently surfaces 51 existing `react-hooks/exhaustive-deps` warnings. Review these in focused UI reliability PRs because changing hook dependencies can alter runtime behavior.
- Knip is in report mode. The first baseline reports existing unused-file, dependency, export, alias-resolution, and unlisted-binary findings. Review dynamic imports, aliases, tests, and workflow usage before cleanup.
- The app contains generated locale packs. Knip excludes those large generated sources from static cleanup analysis.
- This repository has TS and TSX compatibility files but no `tsconfig.json`. `quality:typecheck` reports that state honestly instead of pretending ESLint is compiler type checking.
- Push-gate backend LCOV uses the curated server regression tracer. Exhaustive `npm --prefix server run test:coverage` remains available for manual investigation because instrumenting every Mongo-backed server suite in one local process is too resource-heavy for a reliable every-push gate.
- `quality:all` and the quality workflow execute the regression suites once through `quality:coverage`; that command both tests the code and writes LCOV. `quality:test` remains available for a faster non-instrumented local check.
- `server/tests/authProfileVault.test.js` contains one deterministic test-only vault key with a rule-specific Semgrep suppression. It is not a runtime credential.

## Review cadence

Review the baseline monthly and after large feature migrations. Move one finding class at a time from report-only to blocking once the baseline is clean.
