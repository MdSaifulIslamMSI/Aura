# Admin security recovery V2 staging preflight

Inventory date: 2026-07-23 (Asia/Calcutta)

Implementation candidate: draft PR #358. Latest exact staging application artifact verified before this checklist update: `262650a37f521577e65b22298f1195e6e9a28aa4`.

Scope: staging, GitHub, AWS, and repository inspection plus the approved staging-only backup and isolated restore drill

## Decision

**STAGING NO-GO for admin security recovery V2 activation. PRODUCTION NO-GO.**

The reviewed branch is deployed to staging in the explicit `baseline` phase behind a staging-only CloudFront HTTPS endpoint, and generic health, isolation, origin protection, budget, CloudTrail, Redis connectivity, repository contracts, and staging backup recoverability are healthy. The additive migration was audited, applied with a named operator/change ticket, and re-audited; it modified no user record and created only the expected grant/audit indexes. Backend V2 was briefly activated from the same immutable artifact, but staging had no real Firebase identity provider or owner identity. It was therefore reverted to `baseline` by successful workflow run `29997692521`. V2 enforcement and the frontend flag are currently off. Recovery-grant ceremonies, Redis outage proof, frontend activation, and every production mutation remain blocked. The single-instance deployment produced transient `504` responses during replacement, so massive-production availability is still not proven.

## Current evidence

`PASS` means the named evidence was observed. `BLOCKED` means a prerequisite is known to be absent or incompatible. `NOT PROVEN` means no safe read-only evidence established the gate.

| Gate | Evidence observed | Verdict |
|---|---|---|
| Candidate identity and CI | Exact-head CI at `262650a37f521577e65b22298f1195e6e9a28aa4` completed with 71 passed checks, 9 conditional skips, zero failures, and zero pending. The isolated-Firebase fail-closed change still requires a fresh exact-head watch after push. PR #358 remains draft. | PASS AT DEPLOYED SHA / PENDING NEXT HEAD |
| Generic staging runtime | EC2 instance `i-0af0bd44f6463b11b` is running and managed by SSM. CloudFront `/health`, `/health/live`, `/`, and the bounded upload route returned the expected `200`/`404` results; database and Redis reported connected. | PASS |
| Immutable V2 deployment | Staging release `262650a37f521577e65b22298f1195e6e9a28aa4` was deployed from the reviewed branch. Backend activation run `29996253693` matched the full SHA and expected runtime flags, then rollback run `29997692521` restored the explicit `baseline` phase after the missing identity-provider prerequisite was found. | PASS FOR BASELINE / V2 OFF |
| Secure WebAuthn origin | Staging uses the AWS default hostname `dmgqqlzv2ewgl.cloudfront.net` with HTTPS. Its sole HTTPS origin is the active EC2 `sslip.io` hostname. This can support a staging-only RP/origin pair after V2 configuration is reviewed. | PASS FOR HTTPS EDGE |
| Origin protection | The CloudFront admin-status request returned the intentionally minimized `404`; a direct-origin request returned `403 ORIGIN_PROTECTION_REQUIRED`. Direct health access remains intentionally available. | PASS |
| V2 runtime configuration | Parameter names were inspected without printing secrets. Baseline and backend runtime contracts matched their requested phases. Backend/frontend qualification is now designed to require a distinct staging Firebase project, service account, and web configuration and to reject production-project reuse. Those isolated staging credentials do not yet exist. | BLOCKED ON ISOLATED STAGING FIREBASE |
| Staging automation safety | Live staging is explicitly `baseline`, while the deployed draft branch retains `legacy` as the default and requires opt-in phases. Baseline keeps every V2 backend and frontend flag off. | PASS FOR BASELINE / V2 NOT ACTIVATED |
| Redis baseline | `REDIS_ENABLED=true`, a Redis URL name exists, and health reports connected. The API reports Redis as not required, and no approved outage drill proved fail-closed `503` behavior. | BLOCKED |
| Current backup | The application-quiesced logical backup exists at `backups/20260722-185642/aura-staging-backup.tar.gz`, size `2527175`, version `FdEFkdSQ0UOZe1bagrpzL3dHWnJ4uNtQ`, ETag `c36f1c36af13978ffa0401728982b29e`, and full-object CRC64NVME `Mq5B5P7rxYg=`. It is encrypted with SSE-S3, tagged as staging, and records source SHA `acc963589244590562f7d19a6c940ee122e88079`. No secret or backup contents were printed. | PASS |
| Restore proof | The exact object key and VersionId were restored into disposable `--network none` MongoDB, PostgreSQL, and Redis containers. The drill returned `RESTORE_DRILL_PASS` with Mongo/PostgreSQL count and index parity, a valid Redis RDB, and zero Redis keys. An independent SSM cleanup audit returned `RESTORE_CLEANUP_PASS`; live edge and origin health endpoints remained `200`. | PASS |
| Migration | Audit reported zero users missing `adminSecurityVersion`. Apply under ticket `AURA-STAGING-ADMIN-V2-20260723` matched and modified zero users and created only the expected grant/audit indexes. Post-audit matched the same state, proving the additive migration idempotent on current staging data. | PASS |
| Duo baseline | Duo configuration names exist; enabled and fail-closed booleans match the expected values. No V2 redirect, callback, cancellation, or provider-outage ceremony was performed. | NOT PROVEN |
| Audit baseline | The multi-region CloudTrail is logging, log-file validation is enabled, and delivery is current. Application-level immutable V2 audit records and correlation were not exercised. | NOT PROVEN |
| V2 monitoring | Repository observability assets validate, CloudWatch log retention and four infrastructure alarms exist, and generic synthetic/latency checks passed. No V2 recovery/provider alert evidence or dashboard exists. | NOT PROVEN |
| Security findings | Open labeled code-scanning findings include zero high and zero critical; Dependabot and secret-scanning reported no open alerts. One unrelated unclassified/error Checkov alert still requires disposition before signoff. | PASS WITH FOLLOW-UP |
| Owners and factors | A bounded read-only lookup found no staging database user for the supplied owner allowlist identity. Firebase Admin lookup failed closed because staging uses the explicit `aura-staging-smoke` stub and has no staging Admin credential. Two independently factored owner/admin accounts and an independent backup admin method were not demonstrated. | BLOCKED |
| Rollback and availability | Backend V2 was returned to `baseline` on the same exact staging SHA, proving configuration rollback. Deploying the single EC2 Compose runtime produced transient `504` responses, so image rollback and zero-downtime or blue/green rollback are not demonstrated. | PARTIAL / BLOCKED FOR MASSIVE PRODUCTION |
| Signoffs | No recorded security, SRE/operations, or product-owner approval was found for this activation. | NOT PROVEN |

Implementation update: the draft PR contains an opt-in `legacy` -> `baseline` -> `backend` -> `frontend` staging contract. The exact reviewed `262650a37f521577e65b22298f1195e6e9a28aa4` artifact passed baseline and backend deployments behind the dedicated HTTPS edge. Backend activation exposed that the existing staging stack intentionally used a Firebase stub and did not contain the supplied owner identity, so the same artifact was immediately returned to `baseline`. The follow-up contract makes real, production-distinct Firebase Admin and web configuration mandatory for `backend` and `frontend`, writes the Admin credential only as a staging SecureString, and keeps secret values out of logs and git. Production Firebase credentials are explicitly ineligible for this staging qualification.

## Hard blockers to clear first

1. Complete review and exact-head CI for the new qualification mode, then retain evidence that legacy remains the default and every non-legacy phase fails closed without HTTPS and the complete V2 contract.
2. Create a separate staging Firebase project and configure its project ID, Admin service-account JSON, and web-app JSON in the protected GitHub `staging` environment. Do not reuse or copy production Firebase credentials.
3. Review and record the exact CloudFront staging RP ID/origin pair for V2 qualification; do not reuse it for production.
4. Retain the immutable staging artifact identity and keep every new backend and frontend flag off until the activation window.
5. Make Redis mandatory for the V2 security limiters and prove recovery endpoints fail closed during a controlled Redis outage.
6. Exercise V2 audit events and alerts without logging grant plaintext, authority cookies, WebAuthn material, raw IPs, or raw user agents.
7. Demonstrate two independently factored owners/admins, an independent backup admin method, a tested zero-downtime/blue-green rollback, and recorded security/SRE/product signoffs.

## Ordered activation checklist

Items marked **MUTATING - APPROVAL REQUIRED** require explicit authorization. The isolated staging restore below was completed under the user's repeated explicit authorization for deployment and production-change work; that authorization did not waive any technical gate or authorize a production mutation.

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
- [x] Generate a new, staging-only `ADMIN_SECURITY_HASH_SECRET` of at least 32 characters. Store it as a secure parameter; never print it, reuse another auth secret, or commit it.
- [x] Keep `AUTH_SESSION_ALLOW_MEMORY_FALLBACK=false`, WebAuthn user verification `required`, and the admin 2FA/passkey/allowlist protections enabled for qualification.
- [x] Make the two-person recovery setting an explicit reviewed decision. Do not silently infer it from repository ownership.
- [x] Add contract tests proving the staging renderer cannot select challenge-off/passkey-off settings in V2 qualification mode.
- [x] Add a fail-closed isolated-Firebase contract for backend/frontend phases; require a production-distinct project and matching Admin/web JSON without committing or printing either credential.
- [ ] Configure the separate staging Firebase project and its protected GitHub environment values.
- [ ] Obtain security review of the configuration diff and confirm no secret values appear in git, logs, CI output, or the change ticket.

### 1. Establish a secure, immutable baseline

- [x] Provision the staging-only CloudFront HTTPS endpoint and HTTPS origin; record the exact staging RP ID and origin before V2 activation.
- [ ] Build the candidate once from the reviewed SHA; retain its image digest, frontend deployment ID, SBOM/scan result, and artifact checksum.
- [x] Deploy the reviewed branch artifact in explicit `baseline` phase with all V2 backend flags and `VITE_ADMIN_SECURITY_STATE_ENGINE_V2` off.
- [x] Confirm the runtime release marker equals `262650a37f521577e65b22298f1195e6e9a28aa4`; minimized unauthenticated admin responses remain fail-closed.
- [x] Re-run bounded generic staging health and origin-protection checks. Exact-head CI for this checklist update remains required.

### 2. Prove backup and rollback before migration

- [x] Run `npm run staging:backup` for a fresh encrypted/versioned staging archive.
- [x] Record the backup object version, checksum, timestamp, object size, consistency mode, and source SHA without recording credentials or data contents.
- [x] **MUTATING - APPROVAL REQUIRED:** restore that exact backup version into disposable network-disabled containers without overwriting the live staging databases.
- [x] Validate archive paths and checksums, compare MongoDB and PostgreSQL collection/table counts and indexes, validate the Redis RDB, and confirm live staging health after the drill.
- [x] Destroy the disposable restore target under the cleanup trap and independently prove no restore directory, runner, container, or volume remains.
- [ ] Capture and test the previous backend image/release and frontend deployment rollback identifiers.

### 3. Audit and apply the additive migration

- [x] Run audit mode against staging and retain redacted output:

  ```powershell
  npm --prefix server run migrate:admin-security-v2
  ```

- [x] Review candidate counts, duplicate/conflict findings, index changes, and expected `adminSecurityVersion` initialization.
- [x] **MUTATING - APPROVAL REQUIRED:** only after backup/restore approval, apply with named operator and change ticket:

  ```powershell
  npm --prefix server run migrate:admin-security-v2 -- --execute --approved-by=<operator> --ticket=<change-ticket>
  ```

- [x] Re-run audit mode and prove the migration is idempotent.

### 4. Enable the backend in controlled stages

- [ ] Configure and verify the isolated staging Firebase project before selecting `backend`; the workflow must reject missing, malformed, mismatched, or production-reused identity configuration.
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
