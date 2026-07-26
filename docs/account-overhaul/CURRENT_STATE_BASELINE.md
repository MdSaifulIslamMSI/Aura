# Account and Profile Overhaul: Current-State Baseline

## Audit boundary

This baseline was captured on 2026-07-26 before changing account or profile application code. It covers the local checkout, the account-related frontend and backend surfaces, local quality gates, and the unauthenticated production route boundary.

No production mutation, deployment, database migration, secret change, or account/profile application-code change was performed during this phase.

## Source state

| Item | Observed state |
|---|---|
| Repository | `Kimi_Agent_Flipkart-Style Frontend` |
| Local branch | `codex/premium-login-access-console` |
| Local HEAD | `0e4216c8fbf537f79f75f25a119f4dde13efd33b` |
| Upstream | `origin/codex/premium-login-access-console` |
| Existing worktree change | Untracked `tmp/`; treated as user-owned and left untouched |
| Runtime | Node `v24.15.0`, npm `11.12.1` |
| Lockfiles | Root, `app/`, and `server/` use npm lockfile version 3 |
| Live release observed | `1c44b26e27aab5203b9b546c9a2efd8c4c4e96b4` on the Netlify surface |
| Source/live relationship | Live is not the audited local SHA. Live screenshots cannot validate this checkout. |

## Implementation branch note

After the immutable baseline was recorded, implementation moved to `codex/account-profile-overhaul`, initially created from refreshed `origin/main` at `440d44bab2f73ee8dac335c3d972a26406bacf1e`. Before final verification it was reconciled without conflict to current `origin/main` at `f451584d283210163c831bb0b23bf5211de32c3a`. The baseline branch/SHA above is intentionally retained as historical evidence rather than rewritten. The pre-existing untracked `tmp/` directory remains user-owned and untouched.

## Dependency installation

Locked installs were run at root, `app/`, and `server/` with `npm ci`. The installs completed and `npm ls --depth=0` subsequently resolved the installed top-level packages. No audit fix or dependency upgrade was applied.

## Verification results

| Command or check | Result | Evidence and limitation |
|---|---|---|
| Focused profile frontend tests | **PASS** | `npm test -- src/pages/Profile/index.test.jsx src/pages/Profile/components/SettingsSection.test.jsx`: 2 files, 14 tests, 48.88 s |
| Focused user/profile backend tests | **PASS** | `npm test -- --runTestsByPath tests/userRoutes.test.js tests/profileSecurity.test.js tests/userControllerAvatarValidation.test.js tests/userPhoneIndex.test.js --forceExit`: 4 suites, 16 tests, 85.451 s |
| Frontend lint | **PASS with warnings** | Exit 0; 49 React hook warnings across the repository, including `Profile/index.jsx` and `Profile/components/SupportSection.jsx` |
| Type-check status | **SKIPPED by project command** | Exit 0, but `quality:typecheck` reports that the repository has no TypeScript project configuration |
| Frontend build budget | **PASS** | Vite build completed in 22.03 s; initial payload 240.35 kB gzip; all JS 4018.08 kB gzip; initial CSS 59.97 kB gzip |
| Profile route bundle | **OBSERVED** | `Profile-TOgfwD71.js` is 129.66 kB minified / 29.28 kB gzip |
| Largest lazy chunk | **OBSERVED** | `admin-dashboard-BDEzkCJ0.js` is 929.64 kB minified; Vite emitted a large-chunk warning |
| Environment contract | **PASS, staging blocked** | Development contract passed; live staging URLs are not configured |
| Sensitive-route coverage | **PASS** | `npm run security:routes` reports coverage passed for `server/routes` |
| CI/CD structural doctor | **PASS** | All critical workflow and rollback structure checks passed |
| Root full test suite | **TIMEOUT** | Did not complete within 604 s; not a pass |
| Frontend full test suite | **TIMEOUT** | Did not complete within 604 s; not a pass |
| Backend full test suite | **TIMEOUT** | Did not complete within 904 s; not a pass |
| Local orchestration | **FAIL** | `npm run dev:on` points to missing `scripts/dev-on.ps1` |
| Authenticated account browser audit | **BLOCKED** | No authenticated account session was available in the controlled browser |

Timed-out Vitest/Jest children and their Mongo test helpers were resolved by exact command line and stopped after the bounded runs. No unrelated processes were terminated.

## Dependency audit snapshot

`npm audit --json` was run without applying fixes.

| Scope | Moderate | High | Critical | Total |
|---|---:|---:|---:|---:|
| Root | 1 | 11 | 0 | 12 |
| Frontend | 2 | 7 | 0 | 9 |
| Backend | 1 | 1 | 0 | 2 |

These counts require package-level triage before release. They do not by themselves prove exploitability, and automatic upgrades must not be applied without reviewing the dependency paths and regression risk.

## Browser evidence

The live `/profile` route redirected an unauthenticated browser to `/login`, demonstrating that the route is protected. It does not validate the local profile implementation because the live release SHA differs from this checkout.

- [Desktop protected-route redirect](evidence/screenshots/live-profile-protected-redirect-desktop.jpg)
- [390 px protected-route redirect](evidence/screenshots/live-profile-protected-redirect-mobile.jpg)

The 390 px live capture visibly clips content horizontally in the sign-in experience. This is a live auth-surface observation, outside the local account implementation, and should be independently reproduced against the matching source before it is assigned to this overhaul.

## Current frontend observations

- `app/src/pages/Profile/index.jsx` is a 1,408-line orchestration component with ten horizontal sections and broad cross-domain state.
- Profile mount eagerly loads profile/dashboard, payment methods, rewards, trust status, and account intelligence.
- A 45-second active-window refresh repeats broad account requests, including data for inactive sections.
- Profile presentation is split across components, but `SettingsSection.jsx` is approximately 67 kB and `SupportSection.jsx` approximately 93 kB.
- Legacy light components are visually remapped through large global profile selectors in `app/src/styles.css`.
- The main profile route is protected, but wishlist is a separate public route and marketplace/account destinations are scattered.
- Existing tests cover important profile rendering and security behavior but do not provide authenticated end-to-end account-center coverage.

## Current backend observations

- Express routes are grouped by domain, but account behavior spans auth, users, orders, payments, support, notifications, listings, trade-in, uploads, and price alerts.
- MongoDB/Mongoose is the durable data layer; Redis holds server-side browser sessions and supports user- and device-scoped revocation internally.
- User profile mutations use explicit field allowlists and fresh proof for phone changes.
- Avatar validation is fail-closed for allowed MIME types, size, magic bytes, and malware scanning, but successful uploads remain base64 data URIs embedded in the user document.
- Orders and trade-ins enforce server-side ownership in the inspected routes.
- Payment routes apply auth, active-account, step-up, and ownership guards.
- Privacy export/erasure is documented as a required workflow, but no customer-facing implementation was found.

## Baseline blockers before implementation or release

1. Re-establish a clean source relationship to the intended target branch; do not deploy from a checkout behind the observed live release.
2. Restore or replace the missing local orchestration scripts with an intentional, documented workflow.
3. Obtain a test account or deterministic authenticated fixture for desktop, tablet, and mobile account screenshots.
4. Triage the dependency audit findings.
5. Make broad suites produce bounded, reportable results or split them into deterministic CI shards.
6. Define legal retention, deletion grace-period, and export-delivery requirements before privacy implementation.
7. Preserve the existing auth, MFA, passkey, trusted-device, payment, and ownership boundaries during any modularization.
