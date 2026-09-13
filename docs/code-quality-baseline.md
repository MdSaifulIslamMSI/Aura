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
- The PQC Semgrep lane (`security/semgrep/pqc-crypto-policy.yml`) mirrors the expiring exceptions in `config/security/pqc-allowlist.json`: `server/services/productImageResolver.js`, `server/services/catalogArtworkService.js`, and the two i18n stable-id scripts carry `// nosemgrep: nodejs-sha1` comments, and `server/services/listingService.js` carries `// nosemgrep: nodejs-md5`. Each hash is a deterministic identifier/correlation value, not a security primitive; the node-side allowlist entries (owner: maintainer, expires 2026-12-31) remain the canonical record. Deliberate bad-example fixtures under `tests/fixtures/security/pqc/` and the policy surfaces themselves are excluded from the PQC rules at the rule level (`paths.exclude`) because they are the scanner's own test corpus.

## Review cadence

Review the baseline monthly and after large feature migrations. Move one finding class at a time from report-only to blocking once the baseline is clean.
