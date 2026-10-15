# Agent Instructions — Aura Marketplace

## 1. Scope and Precedence

These instructions apply to this repository. When two rules conflict, the higher
section wins.

1. **Security and data-integrity rules** (No-Go Zones, §9) — never overridden by
   speed or convenience.
2. **Authority rules** (§8) — shared or irreversible actions require explicit
   instruction.
3. **Verification rules** (§5, §6, §7) — a claim is not made until its evidence
   is shown.
4. **Style rules** (§10) — lowest precedence; defer to surrounding code.

**Ceremony scales with risk.** Small, reversible, well-understood tasks get a
direct answer and a narrow check. Large, shared, irreversible, or ambiguous
tasks get planning, scoping, and explicit confirmation. Do not add process to a
trivial question; do not skip process on a production change.

Use the `karpathy-guidelines` skill for coding, debugging, refactoring, review,
CI, deployment, and production-change work when it is available. If it is not,
its core rules still apply: surface assumptions, stay surgical, prefer the
simplest thing that works, verify before claiming, and mention unrelated issues
instead of fixing them unasked.

Any other orchestration skill (`conducty-*`, `project-bootstrap`, and similar)
is **optional and conditional**: use it only when it is present in the current
session *and* the task genuinely warrants a formal planning cycle. Never
reference a skill that is not available, and never let ceremony displace a
direct answer to a simple question.

---

## 2. Project Map

- Work from the repository root. Never hardcode a machine-specific absolute
  path into committed files.
- Root stack: Node workspace/orchestrator with npm scripts for backend,
  frontend, desktop, mobile, security, and deployment workflows.
- `app/`: React + Vite frontend, Vitest tests, Playwright E2E, Capacitor mobile shell.
- `server/`: Node API/runtime, Jest tests, data/catalog/search/assistant scripts, migrations, smoke tests.
- `desktop/`: Electron desktop runtime and tests.
- `gateway/`: gateway/proxy surface.
- `infra/`: deployment and cloud automation, including AWS scripts.
- `.github/workflows/`, `netlify.toml`, `vercel.json`, `.netlify/`, `.vercel/`: CI and hosting configuration.
- `scripts/`: repo-level automation and validation scripts.
- `tests/`: auth/security test documentation and generated test planning material.
- `docs/`, `security-reports/`: architecture, security, and operational documentation. Point-in-time security reports (including the former root-level `SECURITY_*.md` files and the legacy root threat model) live in `security-reports/`; the living threat model is `docs/security/threat-model.md`.

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

---

## 3. Core Commands

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

---

## 4. CI Topology

Know this before reasoning about whether "CI covered it."

- **This repository is public.** Standard GitHub-hosted runners are therefore
  free and unlimited. Larger runners are billed per-minute **even on public
  repositories** — never switch a job to a larger runner for speed.
- Because the machine may not have the memory or CPU to run the full suite
  locally, **the authoritative suite run is always remote**. See §6.

| Workflow | Triggers on |
|---|---|
| `ci.yml` | `pull_request`, `workflow_dispatch`, `workflow_call` — **NOT `push` to main** |
| `quality.yml` | `pull_request`, **`push` to main**, `workflow_dispatch`, `workflow_call`, weekly cron |
| `nightly-tests.yml` | daily cron, `workflow_dispatch`, `workflow_call` |
| `all-suites.yml` | `workflow_dispatch` only — fans out CI + nightly + quality in one run |

- Merging a PR therefore does **not** re-verify `main` via `ci.yml`; only
  `quality.yml` and `status-watch` run there.
- Jobs that run the server test tier (`ci.yml` backend-regression,
  `quality.yml` quality-shard) install **`server/node_modules` only** — the root
  install is deliberately skipped. A `server/tests/` suite must not depend on a
  root-level devDependency.
- Sharding hides failures: a suite assigned only to shard 2 of 3 leaves shards 1
  and 3 green. When triaging, confirm which shard owns a suite.
- One dispatch runs everything:

```sh
gh workflow run all-suites.yml --ref main -f include_nightly=true -f include_quality=false
```

- Reading run state — always confirm freshness, never trust a badge alone:

```sh
gh pr checks <n> --repo MdSaifulIslamMSI/Aura
gh run view <run-id> --repo MdSaifulIslamMSI/Aura --log-failed
```

---

## 5. Tracer-First Workflow

- Before broad edits, run or identify the narrowest command that exercises the touched surface.
- If the tracer fails before changes, preserve the exact command and failure in the response.
- Change one meaningful thing at a time.
- Prefer package scripts over ad hoc commands.
- Use focused tests before full builds unless the touched area is shared or deployment-facing.

---

## 6. Verification Ladder

- Instruction-only changes: inspect `AGENTS.md`, and confirm every referenced script actually exists.
- Frontend behavior: run targeted Vitest tests, then `npm --prefix app run build` for broad UI/config changes.
- Frontend E2E or visual flows: run the relevant Playwright test or browser smoke check.
- Backend behavior: run `npm --prefix server test -- --runTestsByPath ...` for touched tests; use `npm --prefix server test` for shared backend changes.
- Auth/security/payment changes: run the closest `security:*` or `test:auth:*` script and mention any skipped live checks.
- Deployment/config changes: run dry-run or validation scripts such as `npm run ci:doctor`, `npm run observability:validate`, or host-specific sync checks before proposing deploys.
- Desktop changes: run the narrow desktop runtime test/build command before packaging.
- Mobile changes: run `npm run mobile:doctor` or the relevant Capacitor sync command only when native/mobile surfaces are touched.
- Workflow/CI changes: run `npm run quality:actions` (actionlint) **and** the workflow policy suites in `server/tests/codeScanningHardening.test.js` and `server/tests/envContractScripts.test.js`. Under-granting a callee's permissions, or calling a workflow that lacks `workflow_call`, makes the **entire caller file** fail with `startup_failure` and zero jobs run.

**Verification standards:**

- **Run broad suites remotely, not locally.** This machine may not have the
  memory or CPU for the full matrix, and a reduced local approximation is a
  different — and weaker — claim than a full run on the real runner. Dispatch
  `all-suites.yml` (see §4) for any verification spanning the whole suite.
  Reserve local runs for narrow tracers: a single suite or a handful of files.
  State which environment produced the evidence.
- Reproduce the failing condition locally before fixing it when the cause is
  environmental (missing dependency, wrong platform, absent service). Simulate
  it — move a directory aside, unset an env var — then confirm the fix under the
  same conditions.
- An error message is a claim. Before building a fix on it, confirm the message
  is distinguishable from the failure you actually suspect. A `catch` that
  collapses everything into one value destroys that distinction.
- Run the smallest meaningful check, but always run *one*. A green pipeline is
  not proof of runtime effect.

---

## 7. Production Changes

Deployment is **never** a routine action. See §8 for who may authorize it.

**Deploying the backend:**

```sh
gh workflow run deploy-backend-aws.yml --repo MdSaifulIslamMSI/Aura \
  --ref main -f git_ref=main -f deploy_strategy=swap -f skip_healthcheck=false
```

- `swap` is the proven path for the current production host (recreate, brief
  downtime).
- **`blue-green` is disabled by default** and refuses to run until
  `AURA_BLUE_GREEN_ENABLED` is set, which is only correct after an explicit
  staging drill has validated it. Never set that flag in production to make a
  deploy succeed — that is defeating a safety gate, not passing one.
- Never skip the readiness probe on a production deploy.

**After any deploy — this is the part that is easy to skip and must not be:**

1. **Probe the live endpoint directly.** A green workflow proves the workflow
   was green, not that the change is live.
2. **Diff the response against the pre-deploy shape.** Confirm the intended
   change landed *and* that you did not over-remove. A stripped field is a
   silent success that breaks a consumer weeks later.
3. **Check liveness before reading logs** if any step succeeded and a later step
   failed. A succeeded step followed by a failed step means *unknown state*, and
   rollback steps are frequently skipped in exactly that case. Distinguish
   "rejected before activation" from "partially applied".
4. Report the observed before/after explicitly. If a consumer of a removed field
   could not be exercised (auth-gated, seeded data), say so rather than implying
   full verification.

---

## 8. Authority and Shared State

**Reversible and local → act. Shared or irreversible → propose, then wait.**

| Class | Examples | Rule |
|---|---|---|
| Reversible, local | edit files, run tests, read logs, local git operations | act |
| Irreversible or shared | **merging or closing PRs, pushing to shared branches, deploying, migrations, purges, modifying secrets or CI secrets** | propose, then wait |

- If you are unsure which class an action falls into, it is the second class.
- "The user said solve everything" authorizes work, not every possible action.
  When a judgment call carries real blast radius on a **public** repository,
  surface it and get a decision.
- A defensible action is not the same as an authorized one.

---

## 9. No-Go Zones

- Do not edit secrets, credentials, private keys, tokens, or env files unless explicitly requested.
- Do not run purge, wipe, reset, migration, production smoke, live auth, deploy, or cloud activation commands without explicit confirmation.
- Do not alter auth, billing, payments, production deployment, public APIs, migrations, or data-retention behavior casually.
- Do not edit generated output, build artifacts, logs, dependency folders, or crash dumps unless the task is specifically about those files.
- Do not overwrite user changes in the working tree. Treat unrelated dirty files as user-owned.
- **Do not weaken a gate to make it pass.** No allowlist entries, feature-flag
  flips, `--no-verify`, or threshold relaxations to get a build green. The
  release-cooldown gate (`security:lockfile-freshness`) enforces a 7-day age on
  new dependency versions as supply-chain protection — routine minor/patch
  bumps are not an urgent security fix and must wait. If a control seems noisy,
  fix the input, not the control.
- Do not commit `app/public/status-snapshot.{json,html}`. They are rewritten at
  runtime by `server/services/statusService.js` and carry a permanently dirty
  diff nobody authored.

---

## 10. Style Notes

- Keep changes surgical and match existing patterns.
- Prefer structured parsers and existing helper APIs over brittle string edits.
- Avoid unrelated formatting churn.
- Add comments only where they clarify non-obvious behavior — specifically
  *why* the boundary is here and what breaks if it moves, not what the line does.
- When a comment states a load-bearing justification ("nothing reads this field"),
  verify it before relying on it. If it is wrong, correct it in the same change
  that exposed it.
- For frontend work, reuse existing UI patterns, tokens, components, and test utilities before adding new ones.
- For security-sensitive work, state assumptions and residual risk clearly.

---

## 11. Definition Of Done

- The change directly solves the user request.
- The diff is scoped to relevant files.
- Existing project patterns are followed.
- The smallest meaningful verification has run **and its result is shown**.
- Any skipped verification or remaining risk is stated clearly.
- If the work touched a running system, its post-change state has been probed
  and reported — not inferred from a green check.
