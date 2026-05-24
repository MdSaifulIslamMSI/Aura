# Login Security Observability

## Purpose
This document defines the local login security telemetry added for the P1 observability slice. It is intentionally app-layer only: it does not change login, OTP, recovery, trusted-device, or admin authorization behavior.

## Prometheus Metric

`aura_auth_security_events_total`

Labels:
- `event`: bounded event name such as `login_session`, `login_failure`, `otp_challenge`, `otp_verify`, `password_reset`, `csrf_rejected`, `trusted_device_challenge`, `trusted_device_verify`, `recovery_code`, `step_up_required`, `admin_access_blocked`.
- `outcome`: `success`, `failure`, `blocked`, `required`, or `issued`.
- `reason`: low-cardinality bucket such as `none`, `missing`, `invalid`, `expired`, `mismatch`, `locked`, `already_used`, `passkey`, `second_factor`, `allowlist`, `unverified`, `unavailable`, `denied`, `required`, or `other`.
- `surface`: `auth`, `otp`, `csrf`, `admin`, `trusted_device`, or `recovery`.

The same helper emits a structured JSON log named `auth.security_event` with request ID, HTTP method, normalized path, surface, event, outcome, reason, and safe metadata.

Upload validation and malware gates emit `aura_upload_security_events_total` plus structured `upload.security_event` logs. The labels are bounded to event, outcome, reason, and purpose so Prometheus cardinality stays predictable.

## Event Coverage

| Surface | Events |
|---|---|
| Login/session | session sync success, session check success, missing/expired/failed sessions, token failures |
| OTP | OTP challenge issued, OTP verification success/failure, password reset success/block |
| CSRF | CSRF rejected for missing, invalid, or unsafe token transport |
| Trusted device | challenge issued/required, verification success/failure |
| Recovery | backup recovery codes issued, recovery code success/failure |
| Admin | admin access blocks for non-admin, allowlist, stale session, missing second factor, missing passkey, unverified email |
| Step-up | sensitive action blocks for fresh login, trusted device, cryptographic trusted device, stronger session, or degraded system requirements |

## Provisioned Assets

Repo-owned Prometheus and Grafana assets live under `infra/observability`.

| Asset | Path | Purpose |
|---|---|---|
| Prometheus alert rules | `infra/observability/prometheus/alerts/login-security.yml` | Alert on login failures, OTP failures, recovery-code abuse, admin blocks, CSRF bursts, trusted-device failures, and step-up pressure. |
| Local Prometheus scrape config | `infra/observability/prometheus/prometheus.local.yml` | Scrape the split-runtime `backend:5000` container. Development metrics auth is skipped by the API. |
| EC2 Prometheus scrape config | `infra/observability/prometheus/prometheus.ec2.yml` | Scrape the production `api:5000` container with `x-metrics-key: <METRICS_SECRET>`. |
| Grafana datasource provisioning | `infra/observability/grafana/provisioning/datasources/prometheus.yml` | Provision Prometheus as datasource UID `prometheus`. |
| Grafana dashboard provisioning | `infra/observability/grafana/provisioning/dashboards/aura-login-security.yml` | Load dashboards from `/var/lib/grafana/dashboards`. |
| Login security dashboard | `infra/observability/grafana/dashboards/login-security-observability.json` | Show event rates, critical events, login/OTP reasons, CSRF rejections, recovery/admin signals, and step-up pressure. |

Local run:

```powershell
docker compose -f docker-compose.split-runtime.yml -f infra/observability/docker-compose.local.yml up --build
```

Then open Grafana at `http://localhost:3001` and sign in with `admin` / `admin`.

EC2 overlay:

```bash
sudo install -m 600 -o root -g root /dev/null /opt/aura/shared/metrics-secret
printf '%s' "$METRICS_SECRET" | sudo tee /opt/aura/shared/metrics-secret >/dev/null
GRAFANA_ADMIN_PASSWORD='replace-me' docker compose \
  -f infra/aws/docker-compose.ec2.yml \
  -f infra/observability/docker-compose.ec2.yml \
  up -d prometheus grafana
```

The EC2 overlay binds Prometheus and Grafana to `127.0.0.1` only. Put them behind an existing private tunnel, VPN, or authenticated internal ingress before exposing them to operators.

## Starter Alerts

Use short windows for page-worthy spikes and longer windows for trend dashboards. Tune thresholds after observing normal traffic.

| Alert | Starter expression idea | Initial severity |
|---|---|---|
| Brute-force or credential stuffing spike | `sum(increase(aura_auth_security_events_total{event="login_failure"}[5m])) > 25` | warning |
| OTP abuse or enumeration pressure | `sum(increase(aura_auth_security_events_total{event="otp_verify",outcome="failure"}[5m])) > 50` | warning |
| Recovery-code abuse | `sum(increase(aura_auth_security_events_total{event="recovery_code",outcome="failure"}[15m])) > 3` | page |
| Admin access block spike | `sum(increase(aura_auth_security_events_total{event="admin_access_blocked"}[10m])) > 1` | page |
| CSRF rejection burst | `sum(increase(aura_auth_security_events_total{event="csrf_rejected"}[5m])) > 25` | warning |
| Trusted-device verification failures | `sum(increase(aura_auth_security_events_total{event="trusted_device_verify",outcome="failure"}[10m])) > 10` | warning |
| Step-up pressure | `sum(increase(aura_auth_security_events_total{event="step_up_required"}[10m])) > 25` | info |
| Malware upload blocked | `sum(increase(aura_upload_security_events_total{event="malware_blocked"}[15m])) > 0` | page |
| Upload scan unavailable | `sum(increase(aura_upload_security_events_total{event="malware_scan_unavailable"}[10m])) > 0` | page |
| Upload MIME/magic mismatch burst | `sum(increase(aura_upload_security_events_total{event=~"magic_mismatch|mime_mismatch|unsupported_mime|unsupported_extension"}[10m])) > 10` | warning |

## Triage Notes

1. Start with `auth.security_event` logs filtered by `requestId`, then pivot to surrounding `HTTP Request` logs.
2. Treat recovery-code failures and admin access blocks as higher signal than ordinary login failures.
3. For CSRF bursts, compare `path`, `sec-fetch-site`, and client route diagnostics before assuming active attack.
4. For trusted-device failures, separate enrollment failures from assertion failures using the `mode` and `method` metadata when present.
5. Keep labels bounded. Add new reason buckets only for durable operational decisions, not raw error text.

## Verification

Local checks:
- `npm.cmd run observability:validate`
- `npm.cmd --prefix server test -- --runTestsByPath tests/authSecurityTelemetryService.test.js`
- `npm.cmd --prefix server test -- --runTestsByPath tests/metricsAuth.test.js`
- `npm.cmd run security:login-gates`
