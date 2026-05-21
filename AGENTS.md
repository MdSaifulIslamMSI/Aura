# Global Codex Instructions

## Codex Desktop Renderer Safety

Never emit raw Codex Desktop git/action directives in assistant-visible text, final answers, summaries, comments, or markdown. Use normal shell commands, tool calls, or plain prose instead. If diagnosing a renderer crash, describe these as "desktop git/action directives" and avoid reproducing the literal directive prefix.

For every coding, debugging, refactoring, review, CI, deployment, or production-change task, use the `karpathy-guidelines` skill when it is available.

If the skill is not visible in the current session, still follow its core rules:
- Surface assumptions and tradeoffs before acting when the task is ambiguous.
- Keep changes surgical and directly tied to the user's request.
- Prefer the simplest implementation that solves the real problem.
- Avoid speculative abstractions, unrelated refactors, and adjacent formatting churn.
- Define verification clearly, then run the smallest meaningful tests/build/browser checks.
- Mention unrelated issues instead of editing them unless explicitly asked.

## Always-On Conducty Workflow

For every substantial coding, debugging, refactoring, review, CI, deployment, production-change, multi-step planning, or agent-coordination task, use the `conducty-codex` workflow when available.

Default behavior:
- Resolve the Conducty vault first; use `$env:CONDUCTY_VAULT` when set.
- Shape goals with appetite, no-go zones, acceptance criteria, and verification.
- Create or update a plan for non-trivial work.
- Run one tracer before broad or parallel execution.
- Log prompt outcomes, checkpoints, and improvements when the task has durable learning value.
- Keep tiny one-off answers lightweight; do not add ceremony when there is nothing to remember.

## Always-On Project Bootstrap

For any new, unfamiliar, messy, nested, or un-onboarded repository, use the `project-bootstrap` skill when it is available.

Default behavior:
- Detect the real project root before editing.
- Map stack, source roots, manifests, tests, build commands, generated files, secret surfaces, and deployment/config risk.
- Create or update `AGENTS.md` when the user asks to make the repo Codex-ready.
- Prefer a dry-run bootstrap report before writing files.
- Add or recommend one local doctor command for repeatable before/after health checks.
- Keep tiny one-off questions lightweight; use this workflow when repo context needs to be established or improved.

# Project Agent Instructions

## Project Map

- Work from `C:\Users\mdsai\Downloads\Kimi_Agent_Flipkart-Style Frontend`.
- Root stack: Node workspace/orchestrator with npm scripts for backend, frontend, desktop, mobile, security, and deployment workflows.
- `app/`: React + Vite frontend, Vitest tests, Playwright E2E, Capacitor mobile shell.
- `server/`: Node API/runtime, Jest tests, data/catalog/search/assistant scripts, migrations, smoke tests.
- `desktop/`: Electron desktop runtime and tests.
- `gateway/`: gateway/proxy surface.
- `infra/`: deployment and cloud automation, including AWS scripts.
- `.github/workflows/`, `netlify.toml`, `vercel.json`, `.netlify/`, `.vercel/`: CI and hosting configuration.
- `scripts/`: repo-level automation and validation scripts.
- `tests/`: auth/security test documentation and generated test planning material.
- `docs/`, `security-reports/`, `SECURITY_*.md`: architecture, security, and operational documentation.

Generated, dependency, or local-only surfaces:
- `node_modules/`, `app/node_modules/`
- `app/dist/`
- `desktop-release/`
- `generated/`
- `output/`
- `.run-logs/`
- `*.log`, `hs_err_pid*.log`, `replay_pid*.log`

Risk-sensitive surfaces:
- `.env.local`
- `.student-pack.local.env`
- `app/.env`, `app/.env.local`
- `server/.env*`, especially `server/.env.aws-secrets`
- Auth, payment, security, deployment, migration, catalog purge, and production smoke scripts.

## Core Commands

Install root dependencies:

```sh
npm install
```

Run the root regression tracer:

```sh
npm test
```

Build the frontend through the root script:

```sh
npm run build
```

Run the frontend directly:

```sh
npm --prefix app run dev
npm --prefix app run build
npm --prefix app test
npm --prefix app run lint
npm --prefix app run test:e2e
```

Run the backend directly:

```sh
npm --prefix server test
npm --prefix server test -- --runTestsByPath tests/<name>.test.js
```

Useful local health checks:

```sh
npm run ci:doctor
npm run backend:doctor
npm --prefix app run backend:doctor
```

Local infrastructure toggles:

```sh
npm run dev:on
npm run dev:off
npm run dev:off:force
```

## Tracer-First Workflow

- Before broad edits, run or identify the narrowest command that exercises the touched surface.
- If the tracer fails before changes, preserve the exact command and failure in the response.
- Change one meaningful thing at a time.
- Prefer package scripts over ad hoc commands.
- Use focused tests before full builds unless the touched area is shared or deployment-facing.

## Verification Ladder

- Instruction-only changes: re-run the project-bootstrap dry run, inspect `AGENTS.md`, and confirm referenced scripts exist.
- Frontend behavior: run targeted Vitest tests, then `npm --prefix app run build` for broad UI/config changes.
- Frontend E2E or visual flows: run the relevant Playwright test or browser smoke check.
- Backend behavior: run `npm --prefix server test -- --runTestsByPath ...` for touched tests; use `npm --prefix server test` for shared backend changes.
- Auth/security/payment changes: run the closest `security:*` or `test:auth:*` script and mention any skipped live checks.
- Deployment/config changes: run dry-run or validation scripts such as `npm run ci:doctor`, `npm run observability:validate`, or host-specific sync checks before proposing deploys.
- Desktop changes: run the narrow desktop runtime test/build command before packaging.
- Mobile changes: run `npm run mobile:doctor` or the relevant Capacitor sync command only when native/mobile surfaces are touched.

## No-Go Zones

- Do not edit secrets, credentials, private keys, tokens, or env files unless explicitly requested.
- Do not run purge, wipe, reset, migration, production smoke, live auth, deploy, or cloud activation commands without explicit confirmation.
- Do not alter auth, billing, payments, production deployment, public APIs, migrations, or data-retention behavior casually.
- Do not edit generated output, build artifacts, logs, dependency folders, or crash dumps unless the task is specifically about those files.
- Do not overwrite user changes in the working tree. Treat unrelated dirty files as user-owned.

## Style Notes

- Keep changes surgical and match existing patterns.
- Prefer structured parsers and existing helper APIs over brittle string edits.
- Avoid unrelated formatting churn.
- Add comments only where they clarify non-obvious behavior.
- For frontend work, reuse existing UI patterns, tokens, components, and test utilities before adding new ones.
- For security-sensitive work, state assumptions and residual risk clearly.

## Definition Of Done

- The change directly solves the user request.
- The diff is scoped to relevant files.
- Existing project patterns are followed.
- The smallest meaningful verification has run.
- Any skipped verification or remaining risk is stated clearly.
