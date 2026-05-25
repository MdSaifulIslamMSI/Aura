# Secret Leak Playbook

## Trigger

- Gitleaks or provider secret alert.
- Exposed token in logs, PR, issue, artifact, image, or bundle.

## Immediate Actions

1. Revoke or rotate the exposed secret immediately.
2. Identify where the secret was exposed.
3. Remove the secret from source, logs, artifact, or image.
4. Review audit logs for use of the exposed credential.
5. Invalidate dependent sessions or tokens if needed.
6. Add a scanner pattern or redaction rule if missing.

## Evidence

- Secret type, not the raw secret value.
- First exposure timestamp.
- Rotation timestamp.
- Audit trail of use.
- CI or scanner artifact.

## Recovery

- Verify the new secret is scoped and stored in the right secret manager.
- Confirm no frontend bundle contains private keys.
- Add regression scan evidence.
