const crypto = require('crypto');
const mongoose = require('mongoose');

const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const StatusComponent = require('../models/StatusComponent');
const StatusIncident = require('../models/StatusIncident');
const StatusWebhookEvent = require('../models/StatusWebhookEvent');
const {
    addIncidentUpdate,
    createStatusIncident,
    updateStatusComponent,
    updateStatusIncident,
    writeStatusAuditLog,
} = require('./statusService');
const { incrementStatusMonitorFailure } = require('../middleware/metrics');
const { getTrustedRequestIp } = require('../utils/requestIdentity');

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;

const normalizeSlug = (value = '') => {
    const slug = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 160);
    return slug || 'unknown';
};

const safeEqual = (left, right) => {
    const leftBuffer = Buffer.from(String(left || ''), 'utf8');
    const rightBuffer = Buffer.from(String(right || ''), 'utf8');
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const hashPayload = (value = '') => crypto.createHash('sha256').update(String(value || '')).digest('hex');

const getWebhookSecret = (source = '') => {
    const normalized = String(source || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    return String(
        process.env[`STATUS_${normalized}_WEBHOOK_SECRET`]
        || process.env.STATUS_WEBHOOK_SECRET
        || (process.env.NODE_ENV === 'production' ? '' : 'dev-status-webhook-secret')
    ).trim();
};

const getWebhookBearerToken = () => String(process.env.STATUS_WEBHOOK_TOKEN || process.env.STATUS_WEBHOOK_SECRET || '').trim();

const assertIpAllowed = (req) => {
    const allowlist = String(process.env.STATUS_WEBHOOK_IP_ALLOWLIST || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (!allowlist.length) return;
    const ip = getTrustedRequestIp(req);
    if (!allowlist.includes(ip)) {
        throw new AppError('Status webhook source is not allowlisted', 403);
    }
};

const assertWebhookSignature = ({ source, req, rawBody = '' }) => {
    assertIpAllowed(req);
    const authorization = String(req.get('authorization') || '').trim();
    const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    const configuredBearer = getWebhookBearerToken();
    if (source === 'github_actions' && configuredBearer && safeEqual(bearer, configuredBearer)) {
        return;
    }

    const secret = getWebhookSecret(source);
    if (!secret) {
        throw new AppError('Status webhook secret is not configured', 503);
    }
    const timestamp = String(req.get('x-aura-timestamp') || req.get('x-timestamp') || '').trim();
    const signature = String(
        req.get('x-aura-signature')
        || req.get('x-signature')
        || req.get('x-hub-signature-256')
        || ''
    ).trim().replace(/^sha256=/i, '');
    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > FIVE_MINUTES_MS) {
        throw new AppError('Status webhook timestamp is invalid or expired', 401);
    }
    const expectedWithTimestamp = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    const expectedRaw = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!signature || (!safeEqual(signature, expectedWithTimestamp) && !safeEqual(signature, expectedRaw))) {
        throw new AppError('Status webhook signature is invalid', 401);
    }
};

const resolveEventId = ({ source, payload = {}, req }) => String(
    req.get('idempotency-key')
    || req.get('x-idempotency-key')
    || payload.idempotencyKey
    || payload.eventId
    || payload.heartbeat?.id
    || payload.monitor?.id
    || payload.workflow_run?.id
    || `${source}:${payload.workflow || payload.alertname || payload.name || payload.monitorName || Date.now()}`
).trim();

const recordWebhookEvent = async ({ source, eventId, rawBody, req, payloadSummary = {} }) => {
    const idempotencyKey = `${source}:${eventId}`;
    const bodyHash = hashPayload(rawBody);
    const existing = await StatusWebhookEvent.findOne({ idempotencyKey });
    if (existing) {
        existing.hitCount = Number(existing.hitCount || 0) + 1;
        existing.lastSeenAt = new Date();
        existing.state = 'duplicate';
        await existing.save();
        return { duplicate: true, event: existing };
    }
    const event = await StatusWebhookEvent.create({
        source,
        eventId,
        idempotencyKey,
        bodyHash,
        requestIp: getTrustedRequestIp(req),
        payloadSummary,
    });
    return { duplicate: false, event };
};

const inferMonitorStatus = (payload = {}) => {
    const raw = String(
        payload.status
        || payload.state
        || payload.heartbeat?.status
        || payload.alert?.status
        || payload.monitor?.status
        || ''
    ).trim().toLowerCase();
    if (['1', 'up', 'ok', 'healthy', 'resolved', 'recovered', 'success'].includes(raw)) return 'up';
    if (['0', 'down', 'failed', 'firing', 'critical', 'unhealthy', 'error'].includes(raw)) return 'down';
    if (payload.heartbeat?.status === 0) return 'down';
    if (payload.heartbeat?.status === 1) return 'up';
    return raw.includes('down') || raw.includes('fail') ? 'down' : 'up';
};

const resolveMonitorSlug = (payload = {}) => normalizeSlug(
    payload.component
    || payload.componentSlug
    || payload.monitorSlug
    || payload.monitor?.slug
    || payload.monitor?.name
    || payload.heartbeat?.name
    || payload.name
    || payload.monitorName
);

const findComponentForMonitor = async (payload = {}) => {
    const slug = resolveMonitorSlug(payload);
    return StatusComponent.findOne({
        $or: [
            { slug },
            { 'metadata.monitorSlug': slug },
            { 'metadata.uptimeKumaName': new RegExp(`^${String(payload.monitor?.name || payload.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        ],
    });
};

const getActiveIncident = async (id) => {
    if (!id || !mongoose.isValidObjectId(id)) return null;
    return StatusIncident.findOne({ _id: id, status: { $ne: 'resolved' } });
};

const handleMonitorWebhook = async ({ source, payload = {}, event }) => {
    const component = await findComponentForMonitor(payload);
    if (!component) {
        event.state = 'processed';
        event.payloadSummary = { ...event.payloadSummary, component: 'not_found' };
        await event.save();
        return { processed: true, componentFound: false };
    }

    const monitorStatus = inferMonitorStatus(payload);
    const state = component.metadata?.monitorState || {};
    const now = new Date();
    let incident = await getActiveIncident(state.activeIncidentId);

    if (monitorStatus === 'down') {
        const downSince = state.downSince ? new Date(state.downSince) : now;
        const failureCount = Number(state.failureCount || 0) + 1;
        incrementStatusMonitorFailure({ component: component.slug, source });
        component.metadata = {
            ...(component.metadata || {}),
            monitorState: {
                ...state,
                downSince,
                failureCount,
                recoveryCount: 0,
                lastWebhookAt: now,
                lastWebhookSource: source,
            },
        };
        await updateStatusComponent(component._id, {
            currentStatus: failureCount >= 3 ? 'partial_outage' : 'degraded_performance',
            metadata: component.metadata,
        });

        if (failureCount >= 3 && !incident) {
            incident = await createStatusIncident({
                title: `${component.name} monitor failing`,
                summary: `${component.name} has failed ${failureCount} consecutive external monitor checks.`,
                description: `${component.name} has failed ${failureCount} consecutive external monitor checks.`,
                severity: 'SEV3',
                impact: 'minor',
                status: 'investigating',
                affectedComponentIds: [String(component._id)],
                source,
                isPublic: false,
                updateMessage: `External monitor reported ${component.name} down.`,
                updatePublic: false,
            });
            component.metadata.monitorState.activeIncidentId = String(incident._id);
            await component.save();
        }

        if (incident && incident.isPublic === false && now.getTime() - new Date(downSince).getTime() >= FIVE_MINUTES_MS) {
            await updateStatusIncident(incident._id, {
                isPublic: true,
                severity: 'SEV2',
                impact: 'major',
                status: 'investigating',
                updateMessage: `We are investigating elevated errors affecting ${component.name}. We will provide another update within 30 minutes.`,
                updatePublic: true,
                confirmMajor: true,
            });
        }
    } else {
        const recoveryCount = Number(state.recoveryCount || 0) + 1;
        const recoveredAt = state.recoveredAt ? new Date(state.recoveredAt) : now;
        component.metadata = {
            ...(component.metadata || {}),
            monitorState: {
                ...state,
                recoveryCount,
                failureCount: 0,
                recoveredAt,
                lastWebhookAt: now,
                lastWebhookSource: source,
            },
        };
        await updateStatusComponent(component._id, {
            currentStatus: 'operational',
            metadata: component.metadata,
        });
        if (incident && recoveryCount >= 2 && incident.status !== 'monitoring') {
            await addIncidentUpdate(incident._id, {
                status: 'monitoring',
                type: 'monitor_recovered',
                message: `The ${component.name} monitor has recovered. We are monitoring recovery.`,
                public: incident.isPublic,
                actor: source,
            });
        }
        if (incident && now.getTime() - new Date(recoveredAt).getTime() >= TEN_MINUTES_MS && !state.resolveSuggestedAt) {
            await addIncidentUpdate(incident._id, {
                status: incident.status,
                type: 'internal_note',
                message: `${component.name} has been stable for 10 minutes. Suggested next action: resolve after commander review.`,
                public: false,
                actor: source,
            });
            component.metadata.monitorState.resolveSuggestedAt = now;
            await component.save();
        }
    }

    event.state = 'processed';
    event.componentId = component._id;
    event.incidentId = incident?._id || null;
    await event.save();
    await writeStatusAuditLog({
        action: 'webhook.received',
        targetType: 'StatusComponent',
        targetId: component._id,
        metadata: { source, monitorStatus },
    });
    return {
        processed: true,
        componentFound: true,
        componentId: String(component._id),
        incidentId: incident?._id ? String(incident._id) : null,
        monitorStatus,
    };
};

const handleGithubActionsWebhook = async ({ payload = {}, event }) => {
    const workflow = String(payload.workflow || payload.workflow_run?.name || '').trim();
    const conclusion = String(payload.conclusion || payload.workflow_run?.conclusion || '').trim();
    const sha = String(payload.sha || payload.workflow_run?.head_sha || '').trim();
    const url = String(payload.url || payload.workflow_run?.html_url || '').trim();
    const deployish = /deploy/i.test(workflow);
    let incident = await StatusIncident.findOne({ source: 'github_actions', status: { $ne: 'resolved' } }).sort({ startedAt: -1 });

    if (conclusion && conclusion !== 'success') {
        if (!incident) {
            incident = await createStatusIncident({
                title: deployish ? 'Deployment failed' : 'CI failed on main',
                summary: `${workflow || 'GitHub Actions'} completed with ${conclusion}.`,
                description: `${workflow || 'GitHub Actions'} completed with ${conclusion}.`,
                severity: deployish ? 'SEV3' : 'SEV4',
                impact: 'none',
                status: 'investigating',
                source: 'github_actions',
                isPublic: false,
                updateMessage: `${workflow || 'GitHub Actions'} failed for ${sha || 'unknown commit'}.`,
                updateType: 'deployment',
                updatePublic: false,
                deployment: { workflow, conclusion, sha, url },
            });
        } else {
            await addIncidentUpdate(incident._id, {
                status: incident.status,
                type: 'deployment',
                message: `${workflow || 'GitHub Actions'} failed for ${sha || 'unknown commit'}.`,
                public: false,
                actor: 'github_actions',
                deployment: { workflow, conclusion, sha, url },
            });
        }
    } else if (incident) {
        await addIncidentUpdate(incident._id, {
            status: incident.status,
            type: 'deployment',
            message: `${workflow || 'GitHub Actions'} succeeded for ${sha || 'unknown commit'}.`,
            public: false,
            actor: 'github_actions',
            deployment: { workflow, conclusion, sha, url },
        });
    }

    event.state = 'processed';
    event.incidentId = incident?._id || null;
    await event.save();
    return { processed: true, incidentId: incident?._id ? String(incident._id) : null };
};

const handleStatusWebhook = async ({ source, payload = {}, rawBody = '', req }) => {
    const eventId = resolveEventId({ source, payload, req });
    const { duplicate, event } = await recordWebhookEvent({
        source,
        eventId,
        rawBody,
        req,
        payloadSummary: {
            monitor: payload.monitor?.name || payload.monitorName || payload.name || '',
            status: payload.status || payload.state || payload.heartbeat?.status || '',
            workflow: payload.workflow || payload.workflow_run?.name || '',
        },
    });
    if (duplicate) return { duplicate: true, eventId };

    try {
        if (source === 'github_actions') {
            return await handleGithubActionsWebhook({ payload, event });
        }
        return await handleMonitorWebhook({ source, payload, event });
    } catch (error) {
        event.state = 'failed';
        event.error = error.message;
        await event.save();
        logger.warn('status.webhook_processing_failed', { source, eventId, error: error.message });
        throw error;
    }
};

module.exports = {
    assertWebhookSignature,
    handleStatusWebhook,
};
