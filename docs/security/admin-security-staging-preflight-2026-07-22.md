# Admin security recovery V2 staging preflight

Inventory date: 2026-07-22 (Asia/Calcutta)

Implementation candidate: `f955b4b3` in draft PR #358; this checklist is a later docs-only commit

Scope: read-only staging, GitHub, AWS, and repository inspection

## Decision

**STAGING NO-GO for admin security recovery V2.**

The existing staging service is running and its generic health, isolation, budget, CloudTrail, Redis connectivity, and repository contracts are healthy. The V2 candidate is not deployed, however, and the environment cannot currently qualify WebAuthn or recovery behavior. No staging deployment, Parameter Store write, backup, migration, recovery-grant issuance, provider change, or production mutation was performed during this inventory.

## Current evidence

`PASS` means the named evidence was observed. `BLOCKED` means a prerequisite is known to be absent or incompatible. `NOT PROVEN` means no safe read-only evidence established the gate.

| Gate | Evidence observed | Verdict |
|---|---|---|
| Candidate identity and CI | The completed implementation-head watch at `f955b4b3` reported 70 passed checks, 10 conditional skips, zero failures, and zero pending checks. PR #358 remains draft; this checklist triggers a new docs-head watch. | PASS |
| Generic staging runtime | EC2 instance `i-0af0bd44f6463b11b` is running and managed by SSM. `/health`, `/health/live`, and `/api/health` returned `200`; database and Redis reported connected. | PASS |
| Immutable V2 deployment | Staging reports release `3330aaf6`, not candidate `f955b4b3`. `GET /api/admin/security/status` returned `404`. | BLOCKED |
| Secure WebAuthn origin | The public staging URL is HTTP on an EC2 hostname. The production-mode configuration requires an HTTPS origin and matching RP ID. | BLOCKED |
| V2 runtime configuration | Parameter names were inspected without printing secrets. All V2 flag names, `ADMIN_SECURITY_HASH_SECRET`, the WebAuthn RP/origin/UV names, and the mandatory session-fallback name are absent under `/aura/staging`. | BLOCKED |
| Staging automation safety | `scripts/staging/03-put-ssm-params.sh` and `scripts/staging/07-deploy-compose.sh` currently select `AUTH_DEVICE_CHALLENGE_MODE=off` and `ADMIN_REQUIRE_PASSKEY=false`; they do not materialize the V2 contract. | BLOCKED |
| Redis baseline | `REDIS_ENABLED=true`, a Redis URL name exists, and health reports connected. The API reports Redis as not required, and no approved outage drill proved fail-closed `503` behavior. | BLOCKED |
| Current backup | The staging bucket has encryption, versioning, public-access blocking, and lifecycle controls, but `backups/` is empty. The backup key recorded in local state no longer exists. | BLOCKED |
| Restore proof | The disposable fixture drill passed with four collections and five documents. It used no live data and does not prove restoration of the real staging database or objects. No real isolated staging restore workflow was found. | BLOCKED |
| Migration | Neither audit mode nor apply mode was run against staging because the candidate is not deployed and current backup/restore evidence is absent. | NOT PROVEN |
| Duo baseline | Duo configuration names exist; enabled and fail-closed booleans match the expected values. No V2 redirect, callback, cancellation, or provider-outage ceremony was performed. | NOT PROVEN |
| Audit baseline | The multi-region CloudTrail is logging, log-file validation is enabled, and delivery is current. Application-level immutable V2 audit records and correlation were not exercised. | NOT PROVEN |
| V2 monitoring | Repository observability assets validate, CloudWatch log retention and four infrastructure alarms exist, and generic synthetic/latency checks passed. No V2 recovery/provider alert evidence or dashboard exists. | NOT PROVEN |
| Security findings | Open labeled code-scanning findings include zero high and zero critical; Dependabot and secret-scanning reported no open alerts. One unrelated unclassified/error Checkov alert still requires disposition before signoff. | PASS WITH FOLLOW-UP |
| Owners and factors | No database or identity-provider inspection was authorized. Two independently factored owner/admin accounts and an independent backup admin method were not demonstrated. | NOT PROVEN |
| Rollback | CI verified the captured production rollback artifacts. A staging-specific immutable V2 artifact and a tested V2 rollback were not demonstrated. | NOT PROVEN |
| Signoffs | No recorded security, SRE/operations, or product-owner approval was found for this activation. | NOT PROVEN |

## Hard blockers to clear first

1. Add a qualification mode to the staging scripts that materializes the complete V2 contract without weakening the production contract or changing legacy staging defaults implicitly.
2. Provision an approved HTTPS staging hostname, certificate, and exact WebAuthn RP ID/origin pair.
3. Produce an immutable staging artifact from the reviewed commit and deploy it with every new backend and frontend flag off.
4. Create a current staging database/object backup and prove an isolated, non-destructive restore. A local fixture drill is insufficient.
5. Make Redis mandatory for the V2 security limiters and prove recovery endpoints fail closed during a controlled Redis outage.
6. Exercise V2 audit events and alerts without logging grant plaintext, authority cookies, WebAuthn material, raw IPs, or raw user agents.
7. Demonstrate two independently factored owners/admins, an independent backup admin method, a tested rollback, and recorded security/SRE/product signoffs.

## Ordered activation checklist

Items marked **MUTATING - APPROVAL REQUIRED** are future change-window actions. This document does not authorize them.

### 0. Repair the staging qualification contract

- [ ] Add a reviewed staging qualification path for these configuration names:
  - `ADMIN_SECURITY_HASH_SECRET`
  - `ADMIN_SECURITY_STATE_ENGINE_V2`
  - `ADMIN_PASSKEY_ENROLLMENT`
  - `ADMIN_PASSKEY_CHALLENGE`
  - `ADMIN_DUO_PROVIDER`
  - `ADMIN_RECOVERY_GRANTS`
  - `ADMIN_ASSURANCE_ENFORCEMENT`
  - `ADMIN_ACTION_BOUND_ASSURANCE`
  - `ADMIN_LEGACY_FACTOR_READ`
  - `ADMIN_RECOVERY_TWO_PERSON_REQUIRED`
  - `ADMIN_REQUIRE_2FA`
  - `ADMIN_REQUIRE_PASSKEY`
  - `ADMIN_REQUIRE_ALLOWLIST`
  - `ADMIN_ALLOWLIST_EMAILS`
  - `AUTH_SESSION_ALLOW_MEMORY_FALLBACK`
  - `AUTH_WEBAUTHN_RP_ID`
  - `AUTH_WEBAUTHN_ORIGIN`
  - `AUTH_WEBAUTHN_USER_VERIFICATION`
  - `MFA_ENABLED`
  - `MFA_PASSKEY_ENABLED`
- [ ] Generate a new, staging-only `ADMIN_SECURITY_HASH_SECRET` of at least 32 characters. Store it as a secure parameter; never print it, reuse another auth secret, or commit it.
- [ ] Keep `AUTH_SESSION_ALLOW_MEMORY_FALLBACK=false`, WebAuthn user verification `required`, and the admin 2FA/passkey/allowlist protections enabled for qualification.
- [ ] Make the two-person recovery setting an explicit reviewed decision. Do not silently infer it from repository ownership.
- [ ] Add contract tests proving the staging renderer cannot select challenge-off/passkey-off settings in V2 qualification mode.
- [ ] Obtain security review of the configuration diff and confirm no secret values appear in git, logs, CI output, or the change ticket.

### 1. Establish a secure, immutable baseline

- [ ] **MUTATING - APPROVAL REQUIRED:** provision the HTTPS staging hostname/certificate and record the exact RP ID and origin.
- [ ] Build the candidate once from the reviewed SHA; retain its image digest, frontend deployment ID, SBOM/scan result, and artifact checksum.
- [ ] **MUTATING - APPROVAL REQUIRED:** deploy the candidate with all V2 backend flags and `VITE_ADMIN_SECURITY_STATE_ENGINE_V2` off.
- [ ] Confirm the release marker equals the reviewed SHA and `GET /api/admin/security/status` exists but cannot weaken the legacy admin boundary.
- [ ] Re-run generic staging health, isolation, synthetic, latency, cost, observability, secret-scan, dependency, and branch-protection checks.

### 2. Prove backup and rollback before migration

- [ ] **MUTATING - APPROVAL REQUIRED:** run `npm run staging:backup` for a fresh database/object backup.
- [ ] Record the backup object version, checksum, timestamp, source commit, database name, object counts, and retention window without recording credentials or data contents.
- [ ] **MUTATING - APPROVAL REQUIRED:** restore that backup into a disposable isolated staging target. Never overwrite the live staging database for the drill.
- [ ] Compare indexes, collection/document counts, required records, representative object checksums, and application startup health.
- [ ] Destroy the disposable restore target only under the approved cleanup procedure; retain the evidence report.
- [ ] Capture and test the previous backend image/release and frontend deployment rollback identifiers.

### 3. Audit and apply the additive migration

- [ ] Run audit mode against staging and retain redacted output:

  ```powershell
  npm --prefix server run migrate:admin-security-v2
  ```

- [ ] Review candidate counts, duplicate/conflict findings, index changes, and expected `adminSecurityVersion` initialization.
- [ ] **MUTATING - APPROVAL REQUIRED:** only after backup/restore approval, apply with named operator and change ticket:

  ```powershell
  npm --prefix server run migrate:admin-security-v2 -- --execute --approved-by=<operator> --ticket=<change-ticket>
  ```

- [ ] Re-run audit mode and prove the migration is idempotent.

### 4. Enable the backend in controlled stages

- [ ] **MUTATING - APPROVAL REQUIRED:** write reviewed staging parameters as one change set; record names and versions, never values.
- [ ] Enable state, enrollment, challenge, provider, recovery, assurance enforcement, and action-bound assurance in the documented order while the frontend flag remains off.
- [ ] Keep legacy-factor read enabled only for the measured migration window; define its removal criterion and date.
- [ ] Redeploy the same immutable backend artifact and run its image-level admin-security configuration assertion before activation.
- [ ] Verify authenticated, disabled, unverified-email, unauthorized, stale-primary-auth, recovery, enrollment, challenge, verified, provider-unavailable, and configuration-error states from the backend.

### 5. Run the adversarial staging ceremonies

- [ ] Valid allowlisted admin: recovery grant exchange, passkey enrollment, forced sign-out, fresh sign-in, passkey challenge, and admin access.
- [ ] Recovery authority on an ordinary admin business route returns `403`.
- [ ] Expired, replayed, cross-user, cross-session, wrong-purpose, malformed, and concurrently consumed grants fail closed.
- [ ] Cancelled WebAuthn and Duo ceremonies remain retryable without granting assurance.
- [ ] Wrong origin, RP ID, user handle, credential scope, and missing user verification are rejected.
- [ ] Successful recovery revokes prior browser sessions and Firebase refresh tokens; the recovery session never becomes an admin session.
- [ ] Role removal, allowlist removal, disablement, and `adminSecurityVersion` change invalidate active assurance.
- [ ] **MUTATING - APPROVAL REQUIRED:** in a controlled window, interrupt Redis and prove security-critical recovery endpoints return `503` with no in-memory fallback.
- [ ] **MUTATING - APPROVAL REQUIRED:** simulate approved Duo unavailability and prove provider-unavailable state, bounded retries, fail-closed access, and alert delivery.
- [ ] Prove immutable audit events exist for issuance, exchange, enrollment, rejection, replay, revocation, and provider failure; verify redaction and correlation IDs.

### 6. Enable the frontend and soak

- [ ] **MUTATING - APPROVAL REQUIRED:** enable `VITE_ADMIN_SECURITY_STATE_ENGINE_V2` only after backend state/challenge endpoints and rollback are healthy.
- [ ] Test desktop and mobile viewport flows, keyboard/focus behavior, duplicate-submit prevention, safe return paths, cancellation, and refresh/reload behavior.
- [ ] Run the approved staging/canary soak with recovery, passkey, Duo, Redis, latency, error-rate, and audit-alert monitoring.
- [ ] Investigate every unexplained challenge, recovery, configuration, or provider failure; reset the soak clock after a material fix.

### 7. Human and production gates

- [ ] Demonstrate at least two active owner/admin accounts with separate approved factors.
- [ ] Demonstrate a backup admin method that does not treat recovery authority as admin access.
- [ ] Close or explicitly accept every relevant security finding, including the unclassified Checkov alert.
- [ ] Record security, SRE/operations, and product-owner signoffs against the immutable SHA and evidence bundle.
- [ ] Re-run every required PR/release check on that SHA and capture the production backend and frontend rollback identifiers.
- [ ] Keep production at **NO-GO** unless every item in the production list is evidenced. Staging success alone is not production approval.

## Evidence record

For every checked item, record:

- UTC and local timestamps;
- immutable commit, image digest, and frontend deployment ID;
- named operator/reviewer and change-ticket ID;
- command or test identifier plus redacted result;
- expected and observed state;
- rollback identifier and rollback result;
- linked alert/audit evidence using bounded IDs only;
- any exception, owner, expiry, and formal acceptance.

Do not place secrets, grants, cookies, tokens, raw WebAuthn material, raw IPs, raw user agents, or Parameter Store values in the evidence bundle.

## Required signoff

| Role | Name | Decision | Date | Evidence link |
|---|---|---|---|---|
| Security |  |  |  |  |
| SRE/operations |  |  |  |  |
| Product owner |  |  |  |  |

Blank signoff rows mean **NO-GO**.
