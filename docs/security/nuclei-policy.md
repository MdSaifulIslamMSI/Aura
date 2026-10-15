# Nuclei Scan Policy

Last updated: 2026-10-11

Live, template-driven vulnerability scanning for the AURA Marketplace storefront
and API. Nuclei complements — it does not replace — the existing gates: OWASP ZAP
baseline (passive spider scan, per PR), Semgrep (SAST), Trivy (dependency /
container / IaC), CodeQL, Gitleaks, and the Jest security suites.

## Tool

- Image: `projectdiscovery/nuclei` (pinned tag, override with `NUCLEI_IMAGE`).
- Runner: `scripts/security/run-docker-tool.mjs` (same Docker wrapper as Gitleaks,
  Semgrep, Trivy, ZAP, zizmor), so local Windows and CI Linux runs are identical.
- Workflow: `.github/workflows/nuclei-scan.yml` — **scheduled and
  `workflow_dispatch` only; never runs on `pull_request`.**

## Local usage

```sh
# Baseline mode: reports every finding, exits zero (infra failures still fail).
npm run security:nuclei -- http://127.0.0.1:5000

# Strict mode: exits non-zero on unsuppressed high/critical findings.
npm run security:nuclei:strict -- http://127.0.0.1:5000
```

Requires Docker with engine running. Targets are constrained to
`localhost`, `127.0.0.1`, `host.docker.internal`, `staging`, or `preview`
hostnames — the same allowlist the ZAP runner enforces. The runner refuses any
other target with exit code 2 before Docker is invoked.

### Target selection (the part that makes this gate useful or useless)

There is no live staging, so the workflow resolves its target in this order:

1. **Operator override** (`workflow_dispatch` `target` input) — for a one-off
   scan of any allowed origin.
2. **Staging** (`vars.STAGING_URL`) — the intended steady state once staging
   exists; the runner still refuses production origins.
3. **Local real backend** (`http://127.0.0.1:5000`) — the default when staging
   is absent.

Option 3 exists because option 2 is empty, and the earlier default was wrong.
It scanned a static Vite preview on `:4173`, where **1129 templates ran, 3516
requests completed, and 0 matched** — a green gate with no information content.
A single-page app has no server software for the CVE, exposure and
misconfiguration templates to fingerprint, so the scan could only ever report
nothing. The workflow now boots the real Express backend with `docker compose`
(the same recipe `docker.yml` `build-and-smoke` runs on every PR: `mongo`,
`redis`, `aura-api`, waited on `/health/live`), and scans that instead.

Verified consequence: the same scan against the real backend **matched 1** —
`mongodb-exporter-metrics` on `/metrics`. No server version, no hostname, and
no credential leaks in that response (checked: 62 metric series, no `host=`,
`db=`, bucket or internal-topology labels), so it is accepted with a reason and
an expiry rather than left as noise. The point is not the count; it is that a
real target produces real signal.

The frontend is still covered: `security-gates.yml` runs the ZAP baseline job
against the SPA surface, which is where its passive crawl findings apply.

## Scan scope policy

| Setting | Value | Reason |
| --- | --- | --- |
| `-tags` | `cves,exposures,misconfiguration,default-login,exposure` | Known-CVE signatures, exposed-panels/files, misconfigurations, default credentials. |
| `-etags` | `intrusive,dos,fuzz,headless,oast` | No destructive, denial-of-service, fuzzing, browser, or out-of-band templates. |
| `-ni` | interactsh disabled | No external OAST callbacks leave the runner. |
| `-dut` | unsigned templates disabled | Supply-chain integrity: only signed community templates run. |
| `-duc` | update check disabled | Deterministic runs; template updates ride a deliberate image bump. |
| `-rl 25 -c 10 -timeout 5` | rate-limited, bounded | Polite scanning that will not trip the app's own security controls. |

## Gate policy (baseline first)

Phase A — **baseline** (current):

- Every scheduled and manual run reports all findings (JSONL, SARIF, table) to
  `security-reports/` and uploads SARIF to code scanning under the `nuclei`
  category.
- The job exits zero unless the scan itself failed (missing report, Docker
  error). Findings are visible and triaged, never blocking.

Phase B — **strict gate promotion** (only when all of the following hold):

1. At least three consecutive scheduled runs completed.
2. Every high/critical finding is either fixed or recorded in
   `nuclei-exceptions.json` with a business reason and a future `expiresOn` date.
3. The promotion is exercised with a `workflow_dispatch` run using
   `enforce=true`, which reruns the scan in strict mode and blocks on any
   unsuppressed high/critical finding.

Promotion is recorded in this file (date, reasons) and mirrored in
[control-gap-tracker.md](./control-gap-tracker.md).

## Baseline exceptions

`nuclei-exceptions.json` at the repository root:

```json
{
  "exceptions": [
    {
      "template": "mongodb-exporter-metrics",
      "host": "host.docker.internal",
      "reason": "Prometheus /metrics is a monitoring endpoint reachable on the local DAST stack; it has no auth (index.js:661) and cannot be disabled because staging-aws-deploy.yml scrapes it for release verification. Verified it leaks no hostname, database name, or internal topology. Authenticate it at the edge before this entry is promoted.",
      "expiresOn": "2027-01-31"
    }
  ]
}
```

Rules:

- `template` is the nuclei template ID (or `info.name`). `host` is optional; when
  present, the exception only suppresses that template on that host.
- `reason` is mandatory. `expiresOn` is mandatory: expired entries stop
  suppressing automatically and resurface as findings — this is the anti-rot
  control, matching the `security-audit-exceptions.json` and `.trivyignore.yaml`
  review cadence.
- Suppressed findings are removed from both the JSONL report and the SARIF report
  before upload, so code scanning only shows live, unaccepted results.

## Relationship to other gates

| Gate | Question it answers |
| --- | --- |
| Nuclei (this policy) | Does the running app match a known exposure, misconfiguration, or CVE signature? |
| ZAP baseline (per PR) | Does the app have passive hygiene problems on the pages it crawls? |
| Semgrep / CodeQL | Does the code contain vulnerable patterns? |
| Trivy / OSV / npm audit | Do the dependencies and images contain known vulnerabilities? |

## Runtime characteristics (verified 2026-10-11 against nuclei v3.11.1)

- The `projectdiscovery/nuclei` image **does not bundle templates**. The runner syncs them into `.nucleicache/` (gitignored), mounted at `/root/nuclei-templates` inside the container.
- **Templates are only synced when the cache is empty.** `-update-templates` against a full ~14k-template set was observed hanging for 12+ minutes (no cache growth while GitHub was reachable), which would stall the whole gate. Set `NUCLEI_SYNC_TEMPLATES=1` to force a refresh; CI restores the cache via `actions/cache`.
- Do **not** pass `-duc` on the template-update step: in v3.11 it suppresses the template update as well as the engine update check. `-duc` is still used on the scan itself for determinism.
- `HOME` is pinned to `/root` inside the container so a Windows developer's `HOME` cannot redirect the template directory.
- A scan of the real backend takes ~2 minutes at ~25 RPS (verified: 1129 templates, 3516 requests, 99% complete). The workflow allows 60 minutes for cold cache runs, stack bring-up, and the Docker image build.
- The pinned image tag is verified by digest on first pull (`sha256:582d5546902e67052097cb2d07296c642d50a1afc5e44623cb038845df9a32eb` for `v3.11.1`); bump via `NUCLEI_IMAGE` with the digest checked, matching the scanner-pin policy.
- The target/flag split tolerates `--strict` on either side of the URL, so `npm run security:nuclei:strict -- http://127.0.0.1:5000` works.

## Open follow-up (not in this gate's scope)

`/metrics` is unauthenticated. On the local stack it is reachable and returns 62
metric series of runtime data. The response was checked and contains no
hostname, database name, bucket, or internal-topology labels, so it is not a
credential or topology leak — but the endpoint is still unauthenticated, and in
production it would be reachable through the CloudFront origin too.

The fix is an edge or in-app guard on `metricsPath` (a token, or a
`METRICS_ENABLED=false` toggle), **not** a nuclei exception. The entry in
`nuclei-exceptions.json` is deliberately scoped to the local DAST host and
carries an expiry, so it stops suppressing when the endpoint is actually
protected. `/metrics` cannot simply be switched off: `staging-aws-deploy.yml`
scrapes it as a release-verification step, so removing it would break deploy
verification.

## Verification

```sh
# Bring up the same stack the workflow uses, then scan it.
docker compose up -d --build mongo redis aura-api
npm run security:nuclei -- http://127.0.0.1:5000
npm run security:nuclei:strict -- http://127.0.0.1:5000
docker compose down -v

npm run test:nuclei-baseline  # exception/expiry + SARIF host-matching rules
npm run security:sarif-contract   # contract now covers the Nuclei SARIF wiring
npm run quality:actions           # actionlint on nuclei-scan.yml
```

A missing Docker engine fails the step with a clear message, matching the
free-scanner stack's local behavior.
