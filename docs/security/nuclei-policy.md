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
npm run security:nuclei -- http://127.0.0.1:4173

# Strict mode: exits non-zero on unsuppressed high/critical findings.
npm run security:nuclei:strict -- http://127.0.0.1:4173
```

Requires Docker with engine running. Targets are constrained to
`localhost`, `127.0.0.1`, `host.docker.internal`, `staging`, or `preview`
hostnames — the same allowlist the ZAP runner enforces. The runner refuses any
other target with exit code 2 before Docker is invoked.

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
      "template": "http-missing-security-headers",
      "host": "staging.example",
      "reason": "Header policy is enforced at the edge; see docs/security/pqc-tls-edge-readiness.md.",
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
- A scan of a SPA takes ~2 minutes at ~25 RPS (verified: 1129 templates, 3516 requests, 99% complete). The workflow allows 60 minutes for cold-cache runs.
- The pinned image tag is verified by digest on first pull (`sha256:582d5546902e67052097cb2d07296c642d50a1afc5e44623cb038845df9a32eb` for `v3.11.1`); bump via `NUCLEI_IMAGE` with the digest checked, matching the scanner-pin policy.
- The target/flag split tolerates `--strict` on either side of the URL, so `npm run security:nuclei:strict -- http://127.0.0.1:4173` works.

## Verification

```sh
npm run security:nuclei -- http://127.0.0.1:4173
npm run security:sarif-contract   # contract now covers the Nuclei SARIF wiring
npm run quality:actions           # actionlint on nuclei-scan.yml
```

A missing Docker engine fails the step with a clear message, matching the
free-scanner stack's local behavior.
