# TLS 1.3 And Hybrid-PQC Edge Readiness

TLS 1.3-only operation is a hardening target, not a claim that production currently meets it. Browser/WebPKI hybrid PQC support is provider and ecosystem dependent; do not force experimental OQS/liboqs into production.

## Production Findings And Remediation (2026-10-16)

- `dip82eloip5zb.cloudfront.net` negotiated TLS 1.0 and 1.1 and served HTTP 200 with a certificate-verified, legacy-capable client. The previous TLS 1.2 floor report was incorrect: OpenSSL's local `ERR_SSL_NO_PROTOCOLS_AVAILABLE` had been treated as server rejection.
- `scripts/security/tls-posture-probe.cjs` now relaxes client cipher security only on diagnostic legacy sockets. Only an explicit peer protocol-version alert proves rejection; client/network failures remain inconclusive and fail the gate. Runtime TLS settings are not relaxed.
- The backend origin rejects TLS 1.0/1.1. Both public endpoints completed certificate-verified TLS 1.3 handshakes offering only `X25519MLKEM768`. This demonstrates optional hybrid key exchange, not mandatory PQC or post-quantum certificate authentication.
- CloudFront's default certificate uses the `TLSv1` viewer policy regardless of a claimed `MinimumProtocolVersion`. The account has no registered domain, hosted zone, or ACM certificate in `us-east-1`. An owned custom domain, validated ACM certificate, alias/DNS rollout, and supported modern viewer policy are required before legacy rejection can be enforced there. A `TLSv1.3_2025` policy requires a custom certificate; `TLSv1.3_2021` is not a valid policy.
- CloudFront origin protocol values are `SSLv3`, `TLSv1`, `TLSv1.1`, and `TLSv1.2`, not viewer-policy names. Keep HTTPS-only with a TLS 1.2 minimum: do not submit unsupported TLS 1.3 values, and do not infer the negotiated origin protocol or full-path PQC from that minimum. Changing this provider limitation requires a separate supported architecture decision.
- All four audited S3 buckets now have an append-only `DenyInsecureTransport` policy over the bucket and its objects. AWS service principals are excluded because service-to-service network context can be redacted. Existing CloudFront grants are preserved; no new public access is granted. The utility defaults to dry-run, requires an expected account owner for apply, rereads before writing, and verifies readback. S3 has no conditional policy write, so operators must serialize changes. An HTTPS-only policy is incompatible with HTTP-only S3 website endpoints; private CloudFront REST origins continue to work.

Do not lower `minExpected`, remove the CloudFront target, or mark a failed gate green while the default-certificate exposure remains unresolved.

AWS references:
- [ViewerCertificate constraints](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_ViewerCertificate.html)
- [Supported viewer policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/secure-connections-supported-viewer-protocols-ciphers.html)
- [OriginSslProtocols values](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_OriginSslProtocols.html)

The reusable S3 remediation is `node scripts/security/enforce-s3-https.mjs --help`. Re-running it without `--apply` checks current policy without changing AWS. The backend and frontend bootstraps use the same append-only policy helper so later provisioning does not silently remove the denial.

## Production-Ready Controls

- Require TLS 1.3 where Aura directly terminates TLS.
- Avoid legacy protocol versions and known weak ciphers.
- Use HSTS after domain ownership and rollback paths are confirmed.
- Keep certificate private keys short-lived and rotatable.
- Keep provider-managed certificates documented in the provider dependency register.

## Lab/Staging Only

- OQS Provider experiments.
- liboqs proxy experiments.
- PQ certificate chains not accepted by mainstream browser/WebPKI clients.
- Any custom app-level protocol wrapper.

## Verification

```sh
node scripts/security/tls-config-readiness.mjs --json --markdown
node scripts/security/tls-endpoint-pqc-readiness.mjs --json --markdown
npm run security:pqc:proof
```

The configuration checker fails TLS termination configurations that enable legacy protocols or lack an enforceable TLS 1.3 minimum. In particular, the default-certificate CloudFront replica must remain failing, even if it contains an ignored or invalid security-policy string. Plain internal HTTP templates are recorded as not TLS-terminating because they sit behind a separate edge or private-network control; this is not proof that the internal hop is encrypted.

Run `npm run security:tls:posture` for fresh edge measurements. The corrected probe is expected to fail while CloudFront accepts legacy TLS. Report generation is evidence collection, not a deployment. Handshake probes alone do not prove certificate trust, HTTP behavior, or the protocol on a different network hop.

Set `PQC_TLS_TARGET_URL` only for an explicitly approved read-only staging or production endpoint probe. The endpoint report validates negotiated TLS version, legacy protocol rejection, certificate metadata, and HSTS header presence without storing certificate bodies or response bodies. It does not prove browser/WebPKI PQC support.

## Rollback

1. Restore the previous edge config.
2. Keep stable TLS 1.3 enabled.
3. Remove only the experimental hybrid/OQS setting that caused the regression.
4. Re-run the TLS checker and the aggregate PQC proof.
