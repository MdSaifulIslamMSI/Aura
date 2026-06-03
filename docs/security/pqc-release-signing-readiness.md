# PQC Release Signing Readiness

Aura currently relies on classical ecosystem signing and provenance surfaces: Electron/platform signing, mobile app store signing, GitHub release artifacts, SBOMs, and GitHub artifact attestations. This is expected today. The project must not invent custom artifact signing while ML-DSA/SLH-DSA release-signing ecosystems are still maturing.

## Current State

- Desktop packaging is configured in `package.json`.
- GitHub security gates generate SBOM/provenance evidence on main pushes.
- Mobile signing remains platform/app-store controlled.
- Docker image provenance and signing should use existing free ecosystem tooling where accepted.

## Future PQ Signature Path

- Track ML-DSA and SLH-DSA support in mainstream artifact signing tools.
- Use Sigstore/cosign only where repo policy accepts the free toolchain and key-management model.
- Prefer GitHub artifact attestations already represented in CI.
- Keep signing keys rotatable and scoped.
- Record migration evidence before changing release enforcement.

## Acceptance Criteria For Future PQ Signatures

- Tooling is standards-aligned and maintained.
- CI can verify signatures without secrets in logs.
- Rollback to accepted classical release signing remains possible.
- Provider/app-store compatibility is confirmed.
- No custom cryptography is introduced.

## Verification

```sh
node scripts/security/release-signing-readiness-check.mjs --json --markdown
```

The checker validates repo-owned signing posture: desktop package signing settings, explicit desktop/mobile release preflights, SBOM generation, provenance attestations, and absence of committed private key material. It does not claim that current operating systems, app stores, or release ecosystems support PQ signatures.
