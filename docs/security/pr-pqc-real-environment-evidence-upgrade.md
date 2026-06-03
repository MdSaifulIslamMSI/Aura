# PR: PQC Real Environment Evidence Upgrade

## Goal

Upgrade the previous controllable-surface PQC proof with scorecard, optional real-environment evidence paths, provider honesty checks, release-signing readiness, and CI artifact collection.

## What Changed

- Added `scripts/security/pqc-maturity-scorecard.mjs` for previous/current maturity percentages.
- Added optional read-only TLS endpoint evidence through `scripts/security/tls-endpoint-pqc-readiness.mjs`.
- Added SSH, internal service, backup, and lab benchmark evidence subreports to the existing aggregate proof.
- Added `scripts/security/release-signing-readiness-check.mjs` for desktop/mobile/SBOM/provenance signing posture.
- Added `scripts/security/pqc-provider-register-check.mjs` so provider unknowns lower full end-to-end score without failing repo evidence.
- Updated CI to upload the expanded evidence bundle.

## Safety Boundaries

- No custom cryptography.
- No committed secrets, private keys, generated certificates, or generated key artifacts.
- No OQS/liboqs production enablement.
- No scanner weakening.
- No production deploy, redeploy, destructive restore, or provider setting change without explicit approval.
- Strict failures are limited to repo-owned or deliberately configured evidence gaps.

## Verification

```sh
npm run security:pqc:proof:strict
npm run security:pqc:scorecard:strict
npm run security:pqc:provider-register
npm --prefix server test -- --runTestsByPath tests/pqcDeploymentProof.test.js tests/pqcEnvironmentEvidence.test.js tests/pqcMaturityScorecard.test.js --forceExit
npm run security:pqc
npm run security:free-stack
npm run security:admin
npm test
npm run lint
npm run build
```

## Honest Outcome

Aura improves practical repo-owned PQC readiness and proof coverage, but full end-to-end PQC remains provider and ecosystem dependent. The scorecard keeps that limitation visible instead of converting missing provider evidence into a false pass.
