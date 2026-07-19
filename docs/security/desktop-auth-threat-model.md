# Aura Desktop Authentication Threat Model

## Scope and security objective

This model covers the packaged Electron application, its loopback runtime, the hosted `/desktop-login` flow, Firebase identity tokens, Aura opaque browser sessions, WebAuthn passkey step-up, realtime socket authentication, and the retired Owner Access shortcut.

The objective is that a desktop sign-in can succeed only for the user who initiated it, on the initiating Aura Desktop instance, after the server-required assurance checks. Tokens and sessions must expire, rotate, refresh, and revoke without stale state restoring older authority.

## Assets

- Firebase custom and ID tokens.
- Firebase refresh capability held by the Firebase client SDK.
- Aura opaque browser-session identifiers and their assurance snapshots.
- One-time desktop request secrets and assurance grant identifiers.
- WebAuthn credentials and user-verification evidence.
- Realtime user and administrator room membership.
- The Electron preload bridge and privileged main-process IPC handlers.

## Trust boundaries and data flow

1. The packaged renderer runs only from the exact active loopback runtime origin. It asks the main process to create a browser sign-in request.
2. The main process opens the hosted Aura login in the operating-system browser. The request ID and 256-bit request secret are held by the loopback broker; secrets are not placed in query parameters.
3. The hosted page authenticates with Firebase. Administrator handoff additionally requires a fresh user-verified WebAuthn session and a one-time server assurance grant.
4. The hosted page returns the sealed result to the exact loopback callback. The broker accepts it once and exposes it only to the trusted main renderer through validated IPC.
5. The renderer signs in with the custom token, exchanges a fresh Firebase ID token for an Aura opaque session, and consumes the one-time assurance grant.
6. HTTP and Socket.IO requests re-check identity, account state, revocation, and credential expiry. The browser session is touched atomically so activity cannot overwrite a newer Firebase or assurance snapshot.

The system browser, hosted frontend, backend, Firebase, loopback HTTP listener, Electron main process, renderer, Redis, and local operating system are separate trust zones. A packaged desktop binary is a public client and cannot safely contain a shared confidential Owner Access key.

## Enforced lifetime and replay limits

| Artifact | Lifetime | Enforcement |
| --- | ---: | --- |
| Desktop browser request | 10 minutes | Loopback in-memory broker; cancelled or pruned after expiry |
| Completed desktop result | 60 seconds | Deleted on first consume; concurrent consumers are serialized |
| Desktop assurance grant | 5 minutes | Redis-backed atomic consume in production; bound to user, request, device, and browser session |
| Firebase ID token | Token `exp` claim | Verified with Firebase revocation checking; refreshed by the Firebase client before reconnect or retry |
| Aura opaque session idle deadline | 8 hours by default | Redis TTL plus record validation; activity atomically extends only the idle deadline |
| Aura opaque session absolute deadline | 7 days by default | Never extended by activity; rotation creates a new identifier |
| CSRF token | 1 hour maximum | Principal/context bound and atomically consumed exactly once |
| Realtime socket credential | Earliest credential deadline | Exact disconnect timer plus periodic account, role, session, and revocation revalidation |

## Threats and mitigations

| Threat | Impact | Mitigation |
| --- | --- | --- |
| A remote page replaces the privileged renderer and invokes preload IPC | Desktop custom-token theft or login confusion | Main-frame navigation is restricted to the active runtime origin; every IPC handler validates the exact main frame, WebContents, and runtime origin; auth status is not broadcast to untrusted content |
| An attacker opens a tenant-controlled `*.web.app` page in a chrome-less auth popup | Credential phishing | Auth popups accept only exact provider and Aura Firebase project hosts |
| Renderer content launches `file:` or arbitrary operating-system schemes | Local code or settings abuse | External launching accepts only HTTPS, `mailto:`, and `tel:` URLs |
| A busy default loopback port moves Aura to another origin | Split cookies, IndexedDB, DPoP keys, and apparently resurrected sessions | Packaged Aura uses the canonical port and fails closed if it is occupied |
| Two callbacks consume the same one-time desktop result | False expiry after successful login | Renderer polls/events share one in-flight consume operation; broker remains delete-on-read |
| A stale response-finisher overwrites a refreshed session | Token expiry appears not to refresh; old assurance returns | Middleware touches only the latest same-ID request session; Redis touch updates only activity fields in the latest stored JSON atomically |
| An expired cookie masks a fresh bearer during Socket.IO reconnect | Authenticated user cannot reconnect | Fresh bearer is verified first; an expired cookie is ignored, while a valid mismatched cookie fails closed |
| A socket remains connected after expiry, logout, revocation, deletion, or admin demotion | Continued private/admin event access | Firebase revocation checking, exact expiry disconnect, periodic revalidation, account checks, and immediate room reconciliation |
| Concurrent CSRF reuse | Duplicate state-changing requests | Metadata validation and deletion occur in one Redis script; the client assigns each concurrent writer its own token |
| Shared Owner Access secret is extracted from a distributed app | Owner/admin impersonation | Owner Access is disabled in production and unavailable in packaged builds; owners use the normal browser flow and passkey policy |
| WebAuthn is attempted from loopback while claiming the hosted RP ID | Browser RP-ID failure or unsafe policy weakening | Passkey ceremony remains on the hosted Aura origin; the desktop receives only the resulting one-time assurance grant |

## Deployment invariants

- Production must set `MFA_ENABLED=true` and `MFA_PASSKEY_ENABLED=true` whenever administrator desktop handoff requires a passkey.
- `AURA_DESKTOP_OWNER_ACCESS_ENABLED=false` is pinned in production bootstrap, deploy, rollback, and Compose configuration.
- Production browser sessions require Redis and do not use in-memory fallback.
- The installed desktop and hosted frontend must agree on the desktop auth protocol version and callback origin.
- A release is not considered verified from static configuration alone: targeted negative tests, the packaged desktop build, release markers, and live sign-in checks are required.

## Residual risks and follow-up

- Existing older desktop versions may still support legacy fallback callback ports until clients update; server compatibility should be removed only after adoption telemetry confirms the canonical-port release is dominant.
- DPoP currently has atomic JTI replay protection and method/path binding. Exact public scheme-and-authority binding needs a separately tested trusted-proxy canonicalization contract before enforcement; guessing forwarded-host semantics could lock out valid production traffic.
- Immediate Firebase refresh-token revocation depends on Firebase Admin availability during socket revalidation. Failures reject new socket authentication and disconnect credentials that cannot be revalidated.
