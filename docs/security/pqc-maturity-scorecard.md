# PQC Maturity Scorecard

This scorecard tracks practical post-quantum readiness without claiming that Aura is 100% quantum-proof. It separates repo-owned controls from provider and ecosystem cryptography.

## Current Score Targets

| Dimension | Previous | Current target | Evidence |
| --- | --- | --- | --- |
| Repo-owned PQC readiness | 90-95% | 95-98% | Policy, templates, docs, aggregate proof subreports |
| Crypto inventory and policy enforcement | 90-95% | 95-98% | `npm run security:pqc`, allowlist-aware blocker policy |
| CI-enforced PQC evidence | 80-88% | 94-98% | Post-Quantum Security and Security Gates workflows |
| Controllable-surface deployment proof | 55-70% | 75-85% | SSH, TLS endpoint, internal service, backup, release, provider, and lab evidence |
| Full end-to-end PQC coverage | 35-45% | 45-55% | Provider dependency register and ecosystem caveats |

The full end-to-end score remains capped while browser/WebPKI, Firebase/Auth, payment providers, email providers, hosted databases, app stores, GitHub-hosted internals, AI providers, and SDK cryptography remain provider-dependent.

## Verification

```sh
npm run security:pqc:scorecard
npm run security:pqc:scorecard:strict
```

The strict scorecard fails repo-owned or config-owned evidence gaps. It does not fail because a provider has not announced verifiable PQC support; provider unknowns lower the full end-to-end score and remain tracked as warnings.

## Environment Evidence Modes

Default local runs are safe and do not contact staging or production targets. Optional evidence modes can be enabled with explicit environment variables:

| Surface | Mode variable | Target variable | Default |
| --- | --- | --- | --- |
| SSH hybrid KEX proof | `PQC_SSH_PROOF_MODE=staging` | `PQC_SSH_HOST`, optional `PQC_SSH_USER`, `PQC_SSH_PORT`, `PQC_SSH_EXPECTED_KEX` | disabled |
| TLS endpoint proof | `PQC_TLS_PROOF_MODE=readonly` | `PQC_TLS_TARGET_URL` | disabled unless target is set |
| Internal service shape | `PQC_INTERNAL_EVIDENCE_MODE=staging` | redacted `DATABASE_URL`, `MONGO_URI`, `REDIS_URL` | disabled |
| Backup dry-run proof | `PQC_BACKUP_EVIDENCE_MODE=staging` | backup/restore/storage env names used by `scripts/smoke/backup-restore-check.mjs` | disabled |

Reports redact hosts, usernames, connection strings, command values, storage URIs, and certificate bodies. Production deploys, redeploys, destructive restores, SSH configuration changes, and provider setting changes still require explicit approval.
