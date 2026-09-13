# Code-Scanning Triage Report — 2026-09-14

Scope: all 104 open code-scanning alerts on `main` as of commit `acb8728e`
(Semgrep 86, CodeQL 10, Scorecard 4, checkov 3, zizmor 1; Dependabot 0 open,
secret scanning 0 open). Triage follows `docs/scanner-triage-playbook.md`:
reproduce → classify → fix root cause where appropriate → narrow documented
suppression otherwise.

Goal state: 0 open alerts. ~99 close automatically as "fixed" once the
post-merge scanner runs publish fresh SARIF without these findings; 5 are
dismissed in the GitHub UI with the reasons recorded here.

## Dispositions by cluster

### 1. PQC Semgrep policy flagging its own corpus (fixed in policy) — 71 alerts

The PQC semgrep lane (`post-quantum-security.yml` →
`security/semgrep/pqc-crypto-policy.yml`) was reporting on the policy
surfaces, scanner scripts, and deliberate bad-example fixtures that exist to
define or exercise the policy.

| Rule | Alerts | Change |
| --- | --- | --- |
| `risky-jwt-classical-signing-warning` | 48 (1047–1049, 1076–1081, 1083–1084, 1087–1105, 1109–1124, 1131–1132) | Removed the loose `\b(RS256\|ES256\|PS256)\b` mention regex; the rule now reports only actual `jwt.sign(...)` calls. Mere algorithm mentions — including the RFC 9449-mandated DPoP `alg: 'ES256'` header — stay tracked by the node-side crypto inventory (`scripts/security/crypto-inventory.mjs`). Repo has zero production `jwt.sign` call sites. |
| `insecure-cipher-config` | 17 (1052–1054, 1057–1062, 1069–1075, 1106) | Rule-level `paths.exclude` for `security/semgrep/`, `config/security/`, `scripts/security/`, `tests/fixtures/security/pqc/`. |
| `tls-v1-config` | 7 (1050, 1063–1066, 1107, 1129) | Same `paths.exclude`. |
| `tls-v1-1-config` | 5 (1051, 1067–1068, 1108, 1130) | Same `paths.exclude`. |
| `nodejs-create-ecdh` | 1 (1125) | Fixture exclusion (`tests/fixtures/security/pqc/bad-ecdh.js`). |
| `nodejs-crypto-public-encrypt` | 1 (1127) | Fixture exclusion (`bad-rsa-public-encrypt.js`). |
| `nodejs-sha1` | 1 (1128) | Fixture exclusion (`bad-sha1.js`). |
| `nodejs-md5` | 1 (1126) | Fixture exclusion (`bad-md5.js`). |

Pinned by `server/tests/codeScanningHardening.test.js` ("PQC semgrep policy
only flags signing operations, not algorithm mentions").

### 2. Hash identifiers with documented accepted-risk (suppressed in code) — 5 alerts

All five are already accepted with reasons and expiry (2026-12-31) in
`config/security/pqc-allowlist.json` on the node-side policy lane; the
semgrep lane now carries matching in-code suppressions.

| Alert | Rule | Site | Suppression rationale |
| --- | --- | --- | --- |
| 1082 | `nodejs-sha1` | `server/services/catalogArtworkService.js:97` | Deterministic artwork bucketing hash; identity stability, not a security primitive. |
| 1086 | `nodejs-sha1` | `server/services/productImageResolver.js:182` | `buildStableUid` — persisted product UIDs; changing the hash rewrites every product identity. |
| 1055 | `nodejs-sha1` | `scripts/i18n/codemod-jsx-stable-text.mjs:18` | Stable i18n message-id suffix; changing it churns all generated ids/baselines. |
| 1056 | `nodejs-sha1` | `scripts/i18n/discover-stable-ui-text.mjs:328` | Stable i18n discovery-id suffix; same rationale. |
| 1085 | `nodejs-md5` | `server/services/listingService.js:190` | Non-secret 8-char payment-event log correlation hash; never used for signatures/integrity/secrets. |

Recorded in `docs/code-quality-baseline.md`.

### 3. Real code findings (fixed) — 11 alerts

| Alert | Rule | Site | Fix |
| --- | --- | --- | --- |
| 1146 | `js/indirect-command-line-injection` (medium) | `scripts/student-pack-sentry-release.mjs` | Release id is validated against `^[A-Za-z0-9][A-Za-z0-9._+@/-]{0,199}$` before any spawn; every cmd.exe metacharacter is rejected. Pinned in `codeScanningHardening.test.js`. |
| 1147 | `js/useless-assignment-to-local` | `server/config/runtimeConfig.js:349` | Removed the dead `onePasswordResult` initializer (unconditionally overwritten or thrown past). |
| 1135–1140, 1143 | `js/unused-local-variable` (7) | `app/src/hooks/useSpeechInput.test.jsx:6`, `app/src/components/shared/SkeletonLoader/SkeletonLoader.test.jsx:1`, `app/src/hooks/useDismissableLayer.test.jsx:1`, `app/src/pages/Login/CountryCodePicker.test.jsx:1`, `server/tests/trustPolicies.test.js:58`, `server/tests/catalogProductIdIntegrity.test.js:1`, `server/tests/orderPlacementService.test.js:421` | Removed the unused imports/variables/bindings. |
| 1142 | `zizmor/excessive-permissions` | `.github/workflows/production-db-backup.yml:16` | `id-token: write` narrowed from workflow level to the four jobs that mint AWS OIDC tokens. `observability-activation.yml` (same class) narrowed preventively. |

### 4. checkov CKV_GHA_7 workflow_dispatch inputs (accepted in baseline) — 3 alerts

checkov's GitHub Actions provider runs graph checks, which ignore inline
`# checkov:skip=` comments (verified: `production-on-push.yml` already had one
and still reported). The findings are therefore accepted in the existing
`acceptedCheckovFindings` baseline in `scripts/security/run-docker-tool.mjs`,
which filters them from both JSON and SARIF before upload.

| Alert | Workflow | Input | Rationale |
| --- | --- | --- | --- |
| 485 | `production-on-push.yml` | `confirm_production` | Operator must type PRODUCTION to enable deploy jobs; gates job-level `if` conditions only, never interpolated into build steps. |
| 1144 | `production-db-backup.yml` | `run_drill` | Boolean gate for the isolated restore-drill job. |
| 1145 | `observability-activation.yml` | `probe_only`, `fire_test_alert` | Gates read-only discovery vs activation. |

Pinned by `codeScanningHardening.test.js` ("operator-controlled
workflow_dispatch inputs stay explicitly accepted for CKV_GHA_7").

### 5. Scorecard process items — 1 fix attempt + 3 dismissals

| Alert | Check | Disposition |
| --- | --- | --- |
| 999 | `SecurityPolicyID` (score 4, "no linked content found") | Attempted fix: SECURITY.md gains a Supported Versions table and an explicit advisory-creation link. If the next weekly scorecard run still reports below 10, dismiss as won't fix (solo-maintainer project; policy content is complete for its audience). |
| 1013 | `FuzzingID` (score 0) | Dismiss: won't fix — no fuzzing infrastructure on the current free-tier hosting; SAST, integration, and route-matrix suites cover the sensitive surfaces. Revisit if the project gains an OSS-Fuzz budget. |
| 1027 | `CodeReviewID` (score 0) | Dismiss: won't fix — solo maintainer merges cannot produce third-party approvals; review happens via AI-agent review passes and required CI gates. |
| 1028 | `CIIBestPracticesID` (score 0) | Dismiss: won't fix — earning the OpenSSF badge requires an external account signup; tracked as optional process work. |

### 6. CodeQL false positive (dismissal) — 1 alert

| Alert | Rule | Disposition |
| --- | --- | --- |
| 1133 | `js/http-to-file-access` (medium) | Dismiss: false positive. The flagged sink is `writeJsonAtomic` in `scripts/lib/release-guard-utils.mjs`; network-derived content is JSON.stringify-escaped and the destination path is hard-restricted to the repository root or the OS temp directory before any write. No attacker-controlled path, no code execution sink. |

## Residual risk

- Removing the algorithm-mention regex narrows the PQC semgrep net to real
  `jwt.sign` calls; new algorithm-name mentions in executable code are still
  surfaced by the node-side crypto inventory and policy check
  (`npm run security:pqc:policy`).
- The CKV_GHA_7 baseline is per-file, not per-input; a new dispatch input in
  the three listed workflows would also be accepted. The pinning contract
  test lists the accepted workflows explicitly.
- Hash-identifier suppressions expire with `pqc-allowlist.json` on
  2026-12-31; the semgrep `// nosemgrep` comments must be revisited in the
  same review.

## Verification

- `npm run security:pqc:policy`, `npm run security:pqc:inventory` — green (node-side policy unaffected).
- `npm run security:sarif-contract` — green.
- `server/tests/codeScanningHardening.test.js` — green (new pins included).
- Post-merge: all five SARIF lanes re-run on `main`; open alert count verified via API; residual dismissals applied with the reasons above.
