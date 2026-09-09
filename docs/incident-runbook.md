# Incident Runbook

Stack reality (matches `infra/aws/` and the deploy workflows): the API and its
background workers run as Docker Compose services (`api`, `worker`) on EC2
behind a Caddy edge and CloudFront/WAF. Config and secrets come from SSM
Parameter Store synced to `/opt/aura/shared/*.env`. The frontend is hosted on
Netlify/Vercel/AWS S3. There is no Kubernetes, no Argo CD, and no Loki.

## First Five Minutes

- Name an incident owner and a communications owner.
- Confirm whether the issue is staging or production.
- Check public `GET /health` and liveness `GET /health/live` on the backend origin.
- Check the Uptime Probe workflow's latest runs (probe every 30 minutes; it
  fails loudly if unconfigured).
- Check `infra/observability` Prometheus/Grafana on the EC2 host
  (`127.0.0.1:9090`, `127.0.0.1:3001` over SSH) — Alertmanager receivers post
  to the Aura status webhook; check admin notifications in the status system.
- Check the last runs of the scheduled workflows: Uptime Probe, Production DB
  Backup (including its `freshness` job).

## 1) API Availability Incident
- Check public `GET /health`.
- Check detailed `GET /health/ready` with the `x-health-token` header from the
  production readiness secret. Failure reasons are returned in the payload
  (`catalog_stale`, `split_runtime_workers_unavailable`, `index_integrity_failed`).
- On the EC2 host (SSH or SSM Run Command):
  - `cd <compose-dir> && docker compose ps` — is `api` restarting/exited?
  - `docker compose logs --tail=200 api` — look for `server.unhandled_rejection`,
    `server.uncaught_exception`, Mongo/Redis connect failures.
  - `docker compose restart api` — if the process is crash-looping, prefer
    redeploying the previous image over restarting the same one.
- Check the last deploy: `.github/workflows/deploy-backend-aws.yml` runs a
  health gate and auto-rolls back via `infra/aws/rollback-backend.sh`; if the
  incident started right after a deploy, trigger the rollback workflow.
- Validate DB connectivity (Atlas shared tier) and Redis before suspecting app code.

## 2) OTP Delivery Incident
- Confirm provider credentials and gateway errors.
- Verify fail-closed behavior (`/api/otp/send` should return 503 on provider failure).
- Inspect `OtpSession` creation and expiry behavior.

## 3) Payment Capture Incident
- Check `PaymentOutboxTask` for pending/failed capture tasks.
- Requeue/retry via admin operations where needed.
- Verify intent/order state transitions and idempotency records.
- If the `worker` compose service is down, capture jobs stall: check
  `docker compose ps worker` and the API's `/health/ready`
  `split_runtime_workers_unavailable` reason.

## 4) Order Email Delivery Incident
- Query `/api/admin/order-emails` by status.
- Retry failed notifications with idempotency key.
- Verify terminal alert path to ops mailbox.

## 5) Backup / Data Incident
- Confirm last good backup: newest object under `s3://$AURA_BACKUP_BUCKET/production/mongo/`.
- Verify integrity: the drill mode of
  `scripts/production/restore-production-mongo.sh` (`RESTORE_DRILL=true`)
  restores into an isolated container without touching live data.
- Follow `docs/security/disaster-recovery-runbook.md` for the full drill and
  guarded live-restore procedure.

## 6) Security Incident
- Rotate exposed credentials immediately.
- Restrict CORS allowlist and verify admin-only route protection.
- Audit recent profile updates and privilege-related changes.
- Disable a compromised release by redeploying the previous backend image via
  the rollback workflow; frontend rollbacks have dedicated workflows
  (`rollback-netlify`, `rollback-storefront-vercel`, `rollback-gateway-vercel`,
  `rollback-frontend-aws`).

## Alerting Layers

1. Alertmanager (`infra/observability/`) receives Prometheus rule alerts and
   posts to the Aura status webhook (`/api/status/webhooks/alertmanager`,
   bearer-token auth via the shared status webhook token).
2. Scheduled workflow failures (Uptime Probe, Production DB Backup +
   freshness) surface as GitHub failure notifications.
3. In-app admin notifications for monitor/status events.
