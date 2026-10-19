# Threat Model

Last updated: 2026-10-19

This document is the anchor for the whole defense model. It was last reviewed
on 2026-05-25, which predates the authorization PDP (Auth Shield), the ALIEN
OTP action-proof layer, DPoP sender-constraint, the Trust Fabric, the Invisible
App Fabric, the AI shopping assistant and its retrieval path, and the
multi-host release train. A threat model that does not describe the system's
current surfaces cannot be used to decide whether a control is adequate, so the
gap is closed here. The machine-checked control inventory
(`config/security/control-inventory.json`, enforced by
`npm run security:controls`) is the companion artifact: it records, for every
security control, whether it is enforced in production or staged with a dated
justification, so a control cannot quietly ship dark.

## Assets

- User accounts
- Browser sessions and refresh/session state
- Uploaded files and review media
- PII: name, email, phone, address, IP, device signals
- Payment records and webhook events
- Admin portal and privileged actions
- API keys, signing secrets, webhook secrets, and CI credentials
- MongoDB data and object storage
- Redis cache/session/rate-limit state
- CI/CD pipeline and deploy workflows
- **Order and escrow money state** — pre-shipment refund state, escrow holds,
  coupon redemption, loyalty balances, seller trust scores
- **AI assistant authority** — the capability manifest, the retrieval corpus
  (including customer-authored review text), the tool registry, and the
  confirmation tokens that let it act on a user's behalf
- **The release train** — the built storefront artifact, the seven storefront
  hosts, the GitHub Releases feed the desktop app auto-updates from, and the
  mobile binaries
- **The security control inventory itself** — a control that is recorded as
  enforced but shipped disabled is an assurance failure, not a bug

## Trust Boundaries

- Internet to CDN/WAF/origin protection
- Edge to API gateway/reverse proxy
- API middleware to route/controller layer
- Authenticated user to authorization policy
- App to MongoDB/Redis/object storage
- App to external APIs and webhooks
- CI to deployment environments
- Admin browser to production controls
- **CI to the AWS account** — an OIDC `sub` claim presented by a workflow run.
  A `sub` that names an environment (`repo:OWNER/REPO:environment:staging`) is
  identical for a push run and a pull-request run, so it cannot be used as a
  trust anchor; only a ref-scoped subject can.
- **Repository content to the AI model** — customer-authored text (reviews,
  listing copy) is retrieved and placed in the model prompt. Retrieved content
  is untrusted input, never instruction.
- **Release feed to the installed desktop app** — the updater accepts an
  artifact from the feed; the artifact's signature is the only thing standing
  between a compromised feed and code execution on every install.
- **Provider refund to commerce state** — money is returned by the provider
  before the order, coupon, loyalty, and review-eligibility state is unwound.
  That ordering is itself a boundary: a refund that does not unwind the order
  leaves a shippable order and a paid-looking buyer.

## Top Threats

| Threat | Prevent | Detect | Respond | Evidence |
|---|---|---|---|---|
| Account takeover | MFA/passkey/trusted-device policy, login throttling, CSRF/session binding | Auth failure and anomaly logs | Revoke sessions, lock account, notify user | `security:auth`, account takeover playbook |
| Tenant data leak or IDOR | Server-side owner/tenant checks, admin policy | Tenant cross-access denied events | Disable route/feature, hotfix, incident | `security:idor`, risk register |
| Upload malware | Upload token, size/type/magic checks, malware scan | Upload malware and scan-failure telemetry | Quarantine, block, alert | `security:malware-runtime`, malware playbook |
| SSRF to metadata/internal systems | Safe egress helper, private IP block, allowlists | `egress.private_ip_blocked` alert | Block domain, rotate exposed secrets, hotfix | SSRF playbook, egress tests |
| NoSQL/SQL injection | Zod validation, Mongo sanitizer, parameterized queries where SQL exists | Validation error spikes | Patch route, add regression test | security tests and Semgrep |
| XSS/session theft | React escaping, CSP, XSS sanitizer, secure cookies | CSP/report and auth anomaly logs | Revoke sessions, patch vector | headers/CSRF tests |
| Admin abuse | Admin MFA/passkey/fresh login, policy middleware | Admin action logs and export alerts | Suspend admin session, access review | admin security tests, admin abuse playbook |
| Dependency compromise | npm audit, OSV, Semgrep, Trivy, SBOM | CI gates and scanner artifacts | Patch/override, hotfix branch | security-gates workflow |
| Secret leakage | `.gitignore`, Gitleaks, redaction tests | Secret scan failure and leak alerts | Rotate secret, revoke token, audit use | secret leak playbook |
| Backup destruction/ransomware | Immutable encrypted backups, least privilege | Backup deletion/audit alerts | Restore drill, isolate credentials | ransomware restore playbook |
| **Money-path logic abuse (refund/escrow)** | Take the goods and the money, or a discount without a purchase | Server-computed amounts, cumulative refund cap, refund lock, provider reconciliation, refund-driven cancellation and side-effect unwind | Refund-before-dispatch anomaly, refund velocity, duplicate-refund detection | `security:refs`, `orderCommandCenterIntegrity`, `escrowRefundHardening` |
| **Seller reputation forging** | Look trusted without verified sales; mask own fraud risk | Evidence-backed trust metrics (escrow release, not a self-declared "sold" flag) | Seller trust tier drift, dispute-rate spike | `sellerTrustService`, trust passport tests |
| **Indirect prompt injection (LLM01)** | Steer the assistant through retrieved customer text | Retrieved content is delimited and placed in the user turn, never the system prompt; every chunk is screened before it reaches the model | Chunk rejection telemetry, output guard | `assistantConversationRoleTrust`, `commerceAssistantGroundingBoundary` |
| **Assistant privilege confusion** | Make the model act beyond the user's authority | Closed tool registry, read-only agent loop, signed confirmation tokens for mutations, server-side re-authorization | Confirmation mismatch, action audit | AI tool registry tests, `security:ai` |
| **CI OIDC trust-boundary abuse** | Assume a deploy role from a pull request | Ref-scoped OIDC subject only; no environment-scoped subject in the trust policy; PR-reachable jobs carry no OIDC token | `ciOidcTrustBoundary` test, trust-policy audit | `ciOidcTrustBoundary`, `security:supply-chain-pins` |
| **Release-train compromise** | Ship code to every install | Signed artifacts, digest-pinned base images, SHA-pinned actions, provenance attestation, byte-gate per host | Byte-gate mismatch, provenance verification failure | `production-on-push`, `supply-chain-integrity` |
| **Control drift (shadow-by-default)** | Ship a control dark while the docs claim it is active | Single control inventory: every control is enforced or staged with a dated justification; the production env template is checked against it | `security:controls` gate fails on drift or expired staging | `config/security/control-inventory.json` |

## Abuse Cases

| Abuse Case | Attacker Goal | Control | Detection | Risk |
|---|---|---|---|---|
| Password spraying | Try common passwords across many accounts | Per-IP and per-account throttles, MFA | Failed login velocity by IP/account | R-011 |
| Account takeover | Use stolen credentials or sessions | MFA, trusted device, session revocation | Impossible travel, new device, MFA failure spike | R-001 |
| Tenant object guessing | Read or mutate another tenant's object ID | Server-side owner/tenant checks | `tenant.cross_access.denied` | R-003 |
| Upload bypass | Upload malware or spoof file type | Size, extension, MIME, magic byte, malware scan | `upload.rejected`, `upload.malware_detected` | R-002 |
| SSRF probe | Reach metadata/private services | Safe egress client, private IP and redirect block | `egress.private_ip_blocked` | R-012 |
| Webhook replay | Replay valid payment/provider event | Timestamp, signature, event ID replay cache | `webhook.replay_detected` | R-013 |
| Signup abuse | Create accounts for spam/fraud | Signup rate limits, verification, abuse scoring | `signup.abuse_detected` | R-014 |
| Admin misuse | Export data or change roles without business need | Admin MFA, step-up, policy checks, audit logs | `admin.action.performed`, export/role alerts | R-015 |
| Supply-chain tampering | Modify build, dependency, or artifact | SBOM, provenance, signing, action pins | CI gate failure, attestation verification failure | R-009 |
| Runtime escape | Break out of container or modify filesystem | Non-root, read-only FS, seccomp/AppArmor, cap drop | Falco/container escape rules | R-005 |
| **Refund/escrow abuse** | Get the goods and the money back | Refund-driven order cancellation, side-effect unwind, refund lock, cumulative cap, escrow release requires the seller or an admin | Refund-before-dispatch anomaly, refund velocity | R-022 |
| **Seller reputation forging** | Fake trust to bypass the fraud engine | Evidence-backed transaction counts; self-declared sales do not earn the badge or lower the risk tier | Trust tier drift, dispute-rate spike | R-023 |
| **Prompt injection through retrieval** | Steer the assistant with planted review text | Retrieved content is data, not instruction: user turn + delimiters + per-chunk screening | Chunk rejection telemetry | R-024 |
| **CI privilege escalation from a PR** | Assume a deploy role from a pull request | Ref-scoped OIDC subject; no environment-scoped subject; no OIDC token on PR-reachable jobs | Trust-policy audit, `ciOidcTrustBoundary` | R-025 |
| **Unattended software update** | Push code to every desktop install | Signed artifacts required by default; signature verification never disabled; digest-pinned images | Update verification failure, byte-gate mismatch | R-026 |
| **Control drift** | Ship a control dark while it is documented as active | Control inventory: enforced or staged-with-expiry, checked against the production env template | `security:controls` gate | R-027 |

## STRIDE Matrix

| STRIDE | Primary Surface | Example Threat | Prevent | Detect | Evidence |
|---|---|---|---|---|---|
| Spoofing | Auth, service-to-service calls, CI OIDC | Stolen user token or forged service identity | MFA/session rotation, mTLS/service identity, ref-scoped OIDC subject | Auth anomaly, service authz denied | Auth tests, service mesh policy, `ciOidcTrustBoundary` |
| Tampering | CI/CD, uploads, webhooks, database, order state | Alter artifact, upload malware, replay webhook, keep an order shippable after a refund | Signed artifacts, magic bytes, webhook signature, refund-driven cancellation | Scanner reports, replay alert, refund-before-dispatch anomaly | SBOM/provenance, upload/webhook tests, `refundFulfilmentStop` |
| Repudiation | Admin actions, deployments, assistant actions | Admin or the assistant denies a sensitive change | Request IDs, admin audit logs, signed CI provenance, confirmation tokens | Audit log review | Admin audit schema, incident timeline, assistant action audit |
| Information disclosure | Tenant data, PII, logs, storage, telemetry | IDOR, leaked PII, over-broad signed URL, session replay without consent | Tenant checks, DLP/redaction, signed URLs, telemetry consent gate | Sensitive read and DLP alerts | Data flow map, access review, `useTelemetryConsent` |
| Denial of service | Login, OTP, uploads, search, webhooks, unauthenticated compute | Resource exhaustion or abuse traffic | Rate limits, request limits, queues, bounded allocation on public compute endpoints | Rate-limit and latency alerts | Rate-limit tests, release watch, bundle-DP bounds |
| Elevation of privilege | Admin APIs, internal services, the assistant, the release feed | Normal user/admin/service gains higher permission | RBAC/ABAC, step-up, internal authz, closed tool registry, signed artifacts | Privilege change/admin anomaly alert | Permission tests, audit logs |

## Threat To Risk Register Map

| Threat Area | Risk IDs | Control Evidence |
|---|---|---|
| Account takeover and auth abuse | R-001, R-011, R-014 | Auth tests, abuse detection policy, account takeover playbook |
| Tenant and authorization bypass | R-003, R-016 | IDOR tests, permission matrix, control gap tracker |
| Upload and malware handling | R-002 | Malware runtime validation, upload logs, malware playbook |
| SSRF and egress | R-012 | Egress policy, SSRF tests, SSRF playbook |
| Supply chain and provenance | R-009, R-017 | SBOM, action pin check, provenance policy |
| Runtime/container compromise | R-005, R-018 | Runtime hardening, Falco rules, Trivy image scan |
| Data governance and privacy | R-019 | Data flow map, DLP policy, access review |
| Incident response maturity | R-020 | Incident response doc, postmortem template, tabletop record |
| Money-path logic abuse | R-022 | Refund/escrow regression suites, refund cap, refund lock, side-effect unwind |
| Seller reputation integrity | R-023 | Seller trust passport tests, evidence-backed transaction counting |
| AI prompt injection and assistant authority | R-024 | Prompt guard, chunk screening, closed tool registry, confirmation tokens |
| CI OIDC trust boundary | R-025 | `ciOidcTrustBoundary` test, ref-scoped trust policy, PR-guarded AWS steps |
| Release and update integrity | R-026 | Artifact signing, digest-pinned images, byte gate, provenance attestation |
| Security control drift | R-027 | `config/security/control-inventory.json` + `npm run security:controls` |

## High-Risk Change Rule

Changes touching auth, admin, uploads, payments/webhooks, secrets, deployment, migrations, tenant access, or security workflows require:

- Security inventory update when the surface changes.
- Focused security test or scanner proof.
- CODEOWNERS/manual review after branch protection is enabled.
- Rollback or hotfix path documented before production deploy.
