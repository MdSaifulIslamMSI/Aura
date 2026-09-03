# 0004: Tiered test execution with regression as CI gate

Status: Accepted

## Context

The server suite is large (`config/test-tiers.json` lists hundreds of suites),
so running everything on every signal is slow and untargeted. Previously,
hand-maintained `--runTestsByPath` lists drifted between `package.json`
scripts and CI workflows. The manifest's `$comment` declares it the single
source of truth, consumed by `scripts/run-test-tier.cjs` and
`server/tests/setup.js`.

## Decision

- Run tests by tier from the manifest: `regression` is the CI gate
  (`npm test` → `test:server:regression` → `run-test-tier.cjs server
  regression --forceExit`); narrower tiers (`performance-cache`,
  `money-minor`, `staging-cors`, `traffic-budget`, `noDbFiles`) serve
  targeted signals.
- Suites deliberately outside CI live in the `$untriaged` allowlist.
- `scripts/check-test-tiers.cjs` (`npm run test:tiers:check`) enforces the
  manifest: it fails on stale entries, suites invisible to Jest's
  `**/*.test.js` `testMatch`, hardcoded `--runTestsByPath` lists in
  workflows, and any suite in neither a tier nor `$untriaged`.

## Consequences

- New test files must be triaged explicitly (tiered for CI or allowlisted as
  untriaged) or the guard fails.
- Test file lists live only in `config/test-tiers.json`; workflows and
  scripts resolve tiers instead of naming files.
- Removing a suite requires removing its manifest entry, and vice versa.
