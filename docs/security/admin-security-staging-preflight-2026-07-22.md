# Admin security recovery V2 staging preflight

Inventory date: 2026-07-22 (Asia/Calcutta)

Implementation candidate: draft PR #358. Latest exact staging application artifact verified before this checklist update: `37547e08`.

Scope: read-only staging, GitHub, AWS, and repository inspection

## Decision

**STAGING NO-GO for admin security recovery V2 activation. PRODUCTION NO-GO.**

The reviewed branch is now deployed to staging in the explicit `legacy` phase behind a staging-only CloudFront HTTPS endpoint, and generic health, isolation, origin protection, budget, CloudTrail, Redis connectivity, and repository contracts are healthy. A current encrypted/versioned staging archive also exists. V2 remains disabled: no migration, recovery-grant issuance, provider change, Redis outage drill, frontend activation, or production mutation was performed. The archive has not been restored into an isolated target, and the single-instance deployment produced transient `504` responses during replacement; neither backup recoverability nor massive-production availability is proven.

## Current evidence

`PASS` means the named evidence was observed. `BLOCKED` means a prerequisite is known to be absent or incompatible. `NOT PROVEN` means no safe read-only evidence established the gate.

| Gate | Evidence observed | Verdict |
|---|---|---|
| Candidate identity and CI | Exact-head CI passed for the prior qualification commit. The latest operations fixes in this checklist require a fresh exact-head watch. PR #358 remains draft. | PENDING EXACT-HEAD CI |
| Generic staging runtime | EC2 instance `i-0af0bd44f6463b11b` is running and managed by SSM. CloudFront `/health`, `/health/live`, `/`, and the bounded upload route returned the expected `200`/`404` results; database and Redis reported connected. | PASS |
| Immutable V2 deployment | Staging release `37547e08` was deployed from the reviewed branch in the explicit `legacy` phase. `GET /api/admin/security/status` returned `404`, proving V2 remained inactive. | PASS FOR LEGACY BASELINE / V2 OFF |
| Secure WebAuthn origin | Staging uses the AWS default hostname `dmgqqlzv2ewgl.cloudfront.net` with HTTPS. Its sole HTTPS origin is the active EC2 `sslip.io` hostname. This can support a staging-only RP/origin pair after V2 configuration is reviewed. | PASS FOR HTTPS EDGE |
| Origin protection | The CloudFront admin-status request reached the legacy app and returned `404`; a direct-origin request returned `403 ORIGIN_PROTECTION_REQUIRED`. Direct health access remains intentionally available. | PASS |
| V2 runtime configuration | Parameter names were inspected without printing secrets. All V2 flag names, `ADMIN_SECURITY_HASH_SECRET`, the WebAuthn RP/origin/UV names, and the mandatory session-fallback name are absent under `/aura/staging`. | BLOCKED |
| Staging automation safety | Live staging was produced by legacy scripts that select challenge-off/passkey-off settings. The draft branch now has an opt-in, fail-closed qualification contract, but it is not deployed. | CODE FIXED / NOT DEPLOYED |
| Redis baseline | `REDIS_ENABLED=true`, a Redis URL name exists, and health reports connected. The API reports Redis as not required, and no approved outage drill proved fail-closed `503` behavior. | BLOCKED |
| Current backup | An encrypted, versioned object exists at `backups/20260722-181315/aura-staging-backup.tar.gz`, size `271372074`, version `9JfCJphkt6UjOXrtxqjeVcC2OXOsNYhy`, full-object CRC64NVME `lw5Va9KQHII=`. No secret or backup contents were printed. | PASS FOR ARCHIVE EXISTENCE ONLY |
| Restore proof | The new archive contains live Docker volume snapshots; no database-consistent logical snapshot or isolated restoration of this real archive has been proven. The earlier disposable fixture drill does not satisfy this gate. | BLOCKED |
| Migration | Neither audit mode nor apply mode was run against staging because the candidate is not deployed and current backup/restore evidence is absent. | NOT PROVEN |
| Duo baseline | Duo configuration names exist; enabled and fail-closed booleans match the expected values. No V2 redirect, callback, cancellation, or provider-outage ceremony was performed. | NOT PROVEN |
| Audit baseline | The multi-region CloudTrail is logging, log-file validation is enabled, and delivery is current. Application-level immutable V2 audit records and correlation were not exercised. | NOT PROVEN |
| V2 monitoring | Repository observability assets validate, CloudWatch log retention and four infrastructure alarms exist, and generic synthetic/latency checks passed. No V2 recovery/provider alert evidence or dashboard exists. | NOT PROVEN |
| Security findings | Open labeled code-scanning findings include zero high and zero critical; Dependabot and secret-scanning reported no open alerts. One unrelated unclassified/error Checkov alert still requires disposition before signoff. | PASS WITH FOLLOW-UP |
| Owners and factors | No database or identity-provider inspection was authorized. Two independently factored owner/admin accounts and an independent backup admin method were not demonstrated. | NOT PROVEN |
| Rollback and availability | The exact staging SHA is observable, but no V2 rollback was executed. Deploying the single EC2 Compose runtime produced transient `504` responses, so zero-downtime or blue/green rollback is not demonstrated. | BLOCKED |
| Signoffs | No recorded security, SRE/operations, or product-owner approval was found for this activation. | NOT PROVEN |

Implementation update: the draft PR contains an opt-in `legacy` -> `baseline` -> `backend` -> `frontend` staging contract. The exact reviewed `37547e08` application artifact was deployed in `legacy` behind the dedicated HTTPS edge and passed live health/origin checks. V2 Parameter Store values and non-legacy phases remain untouched. The CI state-refresh path now validates the live CloudFront distribution, origin, tags, and configured URLs instead of replacing the HTTPS state with a raw EC2 HTTP URL. The backup workflow now uses root-disk workspace because the instance `/tmp` tmpfs was too small; it cleans the bounded workspace after upload.

## Hard blockers to clear first

1. Complete review and exact-head CI for the new qualification mode, then retain evidence that legacy remains the default and every non-legacy phase fails closed without HTTPS and the complete V2 contract.
2. Review and record the exact CloudFront staging RP ID/origin pair for V2 qualification; do not reuse it for production.
3. Retain the immutable staging artifact identity and keep every new backend and frontend flag off until the activation window.
4. Prove a transaction-consistent database/object backup and an isolated, non-destructive restore of the real staging archive. Archive existence alone is insufficient.
5. Make Redis mandatory for the V2 security limiters and prove recovery endpoints fail closed during a controlled Redis outage.
6. Exercise V2 audit events and alerts without logging grant plaintext, authority cookies, WebAuthn material, raw IPs, or raw user agents.
7. Demonstrate two independently factored owners/admins, an independent backup admin method, a tested zero-downtime/blue-green rollback, and recorded security/SRE/product signoffs.

## Ordered activation checklist

Items marked **MUTATING - APPROVAL REQUIRED** are future change-window actions. This document does not authorize them.

### 0. Repair the staging qualification contract

- [x] Add a staging qualification path, pending exact-head review, for these configuration names:
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
  - `AUTH_DEVICE_CHALLENGE_SECRET`
  - `AUTH_DEVICE_CHALLENGE_SECRET_VERSION`
  - `AUTH_SESSION_ALLOW_MEMORY_FALLBACK`
  - `AUTH_WEBAUTHN_RP_ID`
  - `AUTH_WEBAUTHN_ORIGIN`
  - `AUTH_WEBAUTHN_USER_VERIFICATION`
  - `MFA_ENABLED`
  - `MFA_PASSKEY_ENABLED`
- [ ] Generate a new, staging-only `ADMIN_SECURITY_HASH_SECRET` of at least 32 characters. Store it as a secure parameter; never print it, reuse another auth secret, or commit it.
- [x] Keep `AUTH_SESSION_ALLOW_MEMORY_FALLBACK=false`, WebAuthn user verification `required`, and the admin 2FA/passkey/allowlist protections enabled for qualification.
- [x] Make the two-person recovery setting an explicit reviewed decision. Do not silently infer it from repository ownership.
- [x] Add contract tests proving the staging renderer cannot select challenge-off/passkey-off settings in V2 qualification mode.
- [ ] Obtain security review of the configuration diff and confirm no secret values appear in git, logs, CI output, or the change ticket.

### 1. Establish a secure, immutable baseline

- [x] Provision the staging-only CloudFront HTTPS endpoint and HTTPS origin; record the exact staging RP ID and origin before V2 activation.
- [ ] Build the candidate once from the reviewed SHA; retain its image digest, frontend deployment ID, SBOM/scan result, and artifact checksum.
- [x] Deploy the reviewed branch artifact in explicit `legacy` phase with all V2 backend flags and `VITE_ADMIN_SECURITY_STATE_ENGINE_V2` off.
- [x] Confirm the release marker equals `37547e08`; the absent legacy endpoint returns `404` and cannot weaken the legacy admin boundary.
- [x] Re-run bounded generic staging health and origin-protection checks. Exact-head CI for this checklist update remains required.

### 2. Prove backup and rollback before migration

- [x] Run `npm run staging:backup` for a fresh encrypted/versioned staging archive.
- [x] Record the backup object version, checksum, timestamp, and object size without recording credentials or data contents. Database name/count consistency still requires the isolated restore evidence.
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
