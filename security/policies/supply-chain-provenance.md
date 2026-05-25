# Supply Chain Provenance Policy

Last updated: 2026-05-25

Release artifacts must be traceable from source commit to SBOM, scanner reports, provenance, and deployment evidence.

## Required Controls

| Control | Requirement | Evidence |
|---|---|---|
| SBOM | Generate SPDX SBOM for every security gate and release | `sbom.spdx.json` artifact |
| Provenance | Attest SBOM/build provenance on main branch pushes | GitHub artifact attestation |
| Signing | Sign container images or distributable artifacts with Sigstore/Cosign before production promotion | Cosign signature or release attestation |
| Verification | Verify signature/provenance before deploy where the platform supports it | Deploy log or verification report |
| Action pinning | Block mutable workflow action refs such as `main`, `master`, `latest`, and `stable` | `npm run security:supply-chain-pins` |
| Scanner image pinning | Use explicit scanner image tags and document exceptions | `run-docker-tool.mjs` review |
| Dependency provenance | Review dependency source, lockfiles, and high-risk updates | Dependency scan and PR review |

## Definition Of Done

- SBOM exists for the release.
- Provenance/attestation links the artifact to the commit.
- Image or artifact signature is verified before production deploy.
- Mutable workflow action references are blocked by CI.
- Critical dependency updates get a dedicated security review.
