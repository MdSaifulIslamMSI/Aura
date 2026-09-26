# Dependency Automation — Standing Approval Pipeline

This repo keeps its dependencies continuously current with a weekly cycle that requires
no human action unless the policy says otherwise.

## The weekly loop (Mondays)

1. **07:00 UTC** — Dependabot opens its weekly update PRs:
   - npm: `/`, `/app`, `/server` (minor+patch grouped into one PR per directory)
   - github-actions: SHA-pinned action bumps (grouped)
   - docker: base image bumps (grouped)
2. **13:37 UTC** — the **Dependency Automerge Policy** workflow sweeps every open
   Dependabot PR, classifies it against `config/dependency-policy.json`, and either
   arms auto-merge or routes it to the manual lane. The same controller also runs
   on every `pull_request` event, so most PRs are classified the moment they open;
   the sweep is the self-healing backstop.
3. **Branch protection does the rest.** Auto-merge only fires when the required
   checks (`Quality, tests, and coverage`, `javascript-typescript`, `security`,
   `build-and-smoke`) are green. Nothing in this pipeline can bypass a gate.

## Lanes

| Lane | What lands there | What happens |
| --- | --- | --- |
| Safe | patch/minor of any dep; major of any dep **not** on the blocklist; actions/docker bumps | label `automerge:policy`, auto-merge armed (squash) |
| Manual | major of any blocklisted dep; any change inside an `overrides` block | label `needs-human:risk-policy` + PR comment naming the offending dep; you review and merge |
| Held | safe-lane PR with any failing check on the head SHA | left open; the next sweep re-tries after the failure is resolved |

The extra "no failing checks" hold is stricter than branch protection (which only
waits on the 4 required checks) — a red non-required check (Vercel preview,
performance, etc.) keeps the PR human-visible until it clears.

## Tuning appetite: `config/dependency-policy.json`

- `automerge.majorBlocklist` — deps whose **major** jumps always need a human.
  Minors/patches of the same deps still auto-merge (security fixes ship without delay).
  Wildcards like `@sentry/*` are supported.
- `overridesGuard` — any diff inside an `overrides` block goes to the manual lane.
  The root/app/server override pins are hand-synced seams (e.g. `undici`, `brace-expansion`
  appear in all three manifests); automation must not rewrite them unilaterally.
- Labels and the comment marker are configurable.

Edit the JSON freely — the controller reads it at run time, no workflow change needed.

## Known pin seams (manual maintenance)

- `@unicode/unicode-17.0.0` is pinned to **2.0.5** in `app/package.json` overrides:
  2.0.6+ dropped the `regex.js` files that `eslint-plugin-formatjs` 6.x/8.x still
  imports. Relax the pin when the plugin ships a release importing `regex.mjs`.
- `mongoose` 9.9.4 + `mongodb` driver 7.5.0: the 7.6.0 driver has a Jest handshake
  bug (empty client metadata — mongoose#16499). Revisit when a patched driver lands;
  `mongoose` 9.10.2 requires `~7.6`, so both move together.
- `@sentry/*` stays on v10 until `@sentry/electron` ships a release bundling Sentry 11;
  then bump node/react/electron SDKs in one PR.

## Local verification for dependency PRs

```sh
npm run security:deprecated   # lockfile deprecation gate (all 3 lockfiles)
npm run security:deps         # audit >= high across all 3 workspaces
npm run quality:lint          # frontend lint (loads eslint plugins — catches unicode-style breaks)
npm --prefix app test         # vitest
npm test                      # server regression tier (stable)
```

## Arming on Dependabot PRs — token reality

GitHub's platform policy forbids `GITHUB_TOKEN` from changing the merge state of
Dependabot-authored PRs (`Resource not accessible by integration`). The pipeline
therefore has two arming paths:

1. **CI arming (preferred once configured):** add a fine-grained PAT with
   `pull_requests: write` (contents: read) as the repo secret
   `DEPENDABOT_MERGE_TOKEN`. The workflow automatically prefers it and arms
   auto-merge straight from the sweep/event run.
2. **Local sweep (manual fallback):** the same controller run locally with the
   repository owner's `gh auth login` credentials arms everything the CI sweep
   classified — useful if the PAT has expired and a PR must not wait.

```
node scripts/github/dependency-automerge-policy.mjs --sweep
```

Either way, GitHub's branch protection remains the final gate — an armed PR only
merges when every required check is green.

## Controller script

`scripts/github/dependency-automerge-policy.mjs`

```sh
node scripts/github/dependency-automerge-policy.mjs --self-test   # classifier assertions
node scripts/github/dependency-automerge-policy.mjs --sweep --dry-run   # preview decisions
GH_PR_NUMBER=123 node scripts/github/dependency-automerge-policy.mjs --pr 123 --dry-run
```

It only reads manifests via the GitHub contents API, never force-pushes, never
merges directly — it arms the auto-merge flag and lets branch protection merge.
