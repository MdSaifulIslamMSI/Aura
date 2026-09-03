# Contributing to Aura Marketplace

Thanks for contributing. This repo is a production commerce operating surface
(React storefront, Express API, gateways, infra) — changes must stay surgical,
fail closed, and keep every release gate green.

## Setup

Prerequisites: Node.js + npm compatible with the checked-in lockfiles, and
local MongoDB/Redis (or the repo-managed toggle below). Do not commit secrets;
copy the examples for local-only env files.

```powershell
npm install
npm --prefix app install
npm --prefix server install
Copy-Item app\.env.example app\.env
Copy-Item server\.env.example server\.env
```

Optional repo-managed local services toggle:

```powershell
npm run dev:on
```

Health check before and after changes:

```powershell
npm run ci:doctor
```

## Development workflow

- Work on a branch. `main` is protected: PR required, no direct pushes, no
  force pushes or deletions, branch must be up to date, conversations must be
  resolved, required checks must pass (see `npm run github:main-protection`).
- Change one meaningful thing at a time; prefer package scripts over ad hoc
  commands (see `AGENTS.md` for the tracer-first workflow).
- Frontend: `npm --prefix app run dev`, `npm --prefix app run build`,
  `npm --prefix app run lint`. Backend: `npm --prefix server start`.
- Match existing patterns; reuse UI tokens, components, and helper APIs
  before adding new ones. No unrelated refactors or formatting churn.

## Testing

`config/test-tiers.json` is the single source of truth for server test tiers
(server: `regression` 88, `performance-cache` 1, `money-minor` 2,
`staging-cors` 2, `traffic-budget` 2, `noDbFiles` 19, `$untriaged` 256).

```powershell
npm test                                                        # root regression tracer (CI gate)
npm --prefix server test -- --runTestsByPath tests/<name>.test.js  # focused backend test
node scripts/run-test-tier.cjs server regression --forceExit    # run a tier directly
npm run test:tiers:check                                        # manifest guard
```

Rules:

- New suites must be triaged: add them to a tier or consciously list them in
  `$untriaged`. `scripts/check-test-tiers.cjs` fails otherwise, and test file
  lists must live only in the manifest (no hardcoded `--runTestsByPath`
  lists in workflows).
- In server Jest tests, register every `jest.mock()` before `require()` calls
  (mocks are not hoisted for project files — see `docs/adr/0001-*`).
- Never print or commit secrets in tests, logs, reports, or screenshots.

## PR process

1. Keep the diff scoped to the request; every changed line should trace to it.
2. Run the smallest meaningful verification (`npm test` for server-shared
   changes, targeted Vitest + `npm --prefix app run build` for UI changes,
   `npm run ci:doctor` for deployment/config changes) and state any skipped
   verification or residual risk in the PR.
3. Open a PR against `main`; resolve all conversations and keep checks green.
4. Security-sensitive changes (auth, payments, uploads, admin, infra): run the
   closest `security:*` script and note any skipped live checks.

## Security reporting

Do not open public issues with exploit details. Report vulnerabilities
privately per `SECURITY.md` (GitHub private vulnerability reporting or a
private channel first) and give maintainers time to investigate.

## Coding standards

- Surgical changes only; match repo style; comment only non-obvious behavior.
- Fail closed on auth, secrets, environment, checkout, and release gates.
- No secrets, credentials, tokens, or private keys in code, tests, or env
  files committed to the repo. Never edit committed env files to add secrets.
- Lockfiles must validate under both npm 10 and npm 11; regenerate with the
  stricter toolchain (see `docs/adr/0003-*`).
