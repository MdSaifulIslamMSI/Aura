# Upload Security Operations

Aura now routes server-accepted upload buffers and data URIs through the common upload security pipeline before persistence or provider use.

## Covered Paths

- Review media direct uploads.
- Profile avatar data URI updates.
- Marketplace listing image data URI create/update.
- Assistant image and audio data URI attachments.
- Gemini remote inline media fetches after SSRF/private-network checks.
- Visual search image data URI requests.

Support/contact, admin product images, analytics CSV, and catalog imports are currently text, URL, generated download, or reference-only surfaces. If those become raw body or multipart upload endpoints, route them through `server/services/uploadSecurityPipeline.js` or a quarantine-first async worker before accepting files.

## Runtime Scanner Activation

Default local Docker runtime:

```sh
UPLOAD_MALWARE_SCAN_ENABLED=true CLAMAV_ENABLED=true YARA_ENABLED=true docker compose --profile malware-scan up
npm run security:malware-runtime
```

Local split runtime:

```sh
UPLOAD_MALWARE_SCAN_ENABLED=true CLAMAV_ENABLED=true docker compose --profile malware-scan -f docker-compose.split-runtime.yml up
npm run security:malware-runtime
```

EC2/staging runtime:

```sh
UPLOAD_MALWARE_SCAN_ENABLED=true
UPLOAD_MALWARE_SCAN_FAIL_CLOSED=true
CLAMAV_ENABLED=true
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
YARA_ENABLED=true
YARA_RULES_PATH=/security/yara-rules
```

Start the compose stack with the `malware-scan` profile so the `clamav/clamav:1.4` service is present. The API reads `UPLOAD_MALWARE_SCAN_ENABLED`, `CLAMAV_ENABLED`, `CLAMAV_HOST`, `CLAMAV_PORT`, `YARA_ENABLED`, and `YARA_RULES_PATH` from compose environment in both the default local stack and split runtime stack. The backend image installs the `yara` binary; local and staging compose mounts should provide rules at `/security/yara-rules`. Keep `UPLOAD_MALWARE_SCAN_FAIL_CLOSED=true` outside local experiments.

Review media uploads are now quarantine-first: new files are written with `pending` scan state, promoted to the public review media path only after a `clean` result, and kept blocked from `/uploads/reviews/...` while `pending` or `infected`.

## Validation

- `npm run security:malware-runtime` verifies built-in EICAR blocking and, when enabled, confirms configured scanner engines do not fail closed on a clean PNG.
- `npm run security:post-merge-smoke` runs repo-safe checks and runs live staging smoke only when `SMOKE_BASE_URL` is set.
- `npm run observability:validate` confirms Prometheus has upload alerts for malware blocks, scan failures, and MIME/magic mismatch bursts.

## Alerts

Prometheus alert rules live in `infra/observability/prometheus/alerts/login-security.yml`:

- `AuraUploadMalwareBlocked`
- `AuraUploadScanUnavailable`
- `AuraUploadMimeMismatchBurst`

Treat malware blocks and scan unavailability as incident signals. MIME/magic mismatch bursts usually indicate probing or client-side upload bugs.
