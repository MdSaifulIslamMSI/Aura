# Code-Scanning Triage — 2026-10-21

Scope: the 36 open code-scanning alerts and the 1 open Dependabot vulnerability
on `main` at `5a2b2122`, plus the findings that were *not* open but would
have been. Closes the loop on
[`code-scanning-triage-2026-09-14.md`](code-scanning-triage-2026-09-14.md),
which recorded the dispositions for the previous batch.

Outcome: **0 open code-scanning alerts, 0 open Dependabot alerts**, and the
classes of finding that produced them now have gates that fail the pull
request path instead of surfacing in the Security tab days later.

---

## 1. Why 36 alerts survived for months

GitHub's code-scanning alerts do not fail a pull request. The `javascript-typescript`
CodeQL check is a *required* status check, but it succeeds as long as the
analysis completes — the findings only appear in the Security tab, and only if
someone looks. The `Token-Permissions` findings were worse still: Scorecard
runs weekly, and its SARIF only reaches GitHub a week after the change that
caused it.

Nothing in the pipeline ever went red. That is the root cause, and it is what
this batch fixes.

## 2. Scorecard `Token-Permissions` — 4 alerts, 17 SARIF results

Scorecard emits a SARIF result for a check **only while that check's score is
below the policy minimum**. `Token-Permissions` scored 0/10, so every
top-level write scope in a workflow became a result.

The model, mirrored from `ossf/scorecard` v5.6.0
(`61e84743356275f6ffca23b1b2f2cb945e19eb96`):

- The top-level `permissions:` block must be read-only. A write to one of the
  seven tracked scopes at the top level costs score — `actions`, `contents` and
  `packages` cost the full 10 points, so one of them pins the score at 0.
- A workflow may not have BOTH a top-level write and a job-level write, and
  may not have an undeclared top-level block together with a job-level write.
  Either combination collapses the score to 0.
- Job-level write scopes are allowed. They are reported, not penalised — but
  only while the score is below the policy minimum, which is why they showed up
  in the same alert list.

Three workflows carried a top-level write:

| Workflow | Was | Now |
| --- | --- | --- |
| `dependency-automerge.yml` | `contents: read`, `pull-requests: write`, `issues: write`, `actions: write` | top level `contents: read`; the three write scopes moved to the `policy` job |
| `production-on-push.yml` | `contents: read`, `pull-requests: read`, `id-token: write`, `security-events: write`, `attestations: write` | top level `contents: read`, `pull-requests: read` |
| `staging-promotion-gate.yml` | `actions: write`, `contents: read` | top level `contents: read`; `actions: write` moved to the `staging-promotion` job |

`production-on-push.yml` needed no behavioural change at all: every one of its
ten jobs already declared its own `permissions:` block, and a job-level block
REPLACES the workflow-level one — so the three removed grants were dead
configuration. The other two workflows restate `contents: read` at the job
level for the same reason.

The change follows the pattern `security-gates.yml` already uses in production
(read-only top level, write scopes on the jobs that need them), which is
verified to work for a reusable workflow.

## 3. CodeQL `javascript-typescript` — 32 alerts

| Rule | Alerts | Fix |
| --- | --- | --- |
| `js/unused-local-variable` | 24 | Removed, following the repo's existing "drop dead locals" convention. |
| `js/remote-property-injection` | 3 | The deep sub-tree rebuild of the NoSQL sanitiser now materialises objects with `Object.fromEntries` — the same own-property-safe API the shallow path in the same file already used. A `__proto__` key can no longer reach `Object.prototype` through the inherited setter, and the property name is never the target of an assignment. The rebuild stays recursion-free (a discovery pass over an explicit work list, then a bottom-up materialisation pass). |
| `js/polynomial-redos` | 1 | The URL-query redaction is now a linear scan instead of a quadratic regular expression. The old pattern needed ~1.4 s for a 20k-character token of attacker-influenced log text; the new one needs ~1 ms, and produces byte-for-byte identical output. |
| `js/incomplete-url-substring-sanitization` | 1 | The Firebase origin is compared as a *parsed hostname*, so an origin that merely CONTAINS `identitytoolkit.googleapis.com` no longer receives the scan account's credentials. |
| `js/regex/missing-regexp-anchor` | 1 | The CloudFront origin is parsed out of the CSP and its hostname compared, instead of matched as a substring. The old pattern also matched `https://x.cloudfront.net.attacker.example`. |
| `js/incomplete-sanitization` | 1 | `replaceAll` instead of `replace`. |
| `js/disabling-certificate-validation` | 1 | The TLS posture probe keeps certificate validation ON and waives only the hostname match. A chain failure still proves the protocol version was negotiated (the ServerHello precedes certificate validation), so the measurement is unchanged. |

Two of these were verified against the real production edges, not just in
theory: the TLS posture probe returns the identical result for all four edges,
and the CSP extraction returns the identical origin for the repository's real
committed policy.

## 4. CodeQL findings that were accepted, not open — 16 results

`js/missing-rate-limiting` (5), `js/http-to-file-access` (3),
`js/user-controlled-bypass` (3), `js/insufficient-password-hash` (3),
`js/indirect-command-line-injection` (1) and `js/file-access-to-http` (1) are
all **dismissed in GitHub** with a written rationale each. They are not
regressions, and they are not silently ignored either.

The problem was where the rationale lived: only in the GitHub dismissal
comment, which expires, is invisible to anyone reading the code, and cannot be
checked by a script. And the in-code mechanism that was supposed to carry the
disposition does not work — see §5.

They are now recorded in
[`config/security/codeql-accepted-findings.json`](../../config/security/codeql-accepted-findings.json),
with the maintainers' own rationale, a count, and an expiry. The gate is
`scripts/security/check-codeql-sarif.mjs`.

## 5. CodeQL for JavaScript does not honour inline suppression comments

The repository carried four `// codeql[js/rule-id]` annotations, each
claiming to suppress a finding. **None of them works.** Verified directly
against CodeQL 2.27.3 with a five-case probe (same-line `// codeql[...]`,
preceding-line `// codeql[...]`, the legacy `// lgtm[...]` spelling, and two
unsuppressed controls): all five produced a finding.

The two dismissal rationales in §4 say the same thing from the other side —
"the codeql[] suppression comment is present on the flagged line but not
honored by this analysis" — so this was already known, and the annotations were
still sitting in the code looking like they worked.

They have been replaced with a pointer to the acceptance list, which is the
operative mechanism. The `// nosemgrep:` annotations were left alone: semgrep
*does* honour those.

## 6. The gates added

| Gate | What it stops | Where it runs |
| --- | --- | --- |
| `no-unused-vars` (variables only) for `server/` and `scripts/` | Any new unused local variable. This was the largest alert class by far — 24 of the 32 CodeQL alerts — and it was invisible to lint because the rule was off for both trees. | `npm run lint:node`, every pull request |
| `scripts/security/check-codeql-sarif.mjs` | Any CodeQL `warning`/`error` result that is not in the acceptance list, and any increase in the count of an accepted one. Reads the report the CodeQL action uploads to GitHub, so it is the same report the Security tab shows. | `.github/workflows/codeql.yml`, every pull request |
| `scripts/security/check-workflow-token-permissions.mjs` | A top-level write scope in any workflow, which is what pins Scorecard's `Token-Permissions` score at 0. | `security-gates.yml`, every pull request |
| `scripts/security/check-scorecard-model-drift.mjs` | The hand-ported Scorecard model drifting away from upstream. It fetches the pinned upstream sources and compares the tracked scopes, the penalty table and the probe order. A port that silently drifts would keep reporting 10/10 while the real Scorecard score drops. | `ossf-scorecard.yml`, weekly |

The acceptance list is fail-closed in the same way as
`config/security/pqc-allowlist.json` and
`config/security/lockfile-freshness-allowlist.json`: an entry without a reason
or with an expired date fails the build.

## 7. Dependencies

- `vite` 8.3.1 → **8.3.3**. Outside the vulnerable `>= 8.3.0, <= 8.3.2`
  range, published 15 days before the change, and it needs no transitive bump,
  so the release cooldown still holds with no allowlist entry.
- `follow-redirects` 1.16.0 → **1.16.1** in the app and server lockfiles, for
  two HIGH advisories published on 2026-10-20. These were failing the OSV
  scan and the dependency audit on **every** pull request — including the
  Dependabot PR that was supposed to fix the `vite` advisory.

## 8. Verification

- The local CodeQL scan was checked against the **unmodified** tree first and
  reproduced the GitHub alerts exactly (24 + 3 + 1 + 1 + 1 + 1 + 1 = 32), so
  the "after" numbers are a like-for-like comparison.
- Both behavioural rewrites are pinned by a differential oracle in the
  repository: the logger redaction against the old pattern over 20 000
  generated samples plus an **exhaustive** sweep of every string of length 1..5
  over `{a, /, ?}`, and the sanitiser rebuild against the pre-rewrite
  algorithm over 200 generated payloads plus cycles, shared nodes and unsafe
  keys.
- The new SARIF gate was run against the real CodeQL report: it passes on the
  current findings and fails when a regressed finding is injected.

## 9. Still open

- `js/missing-rate-limiting` on the test-only Express harnesses is accepted
  until 2026-12-31. It is worth revisiting: a harness route that is never
  mounted by the runtime is not an exposure, but the rule cannot see that.
- `scripts/student-pack-sentry-release.mjs` spreads the whole environment into
  a `cmd.exe` child. The finding is accepted as a false positive (the argv is
  constant and the release id is charset-validated), but passing an explicit
  allowlist of environment variables to the child would be better hygiene: the
  child would stop inheriting unrelated secrets. It was not changed here
  because the script's real environment needs cannot be verified without
  `sentry-cli` installed, and guessing them would break the release path.
