# Aura Status Page Gap Audit

Audit base: `origin/main` at `12968ee6`, feature branch `feat/incidentio-grade-status-page`.

## Existing public features

- `/status`: implemented in `app/src/pages/Status/index.jsx` with overall status, active incidents, scheduled maintenance, grouped components, 90-day uptime bars, history link, RSS link, and email subscribe CTA.
- `/api/status/public`: implemented in `server/routes/statusRoutes.js`, `server/controllers/statusController.js`, and `server/services/statusService.js`; returns grouped public components, active incidents, active maintenance, 90-day history, status power, and last updated timestamp.
- RSS: implemented as `GET /api/status/rss` through `getStatusRssController`; includes incident and maintenance items from public history.
- Active incidents: modeled by `StatusIncident` and `StatusIncidentUpdate`; active public incidents are returned by `getActiveIncidentRows`.
- Incident history: implemented by `GET /api/status/history` and `/status/history`; includes public incidents and maintenance with timeline updates.
- 90-day uptime: implemented with `StatusDailyMetric`, `StatusCheck`, `UptimeBars`, and history rollups in `statusService`.

## Existing internal/admin features

- `/admin/status`: implemented in `app/src/pages/Admin/StatusDashboard.jsx`; supports component create/update, manual overrides, incident create/update/resolve, maintenance create, monitor run, recent checks, and subscriber overview.
- Mongo status models exist: `StatusComponentGroup`, `StatusComponent`, `StatusCheck`, `StatusDailyMetric`, `StatusIncident`, `StatusIncidentUpdate`, and `StatusSubscriber`.
- Background monitor exists: `startStatusMonitorWorker` runs `runStatusMonitorCycle`, recording `StatusCheck` rows and aggregating daily metrics.
- Subscriptions exist: `POST /api/status/subscribe` and `POST /api/status/unsubscribe` store hashed unsubscribe tokens and send best-effort email.
- Health exists: `/health`, `/health/live`, and `/health/ready` already use real DB/Redis/service readiness signals rather than a fake static OK.
- Metrics exist: `/metrics` exposes Prometheus HTTP metrics through `server/middleware/metrics.js`.

## Missing incident.io-level features

- Internal incident commander panel: partially present as `/admin/status`, but missing a dedicated `/admin/status/incidents` cockpit with commander assignment, severity declaration, templates, deployment links, action buttons, and postmortem controls.
- Severity levels: missing first-class `SEV1` / `SEV2` / `SEV3` / `SEV4`; current model uses only impact.
- Impact levels: present as `none` / `minor` / `major` / `critical` / `maintenance`, but maintenance is mixed into incidents instead of a dedicated maintenance window model.
- Timeline: partially present through `StatusIncidentUpdate`, but missing event types, public/private timeline split, actor text, deployment markers, mitigation/recovery event types, and embedded incident timeline metadata.
- Root cause analysis: missing first-class `rootCause`, `mitigation`, `prevention`, `customerImpact`, and postmortem generation fields.
- Automated monitor-to-incident creation: monitor worker marks components degraded/outage, but does not create incident drafts/public incidents based on repeated monitor failures or recovery.
- Maintenance windows: maintenance is currently represented as incidents with `impact: maintenance`; missing a dedicated `MaintenanceWindow` model and public maintenance endpoint.
- Subscriber notifications: present but request-thread email sending is best-effort direct send; missing queued outbox, retries, idempotency keys, and event-scoped notification policy.
- Incident templates: missing standardized production update templates for investigating, identified, monitoring, and resolved states.
- Postmortem generation: missing API and admin UI action for SEV1/SEV2 postmortems.
- GitHub Actions deploy watch: missing workflow and webhook behavior for CI/deploy timeline markers and incident drafts.
- Alert deduplication: missing webhook event idempotency/dedup model and source-state suppression.
- Component dependency graph: missing first-class component dependencies and dependency-aware rollups.
- Status page cache fallback: API has short cache headers, but the frontend does not yet use static snapshot/localStorage fallback and the backend does not generate `status-snapshot.json`/`.html`.

## Recommended upgrade path

- Keep existing status service, route, and React page structure; extend schemas and serializers instead of replacing them.
- Add compatibility aliases for the requested incident.io-style field names while preserving current `currentStatus`, `isPublic`, `affectedComponentIds`, and update collection behavior.
- Split maintenance into a dedicated model and API while continuing to surface legacy maintenance incidents until data is migrated.
- Add monitor webhook ingestion with HMAC, timestamp replay protection, idempotency, rate limiting, and no automatic SEV1 creation.
- Queue subscriber emails through a Mongo outbox and let the existing request handlers enqueue notification work.
- Generate static snapshots from the same public payload so `/status` can fail over to live API, snapshot JSON, localStorage, then unavailable message.
