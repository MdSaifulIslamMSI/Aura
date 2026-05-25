const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const firebaseAdmin = require('firebase-admin');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
const xss = require('xss');

const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { EMAIL_REGEX, flags: emailFlags } = require('../config/emailFlags');
const { flags: paymentFlags } = require('../config/paymentFlags');
const { getRedisHealth } = require('../config/redis');
const { sendTransactionalEmail } = require('./email');
const { getCachedHealthSnapshot } = require('./healthService');
const { getReviewUploadStorageHealth } = require('./reviewMediaStorageService');
const StatusComponentGroup = require('../models/StatusComponentGroup');
const StatusComponent = require('../models/StatusComponent');
const StatusCheck = require('../models/StatusCheck');
const StatusDailyMetric = require('../models/StatusDailyMetric');
const StatusIncident = require('../models/StatusIncident');
const StatusIncidentUpdate = require('../models/StatusIncidentUpdate');
const StatusNotificationOutbox = require('../models/StatusNotificationOutbox');
const StatusSubscriber = require('../models/StatusSubscriber');
const MaintenanceWindow = require('../models/MaintenanceWindow');
const StatusAuditLog = require('../models/StatusAuditLog');
const {
    getStudentPackSecurityHarnessSnapshot,
    isStudentPackSecurityHarnessEnabled,
    shouldExposeStudentPackSecurityHarness,
} = require('./studentPackSecurityHarnessService');
const {
    incrementStatusMonitorFailure,
    incrementStatusSubscriberNotification,
    setStatusComponentMetric,
    setStatusIncidentsActive,
    setStatusPublicPageRenderMs,
} = require('../middleware/metrics');

const COMPONENT_STATUS_LABELS = {
    operational: 'Operational',
    degraded: 'Degraded performance',
    degraded_performance: 'Degraded performance',
    partial_outage: 'Partial outage',
    major_outage: 'Major outage',
    maintenance: 'Maintenance',
};

const OVERALL_STATUS_MESSAGES = {
    operational: 'All systems operational',
    degraded: 'Degraded performance',
    degraded_performance: 'Degraded performance',
    partial_outage: 'Partial outage',
    major_outage: 'Major outage',
    maintenance: 'Scheduled maintenance',
};

const STATUS_RANK = {
    operational: 0,
    maintenance: 1,
    degraded: 2,
    degraded_performance: 2,
    partial_outage: 3,
    major_outage: 4,
};

const STATUS_UPDATE_TEMPLATES = {
    investigating: 'We are investigating elevated errors affecting {components}. We will provide another update within {minutes} minutes.',
    identified: 'We have identified the cause and are applying a mitigation.',
    monitoring: 'We have applied the mitigation and are monitoring recovery.',
    resolved: 'This incident has been resolved. A post-incident review will be completed.',
};

const SEVERITY_POLICY = {
    SEV1: {
        meaning: 'Full outage / payments/auth dead',
        publicStatus: 'Major Outage',
        requiredAction: 'Immediate public incident',
        updateEveryMinutes: 15,
        postmortemRequired: true,
    },
    SEV2: {
        meaning: 'Core feature broken',
        publicStatus: 'Partial Outage',
        requiredAction: 'Public incident',
        updateEveryMinutes: 30,
        postmortemRequired: true,
    },
    SEV3: {
        meaning: 'Degraded performance / one provider failing',
        publicStatus: 'Degraded',
        requiredAction: 'Public or internal',
        updateEveryMinutes: 60,
        postmortemRequired: false,
    },
    SEV4: {
        meaning: 'Minor bug / no customer impact',
        publicStatus: 'Operational or degraded',
        requiredAction: 'Internal only',
        updateEveryMinutes: null,
        postmortemRequired: false,
    },
};

const DAY_STATUS_RANK = {
    unknown: 0,
    operational: 1,
    maintenance: 2,
    degraded: 3,
    partial_outage: 4,
    major_outage: 5,
};

const ACTIVE_INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring'];
const PUBLIC_STATUS_CACHE_MS = Math.max(Number(process.env.STATUS_PUBLIC_CACHE_SECONDS || 30), 5) * 1000;
const HISTORY_DAYS = 90;
const DEFAULT_MONITOR_INTERVAL_SECONDS = Math.max(Number(process.env.STATUS_MONITOR_INTERVAL_SECONDS || 60), 15);
const DEFAULT_SNAPSHOT_INTERVAL_SECONDS = Math.max(Number(process.env.STATUS_SNAPSHOT_INTERVAL_SECONDS || 60), 30);
const DEFAULT_NOTIFICATION_WORKER_INTERVAL_SECONDS = Math.max(Number(process.env.STATUS_NOTIFICATION_WORKER_INTERVAL_SECONDS || 30), 10);
const PUBLIC_STATUS_PAGE_ENABLED = String(process.env.PUBLIC_STATUS_PAGE_ENABLED || 'true').trim().toLowerCase() !== 'false';
const xssTextFilter = new xss.FilterXSS({ whiteList: {}, stripIgnoreTag: true, stripIgnoreTagBody: ['script', 'style'] });

let publicStatusCache = { expiresAt: 0, value: null, inFlight: null };
let monitorTimer = null;
let snapshotTimer = null;
let notificationTimer = null;
let monitorRunning = false;
let snapshotRunning = false;
let notificationWorkerRunning = false;

const toBool = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const nowIso = () => new Date().toISOString();

const sanitizeText = (value = '', max = 5000) => xssTextFilter
    .process(String(value || '').replace(/\s+/g, ' ').trim())
    .slice(0, max);

const repoRoot = path.resolve(__dirname, '..', '..');
const statusSnapshotDir = path.resolve(
    process.env.STATUS_SNAPSHOT_DIR || path.join(repoRoot, 'app', 'public')
);
const statusSnapshotJsonPath = path.join(statusSnapshotDir, 'status-snapshot.json');
const statusSnapshotHtmlPath = path.join(statusSnapshotDir, 'status-snapshot.html');

const normalizeComponentStatus = (status = 'operational') => {
    const normalized = String(status || 'operational').trim().toLowerCase();
    if (normalized === 'degraded') return 'degraded_performance';
    return normalized || 'operational';
};

const normalizeSlug = (value = '') => {
    const slug = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 160);
    return slug || `status-${Date.now().toString(36)}`;
};

const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();

const toObjectId = (value, fieldName = 'id') => {
    if (!mongoose.isValidObjectId(value)) {
        throw new AppError(`${fieldName} must be a valid identifier`, 400);
    }
    return new mongoose.Types.ObjectId(value);
};

const getDateKey = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
};

const addDaysUtc = (date, days) => {
    const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    next.setUTCDate(next.getUTCDate() + days);
    return next;
};

const buildDateRange = (days = HISTORY_DAYS, endDate = new Date()) => {
    const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
    return Array.from({ length: days }, (_, index) => getDateKey(addDaysUtc(end, index - days + 1)));
};

const invalidatePublicStatusCache = () => {
    publicStatusCache = { expiresAt: 0, value: null, inFlight: null };
};

const calculateUptimePercent = ({ successfulChecks = 0, totalChecks = 0 } = {}) => {
    const total = Number(totalChecks || 0);
    if (total <= 0) return 0;
    return Number(((Number(successfulChecks || 0) / total) * 100).toFixed(3));
};

const calculateDayStatus = ({
    uptimePercent = 0,
    totalChecks = 0,
    maintenanceChecks = 0,
} = {}) => {
    if (Number(maintenanceChecks || 0) > 0) return 'maintenance';
    if (Number(totalChecks || 0) <= 0) return 'unknown';
    const uptime = Number(uptimePercent || 0);
    if (uptime >= 99.9) return 'operational';
    if (uptime >= 99.0) return 'degraded';
    if (uptime >= 95.0) return 'partial_outage';
    return 'major_outage';
};

const calculateOverallStatus = ({ components = [], activeIncidents = [], activeMaintenance = [] } = {}) => {
    const publicActiveIncidents = activeIncidents.filter((incident) => incident?.isPublic !== false);
    if (publicActiveIncidents.some((incident) => ['critical', 'major'].includes(String(incident?.impact || '')))) {
        return 'major_outage';
    }
    if (components.some((component) => component.currentStatus === 'major_outage')) return 'major_outage';
    if (components.some((component) => component.currentStatus === 'partial_outage')) return 'partial_outage';
    if (components.some((component) => ['degraded', 'degraded_performance'].includes(component.currentStatus))) return 'degraded_performance';
    if (activeMaintenance.length > 0 || components.some((component) => component.currentStatus === 'maintenance')) return 'maintenance';
    return 'operational';
};

const chooseWorstComponentStatus = (statuses = []) => {
    const filtered = statuses.filter(Boolean);
    if (filtered.length === 0) return 'operational';
    return filtered.sort((a, b) => (STATUS_RANK[b] || 0) - (STATUS_RANK[a] || 0))[0];
};

const chooseWorstDayStatus = (statuses = []) => {
    const filtered = statuses.filter(Boolean);
    if (filtered.length === 0) return 'unknown';
    return filtered.sort((a, b) => (DAY_STATUS_RANK[b] || 0) - (DAY_STATUS_RANK[a] || 0))[0];
};

const clampScore = (value = 0) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

const scoreRatio = (value = 0, target = 1) => {
    const numericValue = Number(value || 0);
    const numericTarget = Math.max(Number(target || 1), 1);
    return Math.min(numericValue / numericTarget, 1);
};

const resolvePowerLevel = (score = 0) => {
    if (score >= 90) return 'powerhouse';
    if (score >= 75) return 'strong';
    if (score >= 60) return 'building';
    return 'thin';
};

const measureStatusPagePower = ({
    groups = [],
    components = [],
    publicGroups = [],
    securityHarness = null,
} = {}) => {
    const publicComponents = publicGroups.flatMap((group) => Array.isArray(group.components) ? group.components : []);
    const componentCount = components.length || publicComponents.length;
    const groupCount = groups.length || publicGroups.length;
    const healthSignals = new Set(components
        .map((component) => String(component?.metadata?.healthSignal || '').trim().toLowerCase())
        .filter(Boolean));
    const checkTypes = new Set(components
        .map((component) => String(component?.checkType || '').trim().toLowerCase())
        .filter(Boolean));
    const componentsWithFullHistory = publicComponents
        .filter((component) => Array.isArray(component.history90d) && component.history90d.length >= HISTORY_DAYS)
        .length;
    const maxMeasuredDays = publicGroups.reduce((max, group) => Math.max(max, Number(group.measuredDays90d || 0)), 0);
    const surfaceScore = clampScore((scoreRatio(groupCount, 10) * 45) + (scoreRatio(componentCount, 14) * 55));
    const signalScore = clampScore((scoreRatio(healthSignals.size, 10) * 65) + (scoreRatio(checkTypes.size, 4) * 35));
    const historyScore = clampScore((scoreRatio(maxMeasuredDays, HISTORY_DAYS) * 55) + (scoreRatio(componentsWithFullHistory, componentCount || 1) * 45));
    const operationsScore = 100;
    const securityScore = securityHarness?.enabled
        ? clampScore(securityHarness.readinessPercent)
        : clampScore(scoreRatio(healthSignals.size, 10) * 100);
    const score = clampScore(
        (surfaceScore * 0.25)
        + (signalScore * 0.25)
        + (historyScore * 0.25)
        + (operationsScore * 0.15)
        + (securityScore * 0.10)
    );

    return {
        score,
        level: resolvePowerLevel(score),
        summary: `${score}/100 status power across ${groupCount} groups and ${componentCount} components`,
        coverage: {
            groups: groupCount,
            components: componentCount,
            healthSignals: healthSignals.size,
            checkTypes: [...checkTypes].sort(),
            measuredDays90d: maxMeasuredDays,
            componentsWithFullHistory,
        },
        dimensions: [
            {
                id: 'surface_coverage',
                label: 'Surface coverage',
                score: surfaceScore,
                detail: `${groupCount} groups / ${componentCount} components`,
            },
            {
                id: 'health_signal_depth',
                label: 'Health signal depth',
                score: signalScore,
                detail: `${healthSignals.size} internal signals / ${checkTypes.size} check types`,
            },
            {
                id: 'history_depth',
                label: '90-day history depth',
                score: historyScore,
                detail: `${maxMeasuredDays}/${HISTORY_DAYS} measured days`,
            },
            {
                id: 'incident_operations',
                label: 'Incident operations',
                score: operationsScore,
                detail: 'Public incidents, maintenance, timelines, RSS, and subscriber alerts',
            },
            {
                id: 'security_posture',
                label: 'Security posture',
                score: securityScore,
                detail: securityHarness?.enabled ? 'Security harness readiness' : 'Auth, admin, upload, payment, and status signals',
            },
        ],
    };
};

const componentStatusToDayStatus = (status) => {
    switch (status) {
        case 'degraded':
        case 'degraded_performance':
            return 'degraded';
        case 'partial_outage':
            return 'partial_outage';
        case 'major_outage':
            return 'major_outage';
        case 'maintenance':
            return 'maintenance';
        case 'operational':
            return 'operational';
        default:
            return 'unknown';
    }
};

const formatDurationMinutes = (startAt, endAt = new Date()) => {
    const start = new Date(startAt).getTime();
    const end = new Date(endAt || new Date()).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.round((end - start) / 60000);
};

const generateIncidentSlug = async (title) => {
    const base = normalizeSlug(title).slice(0, 120);
    let candidate = base;
    let index = 2;
    while (await StatusIncident.exists({ slug: candidate })) {
        candidate = `${base}-${index}`;
        index += 1;
    }
    return candidate;
};

const resolveStatusUnsubscribeSecret = () => {
    const configuredSecret = String(process.env.STATUS_UNSUBSCRIBE_SECRET || '').trim();
    if (configuredSecret) return configuredSecret;
    if (process.env.NODE_ENV === 'test') return 'test-status-unsubscribe-secret';
    if (process.env.NODE_ENV !== 'production') {
        return String(process.env.AUTH_VAULT_SECRET || 'dev-status-unsubscribe-secret').trim();
    }
    throw new Error('STATUS_UNSUBSCRIBE_SECRET is required for production status subscriptions');
};

const buildUnsubscribeToken = (email) => {
    const normalized = normalizeEmail(email);
    const secret = resolveStatusUnsubscribeSecret();
    return crypto.createHmac('sha256', secret).update(`status:${normalized}`).digest('base64url');
};

const hashToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

const buildPublicStatusUrl = (path = '/status') => {
    const appPublicUrl = String(emailFlags.appPublicUrl || process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/+$/, '');
    return `${appPublicUrl}${path}`;
};

const resolveDefaultWebAppStatusUrl = () => String(
    process.env.STATUS_WEB_APP_URL
    || process.env.APP_PUBLIC_URL
    || 'https://aurapilot.vercel.app'
).trim();

const shouldSendStatusEmails = () => process.env.NODE_ENV !== 'test';

const enqueueStatusEmail = async ({
    eventType = 'status.update',
    idempotencyKey,
    recipientEmail,
    subject,
    text,
    html = '',
    subscriberId = null,
    incidentId = null,
    incidentUpdateId = null,
    maintenanceWindowId = null,
    meta = {},
} = {}) => {
    const safeRecipient = normalizeEmail(recipientEmail);
    if (!EMAIL_REGEX.test(safeRecipient)) return null;
    const key = sanitizeText(idempotencyKey || `${eventType}:${safeRecipient}:${crypto.createHash('sha256').update(text || subject || '').digest('hex')}`, 220);
    const doc = await StatusNotificationOutbox.findOneAndUpdate(
        { idempotencyKey: key },
        {
            $setOnInsert: {
                eventType: sanitizeText(eventType, 120),
                idempotencyKey: key,
                recipientEmail: safeRecipient,
                subject: sanitizeText(subject, 240),
                text: String(text || '').slice(0, 10000),
                html: String(html || '').slice(0, 20000),
                subscriberId,
                incidentId,
                incidentUpdateId,
                maintenanceWindowId,
                meta,
                status: 'queued',
                nextAttemptAt: new Date(),
            },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    incrementStatusSubscriberNotification({ eventType, status: doc.status || 'queued' });
    return doc;
};

const processStatusNotificationOutbox = async ({ limit = 25 } = {}) => {
    if (notificationWorkerRunning) return { skipped: true };
    notificationWorkerRunning = true;
    try {
        if (!shouldSendStatusEmails()) return { skipped: true, reason: 'email_disabled_in_test' };
        const now = new Date();
        const rows = await StatusNotificationOutbox.find({
            status: { $in: ['queued', 'failed'] },
            nextAttemptAt: { $lte: now },
            attempts: { $lt: 8 },
        }).sort({ nextAttemptAt: 1, createdAt: 1 }).limit(Math.min(Math.max(Number(limit || 25), 1), 100));
        let sent = 0;
        let failed = 0;
        for (const row of rows) {
            row.status = 'sending';
            row.attempts = Number(row.attempts || 0) + 1;
            await row.save();
            try {
                await sendTransactionalEmail({
                    eventType: 'system',
                    to: row.recipientEmail,
                    subject: row.subject,
                    text: row.text,
                    html: row.html || '',
                    requestId: row.idempotencyKey,
                    securityTags: ['status', row.eventType],
                    meta: row.meta || {},
                });
                row.status = 'sent';
                row.sentAt = new Date();
                row.lastError = '';
                sent += 1;
                incrementStatusSubscriberNotification({ eventType: row.eventType, status: 'sent' });
            } catch (error) {
                const delayMs = Math.min(60 * 60 * 1000, Math.pow(2, Math.min(row.attempts, 8)) * 60 * 1000);
                row.status = 'failed';
                row.lastError = sanitizeText(error.message || 'send_failed', 1000);
                row.nextAttemptAt = new Date(Date.now() + delayMs);
                failed += 1;
                incrementStatusSubscriberNotification({ eventType: row.eventType, status: 'failed' });
                logger.warn('status.notification_send_failed', { outboxId: String(row._id), error: row.lastError });
            }
            await row.save();
        }
        return { skipped: false, sent, failed, checked: rows.length };
    } finally {
        notificationWorkerRunning = false;
    }
};

const startStatusNotificationWorker = () => {
    if (notificationTimer) return false;
    const intervalMs = DEFAULT_NOTIFICATION_WORKER_INTERVAL_SECONDS * 1000;
    notificationTimer = setInterval(() => {
        processStatusNotificationOutbox().catch((error) => {
            logger.error('status.notification_worker_failed', { error: error.message });
        });
    }, intervalMs);
    if (typeof notificationTimer.unref === 'function') notificationTimer.unref();
    return true;
};

const stopStatusNotificationWorkerForTests = () => {
    if (!notificationTimer) return;
    clearInterval(notificationTimer);
    notificationTimer = null;
};

const DEFAULT_STATUS_CATALOG = [
    {
        name: 'Web App',
        slug: 'web-app',
        description: 'Customer storefront, browsing, cart, and checkout UI.',
        components: [
            {
                name: 'Website',
                slug: 'website',
                checkType: 'http',
                checkUrl: resolveDefaultWebAppStatusUrl(),
                metadata: { healthSignal: 'web_app' },
            },
            {
                name: 'Storefront',
                slug: 'web-storefront',
                checkType: 'http',
                checkUrl: resolveDefaultWebAppStatusUrl(),
                metadata: { healthSignal: 'web_app' },
            },
            {
                name: 'Product Experience',
                slug: 'product-experience',
                checkType: 'internal_health',
                metadata: { healthSignal: 'catalog' },
            },
        ],
    },
    {
        name: 'API',
        slug: 'api',
        description: 'Public and authenticated marketplace APIs.',
        components: [
            { name: 'API', slug: 'api', checkType: 'internal_health', metadata: { healthSignal: 'api' }, dependencies: ['database', 'redis'] },
            { name: 'Public API', slug: 'public-api', checkType: 'internal_health', metadata: { healthSignal: 'api' } },
            { name: 'Commerce API', slug: 'commerce-api', checkType: 'internal_health', metadata: { healthSignal: 'commerce_api' } },
            { name: 'Webhooks', slug: 'webhooks', checkType: 'internal_health', metadata: { healthSignal: 'payments' }, dependencies: ['api', 'database'] },
        ],
    },
    {
        name: 'Auth',
        slug: 'auth',
        description: 'Login, sessions, trusted-device checks, and admin access.',
        components: [
            { name: 'Firebase Auth', slug: 'firebase-auth', checkType: 'internal_health', metadata: { healthSignal: 'auth' }, dependencies: ['api', 'database'] },
            { name: 'Authentication', slug: 'authentication', checkType: 'internal_health', metadata: { healthSignal: 'auth' } },
        ],
    },
    {
        name: 'Database',
        slug: 'database',
        description: 'MongoDB persistence layer.',
        components: [
            { name: 'Database', slug: 'database', checkType: 'database' },
            { name: 'MongoDB', slug: 'mongodb', checkType: 'database' },
        ],
    },
    {
        name: 'Cache / Redis',
        slug: 'cache-redis',
        description: 'Redis-backed queues, rate limits, sockets, and auth cache.',
        components: [{ name: 'Redis', slug: 'redis', checkType: 'redis' }],
    },
    {
        name: 'Payments',
        slug: 'payments',
        description: 'Checkout payment providers and payment outbox processing.',
        components: [
            { name: 'Payment Processing', slug: 'payment-processing', checkType: 'internal_health', metadata: { healthSignal: 'payments' } },
            { name: 'Stripe', slug: 'stripe', checkType: 'internal_health', metadata: { healthSignal: 'payments' }, dependencies: ['api', 'webhooks'] },
            { name: 'Razorpay', slug: 'razorpay', checkType: 'internal_health', metadata: { healthSignal: 'payments' }, dependencies: ['api', 'webhooks'] },
        ],
    },
    {
        name: 'Email',
        slug: 'email',
        description: 'Transactional email and notification delivery.',
        components: [
            { name: 'Email Delivery', slug: 'email-delivery', checkType: 'internal_health', metadata: { healthSignal: 'email' } },
            { name: 'Resend Email', slug: 'resend-email', checkType: 'internal_health', metadata: { healthSignal: 'email' }, dependencies: ['api'] },
            { name: 'Status Subscriptions', slug: 'status-subscriptions', checkType: 'internal_health', metadata: { healthSignal: 'status_subscriptions' } },
        ],
    },
    {
        name: 'AI Services',
        slug: 'ai-services',
        description: 'Assistant, recommendations, and product intelligence.',
        components: [
            { name: 'AI Provider', slug: 'ai-provider', checkType: 'internal_health', metadata: { healthSignal: 'ai' }, dependencies: ['api'] },
            { name: 'Commerce Assistant', slug: 'commerce-assistant', checkType: 'internal_health', metadata: { healthSignal: 'ai' } },
        ],
    },
    {
        name: 'File Uploads',
        slug: 'file-uploads',
        description: 'Review media and upload pipeline.',
        components: [
            { name: 'File Uploads', slug: 'file-uploads', checkType: 'internal_health', metadata: { healthSignal: 'uploads' }, dependencies: ['api', 'database'] },
            { name: 'Media Uploads', slug: 'media-uploads', checkType: 'internal_health', metadata: { healthSignal: 'uploads' } },
        ],
    },
    {
        name: 'Realtime',
        slug: 'realtime',
        description: 'Chat, live updates, and video session signaling.',
        components: [
            { name: 'LiveKit', slug: 'livekit', checkType: 'internal_health', metadata: { healthSignal: 'realtime' }, dependencies: ['api'] },
            { name: 'Realtime Messaging', slug: 'realtime-messaging', checkType: 'internal_health', metadata: { healthSignal: 'realtime' } },
        ],
    },
    {
        name: 'Admin Panel',
        slug: 'admin-panel',
        description: 'Admin dashboard and operational controls.',
        components: [{ name: 'Admin Console', slug: 'admin-console', checkType: 'internal_health', metadata: { healthSignal: 'admin' } }],
    },
    {
        name: 'Search',
        slug: 'search',
        description: 'Keyword search, embeddings, and vector retrieval.',
        components: [{ name: 'Search / Vector Search', slug: 'search-vector-search', checkType: 'internal_health', metadata: { healthSignal: 'catalog' }, dependencies: ['database', 'ai-provider'] }],
    },
    {
        name: 'Update Service',
        slug: 'update-service',
        description: 'Mobile and desktop update delivery.',
        components: [{ name: 'Mobile/Desktop Update Service', slug: 'mobile-desktop-update-service', checkType: 'internal_health', metadata: { healthSignal: 'api' }, dependencies: ['website', 'api'] }],
    },
];

const STUDENT_PACK_SECURITY_STATUS_CATALOG = [
    {
        name: 'Security Harness',
        slug: 'security-harness',
        description: 'Student Pack powered security, observability, email, browser, and AWS sandbox controls.',
        components: [
            {
                name: 'Sentry Runtime Guard',
                slug: 'security-sentry-runtime-guard',
                checkType: 'internal_health',
                metadata: { healthSignal: 'student_pack_sentry' },
            },
            {
                name: 'Datadog CI Visibility',
                slug: 'security-datadog-ci-visibility',
                checkType: 'internal_health',
                metadata: { healthSignal: 'student_pack_datadog' },
            },
            {
                name: 'Doppler Secret Injection',
                slug: 'security-doppler-secret-injection',
                checkType: 'internal_health',
                metadata: { healthSignal: 'student_pack_doppler' },
            },
            {
                name: 'Testmail Email Harness',
                slug: 'security-testmail-email-harness',
                checkType: 'internal_health',
                metadata: { healthSignal: 'student_pack_testmail' },
            },
            {
                name: 'LambdaTest Browser Matrix',
                slug: 'security-lambdatest-browser-matrix',
                checkType: 'internal_health',
                metadata: { healthSignal: 'student_pack_lambdatest' },
            },
            {
                name: 'LocalStack AWS Sandbox',
                slug: 'security-localstack-aws-sandbox',
                checkType: 'internal_health',
                metadata: { healthSignal: 'student_pack_localstack' },
            },
        ],
    },
];

const getDefaultStatusCatalog = () => (
    isStudentPackSecurityHarnessEnabled()
        ? [...DEFAULT_STATUS_CATALOG, ...STUDENT_PACK_SECURITY_STATUS_CATALOG]
        : DEFAULT_STATUS_CATALOG
);

const shouldSeedDemoMetrics = () => (
    process.env.NODE_ENV !== 'production'
    && String(process.env.STATUS_SEED_DEMO_METRICS || 'true').trim().toLowerCase() !== 'false'
);

const seedDemoMetricsForComponent = async (component, seedIndex = 0) => {
    const existing = await StatusDailyMetric.exists({ componentId: component._id });
    if (existing) return;
    const dates = buildDateRange(HISTORY_DAYS);
    const docs = dates.map((date, index) => {
        const wobble = (index + seedIndex * 7) % 29;
        const incidentish = wobble === 0 || wobble === 13;
        const partial = (index + seedIndex) % 53 === 0;
        const major = (index + seedIndex * 5) % 89 === 0;
        const maintenance = (index + seedIndex * 3) % 67 === 0;
        const uptimePercent = major
            ? 94.2
            : partial
                ? 98.7
                : incidentish
                    ? 99.72
                    : maintenance
                        ? 100
                        : 99.98;
        return {
            componentId: component._id,
            date,
            uptimePercent,
            status: maintenance ? 'maintenance' : calculateDayStatus({ uptimePercent, totalChecks: 1440 }),
            totalChecks: 1440,
            successfulChecks: Math.round((uptimePercent / 100) * 1440),
            failedChecks: Math.max(0, 1440 - Math.round((uptimePercent / 100) * 1440)),
            degradedChecks: incidentish ? 2 : 0,
            avgResponseTimeMs: 120 + ((index + seedIndex) % 12) * 9,
            downtimeMinutes: Math.max(0, Math.round(1440 - ((uptimePercent / 100) * 1440))),
        };
    });
    await StatusDailyMetric.insertMany(docs, { ordered: false }).catch(() => {});
};

const seedDefaultStatusCatalog = async ({ includeDemoMetrics = shouldSeedDemoMetrics() } = {}) => {
    const groups = [];
    let componentIndex = 0;
    const allowDemoMetrics = Boolean(includeDemoMetrics) && process.env.NODE_ENV !== 'production';

    for (const [groupIndex, groupConfig] of getDefaultStatusCatalog().entries()) {
        const group = await StatusComponentGroup.findOneAndUpdate(
            { slug: groupConfig.slug },
            {
                $set: {
                    name: groupConfig.name,
                    description: groupConfig.description,
                    order: groupIndex,
                    isPublic: true,
                },
                $setOnInsert: {
                    slug: groupConfig.slug,
                },
            },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );
        groups.push(group);

        for (const [componentOrder, componentConfig] of groupConfig.components.entries()) {
            const component = await StatusComponent.findOneAndUpdate(
                { slug: componentConfig.slug },
                {
                    $set: {
                        groupId: group._id,
                        name: componentConfig.name,
                        description: componentConfig.description || '',
                        checkType: componentConfig.checkType || 'manual',
                        checkUrl: componentConfig.checkUrl || '',
                        checkMethod: componentConfig.checkMethod || 'GET',
                        expectedStatusCode: Number(componentConfig.expectedStatusCode || 200),
                        timeoutMs: Number(componentConfig.timeoutMs || 5000),
                        dependencies: componentConfig.dependencies || [],
                        isPublic: true,
                        isMonitored: true,
                        order: componentOrder,
                        metadata: componentConfig.metadata || {},
                    },
                    $setOnInsert: {
                        slug: componentConfig.slug,
                        currentStatus: 'operational',
                        lastStatusChangeAt: new Date(),
                    },
                },
                { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
            );
            if (allowDemoMetrics) {
                await seedDemoMetricsForComponent(component, componentIndex);
            }
            componentIndex += 1;
        }
    }

    invalidatePublicStatusCache();
    return { groups: groups.length, components: componentIndex };
};

const fetchMetricMap = async (componentIds, dates) => {
    const metrics = await StatusDailyMetric.find({
        componentId: { $in: componentIds },
        date: { $in: dates },
    }).lean();
    const map = new Map();
    metrics.forEach((metric) => {
        map.set(`${String(metric.componentId)}:${metric.date}`, metric);
    });
    return map;
};

const fetchCheckAggregateMap = async (componentIds, dates) => {
    if (!componentIds.length || !dates.length) return new Map();
    const start = new Date(`${dates[0]}T00:00:00.000Z`);
    const end = addDaysUtc(new Date(`${dates[dates.length - 1]}T00:00:00.000Z`), 1);
    const rows = await StatusCheck.aggregate([
        {
            $match: {
                componentId: { $in: componentIds },
                checkedAt: { $gte: start, $lt: end },
            },
        },
        {
            $group: {
                _id: {
                    componentId: '$componentId',
                    date: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$checkedAt',
                            timezone: 'UTC',
                        },
                    },
                },
                totalChecks: { $sum: 1 },
                successfulChecks: {
                    $sum: { $cond: [{ $eq: ['$status', 'operational'] }, 1, 0] },
                },
                failedChecks: {
                    $sum: { $cond: [{ $in: ['$status', ['partial_outage', 'major_outage']] }, 1, 0] },
                },
                degradedChecks: {
                    $sum: { $cond: [{ $eq: ['$status', 'degraded_performance'] }, 1, 0] },
                },
                maintenanceChecks: {
                    $sum: { $cond: [{ $eq: ['$status', 'maintenance'] }, 1, 0] },
                },
                avgResponseTimeMs: { $avg: '$responseTimeMs' },
            },
        },
    ]);
    const map = new Map();
    rows.forEach((row) => {
        const totalChecks = Number(row.totalChecks || 0);
        const successfulChecks = Number(row.successfulChecks || 0);
        const failedChecks = Number(row.failedChecks || 0);
        const degradedChecks = Number(row.degradedChecks || 0);
        const maintenanceChecks = Number(row.maintenanceChecks || 0);
        const uptimePercent = calculateUptimePercent({ successfulChecks, totalChecks });
        map.set(`${String(row._id.componentId)}:${row._id.date}`, {
            date: row._id.date,
            uptimePercent,
            status: calculateDayStatus({ uptimePercent, totalChecks, maintenanceChecks }),
            totalChecks,
            successfulChecks,
            failedChecks,
            degradedChecks,
            avgResponseTimeMs: Number.isFinite(Number(row.avgResponseTimeMs)) ? Math.round(Number(row.avgResponseTimeMs)) : null,
            downtimeMinutes: totalChecks > 0
                ? Math.round(((failedChecks + degradedChecks) / totalChecks) * 1440)
                : 0,
        });
    });
    return map;
};

const normalizeHistoryMetric = (metric, date) => {
    const totalChecks = Number(metric?.totalChecks || 0);
    const status = totalChecks > 0 ? metric?.status || 'unknown' : 'unknown';
    const hasMeasuredUptime = status !== 'unknown'
        && metric?.uptimePercent !== null
        && metric?.uptimePercent !== undefined
        && Number.isFinite(Number(metric.uptimePercent));
    return {
        date,
        status,
        uptimePercent: hasMeasuredUptime ? Number(metric.uptimePercent) : null,
        downtimeMinutes: hasMeasuredUptime ? Number(metric.downtimeMinutes || 0) : null,
        avgResponseTimeMs: Number.isFinite(Number(metric?.avgResponseTimeMs)) ? Math.round(Number(metric.avgResponseTimeMs)) : null,
        totalChecks,
    };
};

const buildComponentHistory = ({ componentId, dates, metricMap, checkAggregateMap }) => dates.map((date) => {
    const metric = metricMap.get(`${String(componentId)}:${date}`);
    const checkAggregate = checkAggregateMap.get(`${String(componentId)}:${date}`);
    if (metric) return normalizeHistoryMetric(metric, date);
    if (checkAggregate) return normalizeHistoryMetric(checkAggregate, date);
    return { date, status: 'unknown', uptimePercent: null, downtimeMinutes: null, totalChecks: 0 };
});

const isMeasuredHistoryEntry = (entry) => entry
    && entry.status !== 'unknown'
    && entry.uptimePercent !== null
    && entry.uptimePercent !== undefined
    && Number.isFinite(Number(entry.uptimePercent));

const getMonitoringStartedAt = (history = []) => {
    const firstMeasured = history.find(isMeasuredHistoryEntry);
    return firstMeasured?.date ? new Date(`${firstMeasured.date}T00:00:00.000Z`).toISOString() : null;
};

const countMeasuredHistoryDays = (history = []) => history.filter(isMeasuredHistoryEntry).length;

const buildGroupHistory = (componentHistories, dates) => dates.map((date, index) => {
    const dayEntries = componentHistories.map((history) => history[index]).filter(Boolean);
    const knownEntries = dayEntries.filter(isMeasuredHistoryEntry);
    const uptimeValues = knownEntries
        .map((entry) => Number(entry.uptimePercent))
        .filter((value) => Number.isFinite(value));
    const downtimeMinutes = knownEntries.reduce((sum, entry) => sum + Number(entry.downtimeMinutes || 0), 0);
    return {
        date,
        status: chooseWorstDayStatus(dayEntries.map((entry) => entry.status)),
        uptimePercent: uptimeValues.length > 0
            ? Number((uptimeValues.reduce((sum, value) => sum + value, 0) / uptimeValues.length).toFixed(3))
            : null,
        downtimeMinutes,
    };
});

const calculateHistoryUptime = (history = []) => {
    const values = history
        .filter(isMeasuredHistoryEntry)
        .map((entry) => Number(entry.uptimePercent))
        .filter((value) => Number.isFinite(value));
    if (values.length === 0) return null;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
};

const calculateMonitoringSummary = (history = []) => ({
    monitoringStartedAt: getMonitoringStartedAt(history),
    measuredDays90d: countMeasuredHistoryDays(history),
    uptimeSinceMonitoringBegan: calculateHistoryUptime(history),
});

const formatIncidentSummary = (incident, updates = [], componentMap = new Map()) => ({
    id: String(incident._id),
    title: sanitizeText(incident.title, 180),
    slug: incident.slug,
    description: sanitizeText(incident.description, 2000),
    summary: sanitizeText(incident.summary || incident.description, 2000),
    severity: incident.severity || 'SEV3',
    impact: incident.impact,
    status: incident.status,
    commander: sanitizeText(incident.commander, 160),
    source: incident.source || 'manual',
    type: incident.impact === 'maintenance' ? 'maintenance' : 'incident',
    affectedComponents: (incident.affectedComponentIds || [])
        .map((id) => componentMap.get(String(id)))
        .filter(Boolean)
        .map((component) => ({
            id: String(component._id),
            name: sanitizeText(component.name, 120),
            slug: component.slug,
        })),
    latestUpdate: updates[0] ? {
        status: updates[0].status,
        type: updates[0].type || 'status_update',
        message: sanitizeText(updates[0].message, 1000),
        createdAt: updates[0].createdAt,
        actor: sanitizeText(updates[0].actor, 160),
    } : null,
    startedAt: incident.startedAt,
    detectedAt: incident.detectedAt,
    acknowledgedAt: incident.acknowledgedAt,
    resolvedAt: incident.resolvedAt,
    scheduledStartAt: incident.scheduledStartAt,
    scheduledEndAt: incident.scheduledEndAt,
    durationMinutes: incident.resolvedAt ? formatDurationMinutes(incident.startedAt, incident.resolvedAt) : formatDurationMinutes(incident.startedAt),
    url: buildPublicStatusUrl(`/status/incidents/${incident.slug}`),
});

const formatMaintenanceWindow = (window, componentMap = new Map()) => ({
    id: String(window._id),
    title: sanitizeText(window.title, 180),
    slug: window.slug,
    type: 'maintenance',
    impact: 'maintenance',
    status: window.status,
    publicMessage: sanitizeText(window.publicMessage, 2000),
    description: sanitizeText(window.publicMessage, 2000),
    affectedComponents: (window.affectedComponentIds || [])
        .map((id) => componentMap.get(String(id)))
        .filter(Boolean)
        .map((component) => ({
            id: String(component._id),
            name: sanitizeText(component.name, 120),
            slug: component.slug,
        })),
    startedAt: window.startsAt,
    scheduledStartAt: window.startsAt,
    scheduledEndAt: window.endsAt,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    notifySubscribers: Boolean(window.notifySubscribers),
    url: buildPublicStatusUrl('/status'),
});

const getPublicMaintenanceWindows = async ({ activeOnly = false, limit = 20 } = {}) => {
    const now = new Date();
    const filter = { isPublic: true };
    if (activeOnly) {
        filter.status = { $in: ['scheduled', 'in_progress'] };
        filter.endsAt = { $gte: now };
    }
    const windows = await MaintenanceWindow.find(filter)
        .sort({ startsAt: activeOnly ? 1 : -1 })
        .limit(Math.min(Math.max(Number(limit || 20), 1), 100))
        .lean();
    if (!windows.length) return [];
    const componentIds = [...new Set(windows.flatMap((window) => (window.affectedComponentIds || []).map(String)))];
    const components = componentIds.length
        ? await StatusComponent.find({ _id: { $in: componentIds }, isPublic: true }).lean()
        : [];
    const componentMap = new Map(components.map((component) => [String(component._id), component]));
    return windows.map((window) => formatMaintenanceWindow(window, componentMap));
};

const getActiveIncidentRows = async () => {
    const incidents = await StatusIncident.find({
        isPublic: true,
        status: { $in: ACTIVE_INCIDENT_STATUSES },
    }).sort({ startedAt: -1 }).lean();
    if (incidents.length === 0) return [];
    const updates = await StatusIncidentUpdate.find({
        incidentId: { $in: incidents.map((incident) => incident._id) },
        isPublic: { $ne: false },
    }).sort({ createdAt: -1 }).lean();
    const updatesByIncident = new Map();
    updates.forEach((update) => {
        const key = String(update.incidentId);
        if (!updatesByIncident.has(key)) updatesByIncident.set(key, []);
        updatesByIncident.get(key).push(update);
    });
    const componentIds = [...new Set(incidents.flatMap((incident) => (incident.affectedComponentIds || []).map(String)))];
    const components = componentIds.length
        ? await StatusComponent.find({ _id: { $in: componentIds }, isPublic: true }).lean()
        : [];
    const componentMap = new Map(components.map((component) => [String(component._id), component]));
    return incidents.map((incident) => formatIncidentSummary(
        incident,
        updatesByIncident.get(String(incident._id)) || [],
        componentMap
    ));
};

const buildPublicStatusPayload = async () => {
    const renderStarted = Date.now();
    const dates = buildDateRange(HISTORY_DAYS);
    const groups = await StatusComponentGroup.find({ isPublic: true }).sort({ order: 1, name: 1 }).lean();
    const groupIds = groups.map((group) => group._id);
    const components = await StatusComponent.find({
        isPublic: true,
        groupId: { $in: groupIds },
    }).sort({ order: 1, name: 1 }).lean();
    const componentIds = components.map((component) => component._id);
    const [metricMap, checkAggregateMap] = await Promise.all([
        fetchMetricMap(componentIds, dates),
        fetchCheckAggregateMap(componentIds, dates),
    ]);
    const componentsByGroup = new Map();

    components.forEach((component) => {
        const key = String(component.groupId);
        if (!componentsByGroup.has(key)) componentsByGroup.set(key, []);
        componentsByGroup.get(key).push(component);
    });

    const activeRows = await getActiveIncidentRows();
    const activeIncidents = activeRows.filter((incident) => incident.type !== 'maintenance');
    const activeMaintenance = [
        ...activeRows.filter((incident) => incident.type === 'maintenance'),
        ...(await getPublicMaintenanceWindows({ activeOnly: true, limit: 20 })),
    ];

    const publicGroups = groups.map((group) => {
        const groupComponents = componentsByGroup.get(String(group._id)) || [];
        const componentPayloads = groupComponents.map((component) => {
            const history90d = buildComponentHistory({ componentId: component._id, dates, metricMap, checkAggregateMap });
            const monitoringSummary = calculateMonitoringSummary(history90d);
            const componentStatus = normalizeComponentStatus(component.manualStatusOverride || component.currentStatus || 'operational');
            setStatusComponentMetric({ component: component.slug, status: componentStatus });
            return {
                id: String(component._id),
                name: sanitizeText(component.name, 120),
                slug: component.slug,
                status: componentStatus,
                statusLabel: COMPONENT_STATUS_LABELS[componentStatus] || 'Unknown',
                dependencies: (component.dependencies || []).map((dependency) => sanitizeText(dependency, 160)),
                uptimePercent90d: monitoringSummary.uptimeSinceMonitoringBegan,
                monitoringStartedAt: monitoringSummary.monitoringStartedAt,
                measuredDays90d: monitoringSummary.measuredDays90d,
                uptimeSinceMonitoringBegan: monitoringSummary.uptimeSinceMonitoringBegan,
                lastCheckedAt: component.lastCheckedAt,
                lastStatusChangeAt: component.lastStatusChangeAt,
                lastResponseTimeMs: component.lastResponseTimeMs,
                responseTimeSparkline: history90d.map((entry) => entry.avgResponseTimeMs).filter((value) => value !== null && value !== undefined),
                history90d,
            };
        });
        const histories = componentPayloads.map((component) => component.history90d);
        const history90d = buildGroupHistory(histories, dates);
        const monitoringSummary = calculateMonitoringSummary(history90d);
        return {
            id: String(group._id),
            name: sanitizeText(group.name, 120),
            slug: group.slug,
            description: sanitizeText(group.description, 500),
            status: chooseWorstComponentStatus(componentPayloads.map((component) => component.status)),
            statusLabel: COMPONENT_STATUS_LABELS[chooseWorstComponentStatus(componentPayloads.map((component) => component.status))] || 'Unknown',
            uptimePercent90d: monitoringSummary.uptimeSinceMonitoringBegan,
            monitoringStartedAt: monitoringSummary.monitoringStartedAt,
            measuredDays90d: monitoringSummary.measuredDays90d,
            uptimeSinceMonitoringBegan: monitoringSummary.uptimeSinceMonitoringBegan,
            componentsCount: componentPayloads.length,
            history90d,
            components: componentPayloads,
        };
    });

    const overallStatus = calculateOverallStatus({ components, activeIncidents, activeMaintenance });
    const measuredGroups = publicGroups.filter((group) => group.monitoringStartedAt && group.uptimeSinceMonitoringBegan !== null);
    const monitoringStartedAt = measuredGroups.length
        ? measuredGroups
            .map((group) => group.monitoringStartedAt)
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
        : null;
    const uptimeValues = measuredGroups
        .map((group) => Number(group.uptimeSinceMonitoringBegan))
        .filter((value) => Number.isFinite(value));
    const securityHarness = shouldExposeStudentPackSecurityHarness()
        ? await getStudentPackSecurityHarnessSnapshot({
            probeEndpoints: toBool(process.env.STUDENT_PACK_SECURITY_HARNESS_PROBE_ENDPOINTS, true),
        })
        : null;

    setStatusIncidentsActive(activeIncidents.length);
    const payload = {
        overallStatus,
        message: OVERALL_STATUS_MESSAGES[overallStatus] || OVERALL_STATUS_MESSAGES.operational,
        lastUpdatedAt: nowIso(),
        monitoringStartedAt,
        measuredDays90d: measuredGroups.reduce((max, group) => Math.max(max, Number(group.measuredDays90d || 0)), 0),
        uptimeSinceMonitoringBegan: uptimeValues.length
            ? Number((uptimeValues.reduce((sum, value) => sum + value, 0) / uptimeValues.length).toFixed(3))
            : null,
        groups: publicGroups,
        activeIncidents,
        activeMaintenance,
        securityHarness,
        statusPower: measureStatusPagePower({
            groups,
            components,
            publicGroups,
            securityHarness,
        }),
    };
    setStatusPublicPageRenderMs(Date.now() - renderStarted);
    return payload;
};

const getPublicStatus = async ({ force = false } = {}) => {
    if (!PUBLIC_STATUS_PAGE_ENABLED) {
        throw new AppError('Public status page is disabled', 404);
    }

    const now = Date.now();
    if (!force && publicStatusCache.value && publicStatusCache.expiresAt > now) {
        return publicStatusCache.value;
    }
    if (!force && publicStatusCache.inFlight) {
        return publicStatusCache.inFlight;
    }

    publicStatusCache.inFlight = buildPublicStatusPayload()
        .then((payload) => {
            publicStatusCache.value = payload;
            publicStatusCache.expiresAt = Date.now() + PUBLIC_STATUS_CACHE_MS;
            return payload;
        })
        .finally(() => {
            publicStatusCache.inFlight = null;
        });

    return publicStatusCache.inFlight;
};

const getPublicStatusComponents = async () => {
    const payload = await getPublicStatus();
    return {
        lastUpdatedAt: payload.lastUpdatedAt,
        overallStatus: payload.overallStatus,
        components: (payload.groups || []).flatMap((group) => (group.components || []).map((component) => ({
            ...component,
            group: {
                id: group.id,
                name: group.name,
                slug: group.slug,
            },
        }))),
        groups: payload.groups || [],
    };
};

const getActiveStatusIncidents = async () => {
    const payload = await getPublicStatus();
    return {
        lastUpdatedAt: payload.lastUpdatedAt,
        incidents: payload.activeIncidents || [],
    };
};

const getStatusMaintenance = async ({ includePast = false } = {}) => ({
    maintenance: includePast
        ? await getPublicMaintenanceWindows({ activeOnly: false, limit: 50 })
        : await getPublicMaintenanceWindows({ activeOnly: true, limit: 50 }),
    lastUpdatedAt: nowIso(),
});

const getStatusSummary = async () => {
    const payload = await getPublicStatus();
    return {
        status: payload.overallStatus,
        message: payload.message,
        lastUpdatedAt: payload.lastUpdatedAt,
        activeIncidents: (payload.activeIncidents || []).length,
        scheduledMaintenance: (payload.activeMaintenance || []).length,
        components: (payload.groups || []).reduce((sum, group) => sum + Number(group.componentsCount || 0), 0),
    };
};

const escapeHtml = (value = '') => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildStatusSnapshotHtml = (payload = {}) => {
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    const activeIncidents = Array.isArray(payload.activeIncidents) ? payload.activeIncidents : [];
    const activeMaintenance = Array.isArray(payload.activeMaintenance) ? payload.activeMaintenance : [];
    const rows = groups.flatMap((group) => (group.components || []).map((component) => (
        `<tr><td>${escapeHtml(group.name)}</td><td>${escapeHtml(component.name)}</td><td>${escapeHtml(component.statusLabel || component.status)}</td></tr>`
    ))).join('');
    const incidents = activeIncidents.map((incident) => `<li>${escapeHtml(incident.title)} - ${escapeHtml(incident.status)}</li>`).join('');
    const maintenance = activeMaintenance.map((window) => `<li>${escapeHtml(window.title)} - ${escapeHtml(window.status)}</li>`).join('');

    return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        '<title>Aura Status Snapshot</title>',
        '<style>body{font-family:Inter,system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a}main{max-width:900px;margin:0 auto;padding:32px 16px}section{background:white;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:16px 0}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-top:1px solid #e2e8f0;text-align:left}</style>',
        '</head>',
        '<body>',
        '<main>',
        `<h1>Aura Status</h1><p>${escapeHtml(payload.message || 'Status temporarily unavailable')}</p><p>Last updated ${escapeHtml(payload.lastUpdatedAt || '')}</p>`,
        `<section><h2>Active Incidents</h2><ul>${incidents || '<li>No active incidents</li>'}</ul></section>`,
        `<section><h2>Scheduled Maintenance</h2><ul>${maintenance || '<li>No scheduled maintenance</li>'}</ul></section>`,
        `<section><h2>Components</h2><table><thead><tr><th>Group</th><th>Component</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></section>`,
        '</main>',
        '</body>',
        '</html>',
    ].join('');
};

const writeStatusSnapshot = async () => {
    if (!PUBLIC_STATUS_PAGE_ENABLED || snapshotRunning) return { skipped: true };
    snapshotRunning = true;
    try {
        const payload = await getPublicStatus({ force: true });
        await fs.mkdir(statusSnapshotDir, { recursive: true });
        await Promise.all([
            fs.writeFile(statusSnapshotJsonPath, JSON.stringify(payload, null, 2), 'utf8'),
            fs.writeFile(statusSnapshotHtmlPath, buildStatusSnapshotHtml(payload), 'utf8'),
        ]);
        return {
            skipped: false,
            jsonPath: statusSnapshotJsonPath,
            htmlPath: statusSnapshotHtmlPath,
            lastUpdatedAt: payload.lastUpdatedAt,
        };
    } finally {
        snapshotRunning = false;
    }
};

const getStatusHistory = async ({ page = 1, limit = 20, type = 'all', status = '' } = {}) => {
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const filter = { isPublic: true };
    if (type === 'incidents') filter.impact = { $ne: 'maintenance' };
    if (type === 'maintenance') filter.impact = 'maintenance';
    if (status && status !== 'all') filter.status = status;
    const skip = (safePage - 1) * safeLimit;
    const [total, incidents] = await Promise.all([
        StatusIncident.countDocuments(filter),
        StatusIncident.find(filter).sort({ startedAt: -1, createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    ]);
    const updates = incidents.length
        ? await StatusIncidentUpdate.find({
            incidentId: { $in: incidents.map((incident) => incident._id) },
            isPublic: { $ne: false },
        }).sort({ createdAt: 1 }).lean()
        : [];
    const componentIds = [...new Set(incidents.flatMap((incident) => (incident.affectedComponentIds || []).map(String)))];
    const components = componentIds.length
        ? await StatusComponent.find({ _id: { $in: componentIds }, isPublic: true }).lean()
        : [];
    const componentMap = new Map(components.map((component) => [String(component._id), component]));
    const updatesByIncident = new Map();
    updates.forEach((update) => {
        const key = String(update.incidentId);
        if (!updatesByIncident.has(key)) updatesByIncident.set(key, []);
        updatesByIncident.get(key).push({
            status: update.status,
            type: update.type || 'status_update',
            message: sanitizeText(update.message, 1000),
            createdAt: update.createdAt,
            actor: sanitizeText(update.actor, 160),
            deployment: update.deployment || undefined,
        });
    });

    return {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.max(1, Math.ceil(total / safeLimit)),
        incidents: incidents.map((incident) => ({
            ...formatIncidentSummary(incident, updatesByIncident.get(String(incident._id)) || [], componentMap),
            timeline: updatesByIncident.get(String(incident._id)) || [],
        })),
    };
};

const getIncidentBySlug = async (slug) => {
    const incident = await StatusIncident.findOne({ slug: normalizeSlug(slug), isPublic: true }).lean();
    if (!incident) throw new AppError('Incident not found', 404);
    const [updates, components] = await Promise.all([
        StatusIncidentUpdate.find({ incidentId: incident._id, isPublic: { $ne: false } }).sort({ createdAt: 1 }).lean(),
        StatusComponent.find({ _id: { $in: incident.affectedComponentIds || [] }, isPublic: true }).lean(),
    ]);
    const componentMap = new Map(components.map((component) => [String(component._id), component]));
    return {
        incident: {
            ...formatIncidentSummary(incident, [...updates].reverse(), componentMap),
            timeline: updates.map((update) => ({
                status: update.status,
                type: update.type || 'status_update',
                message: sanitizeText(update.message, 2000),
                createdAt: update.createdAt,
                actor: sanitizeText(update.actor, 160),
                deployment: update.deployment || undefined,
            })),
            resolutionSummary: sanitizeText(incident.resolutionSummary, 5000),
        },
    };
};

const subscribeToStatus = async ({
    email,
    selectedComponentIds = [],
    selectedGroupIds = [],
    notificationLevel = 'all',
} = {}) => {
    const normalizedEmail = normalizeEmail(email);
    if (!EMAIL_REGEX.test(normalizedEmail)) {
        throw new AppError('A valid email is required', 400);
    }
    const unsubscribeToken = buildUnsubscribeToken(normalizedEmail);
    const unsubscribeTokenHash = hashToken(unsubscribeToken);
    const componentObjectIds = selectedComponentIds.map((id) => toObjectId(id, 'selectedComponentIds'));
    const subscriber = await StatusSubscriber.findOneAndUpdate(
        { email: normalizedEmail },
        {
            $set: {
                selectedComponentIds: componentObjectIds,
                subscribedComponents: componentObjectIds,
                selectedGroupIds: selectedGroupIds.map((id) => toObjectId(id, 'selectedGroupIds')),
                notificationLevel,
                unsubscribeTokenHash,
                tokenHash: unsubscribeTokenHash,
                unsubscribedAt: null,
            },
            $setOnInsert: {
                email: normalizedEmail,
                verifiedAt: null,
            },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    await enqueueStatusEmail({
        eventType: 'status.subscription_confirmed',
        idempotencyKey: `status-subscribe-${subscriber._id}`,
        recipientEmail: normalizedEmail,
        subject: 'Aura status subscription confirmed',
        text: [
            'You are subscribed to Aura Marketplace status updates.',
            `Notification level: ${notificationLevel}`,
            `Verify: ${buildPublicStatusUrl(`/api/status/subscribe/verify?token=${encodeURIComponent(unsubscribeToken)}`)}`,
            `Unsubscribe: ${buildPublicStatusUrl(`/status/subscribe?unsubscribe=${encodeURIComponent(unsubscribeToken)}`)}`,
        ].join('\n'),
        subscriberId: subscriber._id,
        meta: { subscriberId: String(subscriber._id), notificationLevel },
    });

    return {
        subscriberId: String(subscriber._id),
        email: subscriber.email,
        notificationLevel: subscriber.notificationLevel,
    };
};

const unsubscribeFromStatus = async ({ token } = {}) => {
    const tokenHash = hashToken(token);
    const result = await StatusSubscriber.updateOne(
        { $or: [{ unsubscribeTokenHash: tokenHash }, { tokenHash }] },
        { $set: { unsubscribedAt: new Date(), selectedComponentIds: [], subscribedComponents: [] } }
    );
    return { removed: Number(result.modifiedCount || 0) > 0 };
};

const verifyStatusSubscription = async ({ token } = {}) => {
    const tokenHash = hashToken(token);
    const subscriber = await StatusSubscriber.findOneAndUpdate(
        { $or: [{ unsubscribeTokenHash: tokenHash }, { tokenHash }], unsubscribedAt: null },
        { $set: { verifiedAt: new Date() } },
        { returnDocument: 'after' }
    ).lean();
    if (!subscriber) throw new AppError('Subscription verification token is invalid', 404);
    return {
        verified: true,
        email: subscriber.email,
    };
};

const getStatusAdminDashboard = async () => {
    const [
        publicPayload,
        totalSubscribers,
        recentChecks,
        allGroups,
        allComponents,
        allIncidents,
        allMaintenanceWindows,
    ] = await Promise.all([
        getPublicStatus({ force: true }),
        StatusSubscriber.countDocuments({}),
        StatusCheck.find({}).sort({ checkedAt: -1 }).limit(80).populate('componentId', 'name slug').lean(),
        StatusComponentGroup.find({}).sort({ order: 1, name: 1 }).lean(),
        StatusComponent.find({}).sort({ order: 1, name: 1 }).lean(),
        StatusIncident.find({}).sort({ startedAt: -1 }).limit(30).lean(),
        MaintenanceWindow.find({}).sort({ startsAt: -1 }).limit(30).lean(),
    ]);

    const degradedComponents = allComponents.filter((component) => !['operational', 'maintenance'].includes(component.currentStatus)).length;
    const uptimeValues = publicPayload.groups
        .map((group) => group.uptimePercent90d)
        .filter((value) => value !== null && value !== undefined)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
    const averageUptime = uptimeValues.length
        ? Number((uptimeValues.reduce((sum, value) => sum + value, 0) / uptimeValues.length).toFixed(3))
        : null;

    return {
        overview: {
            overallStatus: publicPayload.overallStatus,
            message: publicPayload.message,
            activeIncidents: publicPayload.activeIncidents.length,
            activeMaintenance: publicPayload.activeMaintenance.length,
            degradedComponents,
            subscribers: totalSubscribers,
            averageUptime,
            lastUpdatedAt: publicPayload.lastUpdatedAt,
        },
        groups: allGroups.map((group) => ({
            id: String(group._id),
            name: group.name,
            slug: group.slug,
            description: group.description,
            order: group.order,
            isPublic: group.isPublic,
        })),
        components: allComponents.map((component) => ({
            id: String(component._id),
            groupId: String(component.groupId),
            name: component.name,
            slug: component.slug,
            description: component.description,
            checkType: component.checkType,
            checkUrlConfigured: Boolean(component.checkUrl),
            checkMethod: component.checkMethod,
            expectedStatusCode: component.expectedStatusCode,
            timeoutMs: component.timeoutMs,
            isPublic: component.isPublic,
            isMonitored: component.isMonitored,
            manualStatusOverride: component.manualStatusOverride,
            currentStatus: component.currentStatus,
            dependencies: component.dependencies || [],
            lastCheckedAt: component.lastCheckedAt,
            lastStatusChangeAt: component.lastStatusChangeAt,
            lastResponseTimeMs: component.lastResponseTimeMs,
            consecutiveFailures: component.consecutiveFailures,
            order: component.order,
        })),
        incidents: allIncidents.map((incident) => ({
            id: String(incident._id),
            title: incident.title,
            slug: incident.slug,
            severity: incident.severity || 'SEV3',
            impact: incident.impact,
            status: incident.status,
            commander: incident.commander || '',
            source: incident.source || 'manual',
            summary: incident.summary || incident.description || '',
            customerImpact: incident.customerImpact || '',
            rootCause: incident.rootCause || '',
            mitigation: incident.mitigation || '',
            prevention: incident.prevention || '',
            internalNotes: incident.internalNotes || '',
            postmortem: incident.postmortem || { status: 'missing' },
            affectedComponentIds: (incident.affectedComponentIds || []).map(String),
            startedAt: incident.startedAt,
            detectedAt: incident.detectedAt,
            acknowledgedAt: incident.acknowledgedAt,
            resolvedAt: incident.resolvedAt,
            scheduledStartAt: incident.scheduledStartAt,
            scheduledEndAt: incident.scheduledEndAt,
            isPublic: incident.isPublic,
            timeline: incident.timeline || [],
        })),
        maintenanceWindows: allMaintenanceWindows.map((window) => ({
            id: String(window._id),
            title: window.title,
            slug: window.slug,
            status: window.status,
            affectedComponentIds: (window.affectedComponentIds || []).map(String),
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            publicMessage: window.publicMessage,
            internalNotes: window.internalNotes,
            notifySubscribers: window.notifySubscribers,
            isPublic: window.isPublic,
        })),
        recentChecks: recentChecks.map((check) => ({
            id: String(check._id),
            componentId: check.componentId?._id ? String(check.componentId._id) : String(check.componentId || ''),
            componentName: check.componentId?.name || 'Unknown component',
            status: check.status,
            responseTimeMs: check.responseTimeMs,
            httpStatusCode: check.httpStatusCode,
            errorMessage: sanitizeText(check.errorMessage, 240),
            checkedAt: check.checkedAt,
            region: check.region,
        })),
        templates: STATUS_UPDATE_TEMPLATES,
        severityPolicy: SEVERITY_POLICY,
    };
};

const createOrUpdateGroupForComponent = async ({ groupId, groupName }) => {
    if (groupId) return StatusComponentGroup.findById(toObjectId(groupId, 'groupId'));
    const safeName = sanitizeText(groupName || 'General', 120);
    const slug = normalizeSlug(safeName);
    return StatusComponentGroup.findOneAndUpdate(
        { slug },
        {
            $setOnInsert: {
                name: safeName,
                slug,
                description: '',
                order: 999,
                isPublic: true,
            },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
};

const assertSafeMonitorConfig = ({ checkType = 'manual', checkUrl = '' } = {}) => {
    if (checkType !== 'http') return;
    if (!checkUrl) {
        throw new AppError('HTTP monitored components require a check URL', 400);
    }
    try {
        assertAllowedMonitorUrl(checkUrl);
    } catch {
        throw new AppError('HTTP monitor URL must use a public host listed in STATUS_MONITOR_ALLOWED_HOSTS', 400);
    }
};

const writeStatusAuditLog = async ({
    action,
    actorUserId = null,
    actor = '',
    targetType = '',
    targetId = '',
    req = null,
    metadata = {},
} = {}) => {
    try {
        await StatusAuditLog.create({
            action,
            actorUserId,
            actor: sanitizeText(actor, 160),
            targetType,
            targetId: String(targetId || ''),
            requestId: String(req?.requestId || req?.headers?.['x-request-id'] || ''),
            ip: String(req?.ip || ''),
            metadata,
        });
    } catch (error) {
        logger.warn('status.audit_log_failed', { action, error: error.message });
    }
};

const createStatusComponent = async (payload = {}) => {
    const group = await createOrUpdateGroupForComponent(payload);
    if (!group) throw new AppError('Component group not found', 404);
    const name = sanitizeText(payload.name, 120);
    if (!name) throw new AppError('Component name is required', 400);
    assertSafeMonitorConfig({
        checkType: payload.checkType || 'manual',
        checkUrl: payload.checkUrl || '',
    });
    const component = await StatusComponent.create({
        groupId: group._id,
        name,
        slug: normalizeSlug(payload.slug || name),
        description: sanitizeText(payload.description, 500),
        checkType: payload.checkType || 'manual',
        checkUrl: sanitizeText(payload.checkUrl, 500),
        checkMethod: payload.checkMethod || 'GET',
        expectedStatusCode: payload.expectedStatusCode || 200,
        timeoutMs: payload.timeoutMs || 5000,
        dependencies: payload.dependencies || [],
        isPublic: payload.isPublic !== undefined ? Boolean(payload.isPublic) : true,
        isMonitored: payload.isMonitored !== undefined ? Boolean(payload.isMonitored) : true,
        manualStatusOverride: payload.manualStatusOverride ? normalizeComponentStatus(payload.manualStatusOverride) : null,
        currentStatus: normalizeComponentStatus(payload.currentStatus || payload.manualStatusOverride || 'operational'),
        lastStatusChangeAt: new Date(),
        order: payload.order || 0,
        metadata: payload.metadata || {},
    });
    await writeStatusAuditLog({
        action: 'component.status_changed',
        targetType: 'StatusComponent',
        targetId: component._id,
        metadata: { status: component.currentStatus, source: 'manual_create' },
    });
    invalidatePublicStatusCache();
    return component;
};

const updateStatusComponent = async (componentId, payload = {}) => {
    const component = await StatusComponent.findById(toObjectId(componentId, 'componentId'));
    if (!component) throw new AppError('Component not found', 404);
    assertSafeMonitorConfig({
        checkType: payload.checkType || component.checkType,
        checkUrl: payload.checkUrl !== undefined ? payload.checkUrl : component.checkUrl,
    });
    const allowed = [
        'name', 'description', 'checkType', 'checkUrl', 'checkMethod', 'expectedStatusCode',
        'timeoutMs', 'dependencies', 'isPublic', 'isMonitored', 'manualStatusOverride', 'currentStatus', 'order', 'metadata',
    ];
    allowed.forEach((field) => {
        if (payload[field] === undefined) return;
        if (['name', 'description', 'checkUrl'].includes(field)) {
            component[field] = sanitizeText(payload[field], field === 'description' ? 500 : 500);
            return;
        }
        if (['currentStatus', 'manualStatusOverride'].includes(field)) {
            component[field] = payload[field] ? normalizeComponentStatus(payload[field]) : payload[field];
            return;
        }
        component[field] = payload[field];
    });
    if (payload.groupId) component.groupId = toObjectId(payload.groupId, 'groupId');
    if (payload.slug) component.slug = normalizeSlug(payload.slug);
    if (payload.manualStatusOverride !== undefined) {
        component.currentStatus = payload.manualStatusOverride
            ? normalizeComponentStatus(payload.manualStatusOverride)
            : normalizeComponentStatus(payload.currentStatus || component.currentStatus);
    }
    await component.save();
    await writeStatusAuditLog({
        action: 'component.status_changed',
        targetType: 'StatusComponent',
        targetId: component._id,
        metadata: { status: component.currentStatus, source: 'manual_update' },
    });
    invalidatePublicStatusCache();
    return component;
};

const createIncidentUpdate = async ({
    incident,
    status,
    message,
    createdBy,
    type = 'status_update',
    isPublic = true,
    actor = '',
    deployment = {},
}) => {
    const update = await StatusIncidentUpdate.create({
        incidentId: incident._id,
        status: status || incident.status,
        type,
        message: sanitizeText(message || incident.description || incident.title, 5000),
        isPublic,
        actor: sanitizeText(actor, 160),
        deployment,
        createdBy: createdBy || null,
    });
    incident.timeline = Array.isArray(incident.timeline) ? incident.timeline : [];
    incident.timeline.push({
        at: update.createdAt || new Date(),
        type,
        message: update.message,
        public: isPublic,
        actor: update.actor || '',
        deployment,
    });
    await incident.save();
    return update;
};

const notifySubscribersOfIncident = async ({ incident, update }) => {
    const subscribers = await StatusSubscriber.find({ unsubscribedAt: null }).lean();
    if (subscribers.length === 0) return { queued: 0 };
    const incidentType = incident.impact === 'maintenance' ? 'maintenance' : 'incident';
    const isMajor = ['major', 'critical'].includes(incident.impact);
    const components = await StatusComponent.find({ _id: { $in: incident.affectedComponentIds || [] } }).lean();
    const affectedNames = components.map((component) => component.name).filter(Boolean);
    let queued = 0;
    await Promise.all(subscribers.map(async (subscriber) => {
        if (subscriber.notificationLevel === 'maintenance' && incidentType !== 'maintenance') return;
        if (subscriber.notificationLevel === 'major' && !isMajor) return;
        if ((subscriber.selectedComponentIds || []).length) {
            const selected = new Set((subscriber.selectedComponentIds || []).map(String));
            const hasSelectedComponent = (incident.affectedComponentIds || []).some((id) => selected.has(String(id)));
            if (!hasSelectedComponent) return;
        }
        const token = buildUnsubscribeToken(subscriber.email);
        const subject = incidentType === 'maintenance'
            ? `[Aura Status] Maintenance scheduled: ${incident.title}`
            : `[Aura Status] ${incident.title}`;
        const text = [
            sanitizeText(update?.message || incident.summary || incident.description || subject, 1200),
            '',
            'Affected:',
            ...(affectedNames.length ? affectedNames.map((name) => `- ${name}`) : ['- Aura']),
            '',
            'Current status:',
            incident.status,
            '',
            'Latest update:',
            sanitizeText(update?.message || incident.description || '', 1200),
            '',
            `View: ${incidentType === 'maintenance' ? buildPublicStatusUrl('/status') : buildPublicStatusUrl(`/status/incidents/${incident.slug}`)}`,
            `Unsubscribe: ${buildPublicStatusUrl(`/status/subscribe?unsubscribe=${encodeURIComponent(token)}`)}`,
        ].join('\n');
        const outbox = await enqueueStatusEmail({
            eventType: incident.status === 'resolved'
                ? 'status.incident_resolved'
                : incidentType === 'maintenance'
                    ? 'status.maintenance_scheduled'
                    : 'status.incident_update',
            idempotencyKey: `status-incident-${incident._id}-${update?._id || incident.updatedAt?.getTime?.() || Date.now()}-${subscriber._id}`,
            recipientEmail: subscriber.email,
            subject,
            text,
            subscriberId: subscriber._id,
            incidentId: incident._id,
            incidentUpdateId: update?._id || null,
            meta: { incidentId: String(incident._id), impact: incident.impact, status: incident.status },
        });
        if (outbox) queued += 1;
    }));
    return { queued };
};

const createStatusIncident = async (payload = {}, actorUserId = null) => {
    const title = sanitizeText(payload.title, 180);
    if (!title) throw new AppError('Incident title is required', 400);
    const impact = payload.impact || 'minor';
    const severity = payload.severity || (impact === 'critical' ? 'SEV1' : impact === 'major' ? 'SEV2' : 'SEV3');
    if ((['major', 'critical'].includes(impact) || ['SEV1', 'SEV2'].includes(severity)) && payload.confirmMajor !== true && payload.isPublic !== false) {
        throw new AppError('Publishing a major or critical incident requires confirmation', 409);
    }
    const affectedComponentIds = (payload.affectedComponentIds || []).map((id) => toObjectId(id, 'affectedComponentIds'));
    const incident = await StatusIncident.create({
        title,
        slug: payload.slug ? normalizeSlug(payload.slug) : await generateIncidentSlug(title),
        description: sanitizeText(payload.description, 5000),
        summary: sanitizeText(payload.summary || payload.description, 5000),
        severity,
        impact,
        status: payload.status || 'investigating',
        affectedComponentIds,
        startedAt: payload.startedAt ? new Date(payload.startedAt) : new Date(),
        detectedAt: payload.detectedAt ? new Date(payload.detectedAt) : new Date(),
        acknowledgedAt: payload.acknowledgedAt ? new Date(payload.acknowledgedAt) : null,
        scheduledStartAt: payload.scheduledStartAt ? new Date(payload.scheduledStartAt) : null,
        scheduledEndAt: payload.scheduledEndAt ? new Date(payload.scheduledEndAt) : null,
        commander: sanitizeText(payload.commander, 160),
        source: payload.source || 'manual',
        isPublic: payload.isPublic !== undefined ? Boolean(payload.isPublic) : true,
        rootCause: sanitizeText(payload.rootCause, 5000),
        mitigation: sanitizeText(payload.mitigation, 5000),
        prevention: sanitizeText(payload.prevention, 5000),
        customerImpact: sanitizeText(payload.customerImpact, 5000),
        internalNotes: sanitizeText(payload.internalNotes, 10000),
        createdBy: actorUserId || null,
    });
    const update = await createIncidentUpdate({
        incident,
        status: incident.status,
        message: payload.updateMessage || incident.description || incident.title,
        type: payload.updateType || 'detected',
        isPublic: payload.updatePublic !== undefined ? Boolean(payload.updatePublic) : incident.isPublic,
        actor: payload.commander || '',
        deployment: payload.deployment || {},
        createdBy: actorUserId,
    });
    if (incident.isPublic) {
        await notifySubscribersOfIncident({ incident, update });
    }
    await writeStatusAuditLog({
        action: 'incident.created',
        actorUserId,
        actor: payload.commander || '',
        targetType: 'StatusIncident',
        targetId: incident._id,
        metadata: { severity: incident.severity, impact: incident.impact, status: incident.status, source: incident.source },
    });
    invalidatePublicStatusCache();
    return incident;
};

const updateStatusIncident = async (incidentId, payload = {}, actorUserId = null) => {
    const incident = await StatusIncident.findById(toObjectId(incidentId, 'incidentId'));
    if (!incident) throw new AppError('Incident not found', 404);
    [
        'title', 'description', 'summary', 'severity', 'impact', 'status', 'commander', 'source',
        'isPublic', 'rootCause', 'mitigation', 'prevention', 'customerImpact', 'internalNotes', 'resolutionSummary',
    ].forEach((field) => {
        if (payload[field] !== undefined) {
            incident[field] = [
                'title', 'description', 'summary', 'commander', 'rootCause', 'mitigation',
                'prevention', 'customerImpact', 'internalNotes', 'resolutionSummary',
            ].includes(field)
                ? sanitizeText(payload[field], field === 'title' ? 180 : 5000)
                : payload[field];
        }
    });
    if (payload.affectedComponentIds) {
        incident.affectedComponentIds = payload.affectedComponentIds.map((id) => toObjectId(id, 'affectedComponentIds'));
    }
    if (payload.startedAt) incident.startedAt = new Date(payload.startedAt);
    if (payload.detectedAt !== undefined) incident.detectedAt = payload.detectedAt ? new Date(payload.detectedAt) : null;
    if (payload.acknowledgedAt !== undefined) incident.acknowledgedAt = payload.acknowledgedAt ? new Date(payload.acknowledgedAt) : new Date();
    if (payload.resolvedAt) incident.resolvedAt = new Date(payload.resolvedAt);
    if (payload.scheduledStartAt !== undefined) incident.scheduledStartAt = payload.scheduledStartAt ? new Date(payload.scheduledStartAt) : null;
    if (payload.scheduledEndAt !== undefined) incident.scheduledEndAt = payload.scheduledEndAt ? new Date(payload.scheduledEndAt) : null;
    if (incident.status === 'resolved' && !incident.resolvedAt) incident.resolvedAt = new Date();
    await incident.save();

    let update = null;
    if (payload.updateMessage) {
        update = await createIncidentUpdate({
            incident,
            status: incident.status,
            message: payload.updateMessage,
            type: payload.updateType || 'status_update',
            isPublic: payload.updatePublic !== undefined ? Boolean(payload.updatePublic) : incident.isPublic,
            actor: payload.commander || incident.commander || '',
            deployment: payload.deployment || {},
            createdBy: actorUserId,
        });
        if (incident.isPublic && update.isPublic !== false) await notifySubscribersOfIncident({ incident, update });
    }
    await writeStatusAuditLog({
        action: incident.status === 'resolved' ? 'incident.resolved' : 'incident.updated',
        actorUserId,
        actor: payload.commander || incident.commander || '',
        targetType: 'StatusIncident',
        targetId: incident._id,
        metadata: { severity: incident.severity, impact: incident.impact, status: incident.status },
    });
    invalidatePublicStatusCache();
    return { incident, update };
};

const addIncidentUpdate = async (incidentId, payload = {}, actorUserId = null) => {
    const incident = await StatusIncident.findById(toObjectId(incidentId, 'incidentId'));
    if (!incident) throw new AppError('Incident not found', 404);
    if (payload.status) incident.status = payload.status;
    const update = await createIncidentUpdate({
        incident,
        status: payload.status || incident.status,
        message: payload.message,
        type: payload.type || 'status_update',
        isPublic: payload.isPublic !== undefined ? Boolean(payload.isPublic) : payload.public !== false,
        actor: payload.actor || incident.commander || '',
        deployment: payload.deployment || {},
        createdBy: actorUserId,
    });
    await incident.save();
    if (incident.isPublic && update.isPublic !== false) await notifySubscribersOfIncident({ incident, update });
    await writeStatusAuditLog({
        action: update.isPublic === false ? 'incident.internal_note_added' : 'incident.updated',
        actorUserId,
        actor: payload.actor || incident.commander || '',
        targetType: 'StatusIncident',
        targetId: incident._id,
        metadata: { status: incident.status, type: update.type },
    });
    invalidatePublicStatusCache();
    return update;
};

const resolveIncident = async (incidentId, payload = {}, actorUserId = null) => {
    const incident = await StatusIncident.findById(toObjectId(incidentId, 'incidentId'));
    if (!incident) throw new AppError('Incident not found', 404);
    incident.status = 'resolved';
    incident.resolvedAt = payload.resolvedAt ? new Date(payload.resolvedAt) : new Date();
    incident.resolutionSummary = sanitizeText(payload.resolutionSummary || payload.message || 'The issue has been resolved.', 5000);
    await incident.save();
    const update = await createIncidentUpdate({
        incident,
        status: 'resolved',
        message: payload.message || incident.resolutionSummary,
        type: 'resolved',
        isPublic: payload.updatePublic !== false,
        actor: payload.actor || incident.commander || '',
        createdBy: actorUserId,
    });
    if (incident.isPublic) await notifySubscribersOfIncident({ incident, update });
    await writeStatusAuditLog({
        action: 'incident.resolved',
        actorUserId,
        actor: payload.actor || incident.commander || '',
        targetType: 'StatusIncident',
        targetId: incident._id,
        metadata: { severity: incident.severity, impact: incident.impact },
    });
    invalidatePublicStatusCache();
    return incident;
};

const generateIncidentPostmortem = async (incidentId, payload = {}, actorUserId = null) => {
    const incident = await StatusIncident.findById(toObjectId(incidentId, 'incidentId'));
    if (!incident) throw new AppError('Incident not found', 404);
    const updates = await StatusIncidentUpdate.find({ incidentId: incident._id }).sort({ createdAt: 1 }).lean();
    const timelineRows = updates.length
        ? updates.map((update) => `- ${new Date(update.createdAt).toISOString()} - ${update.type || update.status}: ${sanitizeText(update.message, 1000)}`)
        : (incident.timeline || []).map((entry) => `- ${new Date(entry.at).toISOString()} - ${entry.type}: ${sanitizeText(entry.message, 1000)}`);
    const owner = sanitizeText(payload.owner || incident.commander || 'Incident Commander', 160);
    const dueDate = payload.dueDate ? new Date(payload.dueDate).toISOString().slice(0, 10) : '';
    const markdown = [
        `# Incident Postmortem: ${incident.title}`,
        '',
        '## Summary',
        sanitizeText(incident.summary || incident.description || 'What happened?', 5000),
        '',
        '## Customer Impact',
        sanitizeText(incident.customerImpact || 'Who was affected and how?', 5000),
        '',
        '## Timeline',
        `- Detected: ${incident.detectedAt ? new Date(incident.detectedAt).toISOString() : ''}`,
        `- Acknowledged: ${incident.acknowledgedAt ? new Date(incident.acknowledgedAt).toISOString() : ''}`,
        `- Identified: ${updates.find((update) => update.status === 'identified')?.createdAt?.toISOString?.() || ''}`,
        `- Mitigated: ${updates.find((update) => update.type === 'mitigation')?.createdAt?.toISOString?.() || ''}`,
        `- Resolved: ${incident.resolvedAt ? new Date(incident.resolvedAt).toISOString() : ''}`,
        '',
        ...timelineRows,
        '',
        '## Root Cause',
        sanitizeText(incident.rootCause || 'Technical cause.', 5000),
        '',
        '## What Went Well',
        '- Detection',
        '- Communication',
        '- Recovery',
        '',
        '## What Went Wrong',
        '- Missing alert',
        '- Slow diagnosis',
        '- Weak fallback',
        '',
        '## Action Items',
        '| Action | Owner | Due Date | Status |',
        '|---|---|---|---|',
        `| Complete prevention action | ${owner} | ${dueDate} | Open |`,
        '',
        '## Prevention',
        sanitizeText(incident.prevention || 'What will stop this from happening again?', 5000),
        '',
    ].join('\n');

    incident.postmortem = {
        generatedAt: new Date(),
        generatedBy: actorUserId || null,
        markdown,
        status: 'draft',
    };
    await incident.save();
    await createIncidentUpdate({
        incident,
        status: incident.status,
        type: 'postmortem',
        isPublic: false,
        actor: owner,
        message: 'Postmortem draft generated.',
        createdBy: actorUserId,
    });
    await writeStatusAuditLog({
        action: 'postmortem.generated',
        actorUserId,
        actor: owner,
        targetType: 'StatusIncident',
        targetId: incident._id,
        metadata: { severity: incident.severity, status: incident.status },
    });
    return {
        incidentId: String(incident._id),
        markdown,
        generatedAt: incident.postmortem.generatedAt,
    };
};

const generateMaintenanceSlug = async (title) => {
    const base = normalizeSlug(title).slice(0, 120);
    let candidate = base;
    let index = 2;
    while (await MaintenanceWindow.exists({ slug: candidate })) {
        candidate = `${base}-${index}`;
        index += 1;
    }
    return candidate;
};

const createMaintenance = async (payload = {}, actorUserId = null) => {
    const title = sanitizeText(payload.title, 180);
    if (!title) throw new AppError('Maintenance title is required', 400);
    const startsAt = payload.startsAt || payload.scheduledStartAt;
    const endsAt = payload.endsAt || payload.scheduledEndAt;
    if (!startsAt || !endsAt) throw new AppError('Maintenance start and end times are required', 400);
    const affectedComponentIds = (payload.affectedComponentIds || []).map((id) => toObjectId(id, 'affectedComponentIds'));
    const window = await MaintenanceWindow.create({
        title,
        slug: payload.slug ? normalizeSlug(payload.slug) : await generateMaintenanceSlug(title),
        status: payload.status || 'scheduled',
        affectedComponentIds,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        publicMessage: sanitizeText(payload.publicMessage || payload.updateMessage || payload.description, 5000),
        internalNotes: sanitizeText(payload.internalNotes, 10000),
        notifySubscribers: payload.notifySubscribers !== undefined ? Boolean(payload.notifySubscribers) : true,
        isPublic: payload.isPublic !== undefined ? Boolean(payload.isPublic) : true,
        createdBy: actorUserId || null,
    });
    if (window.isPublic && window.notifySubscribers) {
        const pseudoIncident = {
            _id: window._id,
            title: window.title,
            slug: window.slug,
            impact: 'maintenance',
            status: window.status,
            affectedComponentIds: window.affectedComponentIds,
            description: window.publicMessage,
            summary: window.publicMessage,
        };
        await notifySubscribersOfIncident({
            incident: pseudoIncident,
            update: {
                _id: window._id,
                message: window.publicMessage || window.title,
            },
        });
    }
    await writeStatusAuditLog({
        action: 'maintenance.created',
        actorUserId,
        targetType: 'MaintenanceWindow',
        targetId: window._id,
        metadata: { status: window.status, startsAt: window.startsAt, endsAt: window.endsAt },
    });
    invalidatePublicStatusCache();
    return window;
};

const isHostPrivateOrLocal = (hostname = '') => {
    const host = String(hostname || '').trim().toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === '0.0.0.0' || host === '::1' || host === '[::1]') return true;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
    const parts = host.split('.').map(Number);
    if (parts.length === 4 && parts.every((part) => Number.isInteger(part))) {
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        if (parts[0] === 169 && parts[1] === 254) return true;
    }
    return false;
};

const getAllowedMonitorHosts = () => new Set(String(process.env.STATUS_MONITOR_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean));

const assertAllowedMonitorUrl = (rawUrl = '') => {
    const url = new URL(String(rawUrl || ''));
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('unsupported_protocol');
    }
    const allowedHosts = getAllowedMonitorHosts();
    const host = url.hostname.toLowerCase();
    if (allowedHosts.has(host)) return url;
    if (isHostPrivateOrLocal(host)) throw new Error('private_host_blocked');
    if (allowedHosts.size === 0) throw new Error('monitor_host_not_allowlisted');
    throw new Error('monitor_host_not_allowlisted');
};

const runHttpCheck = async (component) => {
    const url = assertAllowedMonitorUrl(component.checkUrl);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Number(component.timeoutMs || 5000));
    try {
        const response = await fetch(url.toString(), {
            method: component.checkMethod || 'GET',
            signal: controller.signal,
            headers: { 'User-Agent': 'AuraStatusMonitor/1.0' },
        });
        const responseTimeMs = Date.now() - startedAt;
        const expected = Number(component.expectedStatusCode || 200);
        return {
            ok: response.status === expected,
            httpStatusCode: response.status,
            responseTimeMs,
            errorMessage: response.status === expected ? '' : `unexpected_status_${response.status}`,
        };
    } finally {
        clearTimeout(timeoutId);
    }
};

const runDatabaseCheck = async () => ({
    ok: mongoose.connection.readyState === 1,
    responseTimeMs: 0,
    errorMessage: mongoose.connection.readyState === 1 ? '' : 'database_disconnected',
});

const runRedisCheck = async () => {
    const redis = getRedisHealth();
    return {
        ok: redis.connected || !redis.required,
        responseTimeMs: 0,
        errorMessage: redis.connected || !redis.required ? '' : 'redis_disconnected',
    };
};

const isOkHealthStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return ['ok', 'healthy', 'ready', 'connected', 'operational'].includes(normalized);
};

const isBadHealthStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return ['degraded', 'unhealthy', 'failed', 'error', 'down', 'stale', 'critical'].includes(normalized);
};

const buildSignalResult = ({ ok, status, errorMessage = '', responseTimeMs = 0 } = {}) => ({
    ok: Boolean(ok),
    status: status || (ok ? 'operational' : 'degraded_performance'),
    responseTimeMs,
    errorMessage: ok ? '' : errorMessage,
});

const getHealthSignal = (component = {}) => String(component?.metadata?.healthSignal || '').trim().toLowerCase();

const isSplitRuntimeEnabled = () => toBool(process.env.SPLIT_RUNTIME_ENABLED, false);

const hasFirebaseAdminApp = () => Array.isArray(firebaseAdmin.apps) && firebaseAdmin.apps.length > 0;

const resolveCoreHealth = (snapshot = {}) => {
    const ok = Boolean(snapshot?.core?.dbConnected && snapshot?.core?.redisConnected);
    return buildSignalResult({
        ok,
        errorMessage: ok ? '' : 'core_dependencies_degraded',
    });
};

const resolveCatalogHealth = (snapshot = {}) => {
    const catalog = snapshot?.services?.catalog || {};
    const ok = isOkHealthStatus(catalog.status) && catalog.staleData !== true;
    return buildSignalResult({
        ok,
        errorMessage: ok ? '' : 'catalog_health_degraded',
    });
};

const resolveAuthHealth = (snapshot = {}) => {
    const core = resolveCoreHealth(snapshot);
    const ok = core.ok && hasFirebaseAdminApp();
    return buildSignalResult({
        ok,
        errorMessage: ok ? '' : (core.errorMessage || 'firebase_admin_unavailable'),
    });
};

const resolvePaymentHealth = (snapshot = {}) => {
    if (!paymentFlags.paymentsEnabled) {
        return buildSignalResult({ ok: true, status: 'maintenance', errorMessage: '' });
    }

    const services = snapshot?.services || {};
    const queue = services.paymentQueue || {};
    const reconciliation = services.reconciliation || {};
    const fx = services.fx || {};
    const queueOk = isOkHealthStatus(queue.status) || queue.ok === true;
    const workerOk = !isSplitRuntimeEnabled() || queue.workerRunning !== false;
    const reconciliationOk = !isBadHealthStatus(reconciliation.status);
    const fxOk = !isBadHealthStatus(fx.status);
    const ok = queueOk && workerOk && reconciliationOk && fxOk;

    return buildSignalResult({
        ok,
        errorMessage: ok ? '' : 'payment_health_degraded',
    });
};

const resolveEmailHealth = (snapshot = {}, { requireSubscriptionSecret = false } = {}) => {
    const disabledProviders = new Set(['null', 'none', 'disabled']);
    if (!emailFlags.orderEmailsEnabled || disabledProviders.has(emailFlags.orderEmailProvider)) {
        return buildSignalResult({ ok: true, status: 'maintenance', errorMessage: '' });
    }

    if (
        requireSubscriptionSecret
        && process.env.NODE_ENV === 'production'
        && !String(process.env.STATUS_UNSUBSCRIBE_SECRET || '').trim()
    ) {
        return buildSignalResult({ ok: false, errorMessage: 'status_unsubscribe_secret_missing' });
    }

    const queue = snapshot?.services?.emailQueue || {};
    const queueOk = isOkHealthStatus(queue.status) || queue.ok === true;
    const workerOk = !isSplitRuntimeEnabled() || queue.workerRunning !== false;
    const ok = queueOk && workerOk;

    return buildSignalResult({
        ok,
        errorMessage: ok ? '' : 'email_health_degraded',
    });
};

const resolveAiHealth = (snapshot = {}) => {
    const ai = snapshot?.services?.ai || {};
    const assistant = ai.commerceAssistant || {};
    const hasAssistantSignal = Object.keys(assistant).length > 0;
    const ok = hasAssistantSignal
        && assistant.healthy !== false
        && !isBadHealthStatus(assistant.status)
        && !isBadHealthStatus(assistant.gateway?.status)
        && !isBadHealthStatus(ai.chatQuota?.status);

    return buildSignalResult({
        ok,
        errorMessage: ok ? '' : 'ai_health_degraded',
    });
};

const resolveRealtimeHealth = (snapshot = {}) => {
    const realtime = snapshot?.services?.realtime || {};
    const socket = realtime.socket || {};
    const videoCalls = realtime.videoCalls || {};
    const hasRealtimeSignal = Object.keys(socket).length > 0 || Object.keys(videoCalls).length > 0;
    const ok = hasRealtimeSignal
        && !isBadHealthStatus(socket.status)
        && !isBadHealthStatus(videoCalls.status)
        && socket.healthy !== false
        && videoCalls.healthy !== false;

    return buildSignalResult({
        ok,
        errorMessage: ok ? '' : 'realtime_health_degraded',
    });
};

const resolveUploadHealth = async () => {
    const uploadHealth = await getReviewUploadStorageHealth();
    return buildSignalResult({
        ok: uploadHealth.ok,
        errorMessage: uploadHealth.ok ? '' : 'upload_storage_unavailable',
    });
};

const resolveAdminHealth = (snapshot = {}) => {
    const auth = resolveAuthHealth(snapshot);
    const core = resolveCoreHealth(snapshot);
    const ok = auth.ok && core.ok;
    return buildSignalResult({
        ok,
        errorMessage: ok ? '' : (auth.errorMessage || core.errorMessage || 'admin_health_degraded'),
    });
};

const STUDENT_PACK_SIGNAL_PROVIDER_IDS = {
    student_pack_sentry: 'sentry',
    student_pack_datadog: 'datadog',
    student_pack_doppler: 'doppler',
    student_pack_testmail: 'testmail',
    student_pack_lambdatest: 'lambdatest',
    student_pack_localstack: 'localstack',
};

const harnessProviderStatusToComponentStatus = (status) => {
    switch (status) {
        case 'ready':
            return 'operational';
        case 'partial':
            return 'degraded_performance';
        case 'blocked':
            return 'partial_outage';
        default:
            return 'degraded_performance';
    }
};

const resolveStudentPackSecurityHarnessHealth = async (signal) => {
    if (!isStudentPackSecurityHarnessEnabled()) {
        return buildSignalResult({ ok: true, status: 'maintenance', errorMessage: '' });
    }

    const providerId = STUDENT_PACK_SIGNAL_PROVIDER_IDS[signal];
    const probeEndpoints = providerId === 'localstack'
        && toBool(process.env.STUDENT_PACK_SECURITY_HARNESS_PROBE_ENDPOINTS, true);
    const snapshot = await getStudentPackSecurityHarnessSnapshot({ probeEndpoints });

    if (!providerId) {
        return buildSignalResult({
            ok: snapshot.overallStatus === 'operational',
            status: snapshot.overallStatus,
            errorMessage: snapshot.overallStatus === 'operational' ? '' : 'student_pack_security_harness_degraded',
        });
    }

    const provider = snapshot.providers.find((entry) => entry.id === providerId);
    const status = harnessProviderStatusToComponentStatus(provider?.status || 'blocked');
    return buildSignalResult({
        ok: status === 'operational',
        status,
        errorMessage: status === 'operational' ? '' : `${providerId}_harness_${provider?.status || 'blocked'}`,
    });
};

const resolveInternalHealthSignalStatus = async (signal = 'api', snapshot = {}) => {
    switch (signal) {
        case 'web_app':
        case 'api':
        case 'commerce_api':
            return resolveCoreHealth(snapshot);
        case 'catalog':
            return resolveCatalogHealth(snapshot);
        case 'auth':
            return resolveAuthHealth(snapshot);
        case 'payments':
            return resolvePaymentHealth(snapshot);
        case 'email':
            return resolveEmailHealth(snapshot);
        case 'status_subscriptions':
            return resolveEmailHealth(snapshot, { requireSubscriptionSecret: true });
        case 'ai':
            return resolveAiHealth(snapshot);
        case 'uploads':
            return resolveUploadHealth();
        case 'realtime':
            return resolveRealtimeHealth(snapshot);
        case 'admin':
            return resolveAdminHealth(snapshot);
        case 'student_pack_security_harness':
        case 'student_pack_sentry':
        case 'student_pack_datadog':
        case 'student_pack_doppler':
        case 'student_pack_testmail':
        case 'student_pack_lambdatest':
        case 'student_pack_localstack':
            return resolveStudentPackSecurityHarnessHealth(signal);
        default:
            return resolveCoreHealth(snapshot);
    }
};

const runInternalHealthCheck = async (component = {}) => {
    const snapshot = await getCachedHealthSnapshot();
    const signal = getHealthSignal(component) || 'api';
    const result = await resolveInternalHealthSignalStatus(signal, snapshot);
    return {
        responseTimeMs: 0,
        ...result,
    };
};

const executeComponentCheck = async (component) => {
    if (component.manualStatusOverride) {
        return { ok: component.manualStatusOverride === 'operational', status: component.manualStatusOverride, responseTimeMs: component.lastResponseTimeMs || null, errorMessage: '' };
    }
    if (!component.isMonitored) {
        return { ok: true, status: component.currentStatus || 'operational', responseTimeMs: component.lastResponseTimeMs || null, errorMessage: 'monitoring_disabled' };
    }
    switch (component.checkType) {
        case 'http':
            return runHttpCheck(component);
        case 'database':
            return runDatabaseCheck(component);
        case 'redis':
            return runRedisCheck(component);
        case 'internal_health':
            return runInternalHealthCheck(component);
        case 'manual':
        default:
            return { ok: true, status: component.currentStatus || 'operational', responseTimeMs: component.lastResponseTimeMs || null, errorMessage: '' };
    }
};

const classifyCheckStatus = ({ result, component }) => {
    if (result.status) return result.status;
    if (result.ok) return 'operational';
    const nextFailures = Number(component.consecutiveFailures || 0) + 1;
    if (nextFailures >= 5) return 'major_outage';
    if (nextFailures >= 3) return 'partial_outage';
    return 'degraded_performance';
};

const aggregateDailyMetric = async (componentId, date = getDateKey()) => {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = addDaysUtc(start, 1);
    const checks = await StatusCheck.find({
        componentId,
        checkedAt: { $gte: start, $lt: end },
    }).lean();
    const totalChecks = checks.length;
    const successfulChecks = checks.filter((check) => check.status === 'operational').length;
    const failedChecks = checks.filter((check) => ['partial_outage', 'major_outage'].includes(check.status)).length;
    const degradedChecks = checks.filter((check) => check.status === 'degraded_performance').length;
    const maintenanceChecks = checks.filter((check) => check.status === 'maintenance').length;
    const responseTimes = checks.map((check) => Number(check.responseTimeMs)).filter((value) => Number.isFinite(value));
    const uptimePercent = calculateUptimePercent({ successfulChecks, totalChecks });
    const status = calculateDayStatus({ uptimePercent, totalChecks, maintenanceChecks });
    const downtimeMinutes = totalChecks > 0
        ? Math.round(((failedChecks + degradedChecks) / totalChecks) * 1440)
        : 0;

    await StatusDailyMetric.findOneAndUpdate(
        { componentId, date },
        {
            $set: {
                uptimePercent,
                status,
                totalChecks,
                successfulChecks,
                failedChecks,
                degradedChecks,
                avgResponseTimeMs: responseTimes.length
                    ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
                    : null,
                downtimeMinutes,
            },
        },
        { upsert: true, setDefaultsOnInsert: true }
    );
};

const runStatusCheckForComponent = async (component) => {
    const startedAt = new Date();
    let result;
    try {
        result = await executeComponentCheck(component);
    } catch (error) {
        result = {
            ok: false,
            responseTimeMs: null,
            errorMessage: sanitizeText(error.message || 'check_failed', 240),
        };
    }

    const status = normalizeComponentStatus(classifyCheckStatus({ result, component }));
    const previousStatus = normalizeComponentStatus(component.currentStatus || 'operational');
    const consecutiveFailures = result.ok ? 0 : Number(component.consecutiveFailures || 0) + 1;
    if (!result.ok) {
        incrementStatusMonitorFailure({ component: component.slug || String(component._id), source: component.checkType || 'monitor' });
    }
    await StatusCheck.create({
        componentId: component._id,
        status,
        responseTimeMs: result.responseTimeMs ?? null,
        httpStatusCode: result.httpStatusCode ?? null,
        errorMessage: sanitizeText(result.errorMessage, 500),
        checkedAt: startedAt,
        region: process.env.STATUS_MONITOR_REGION || '',
    });
    await StatusComponent.updateOne(
        { _id: component._id },
        {
            $set: {
                currentStatus: status,
                lastCheckedAt: startedAt,
                lastStatusChangeAt: previousStatus !== status ? startedAt : component.lastStatusChangeAt || null,
                lastResponseTimeMs: result.responseTimeMs ?? null,
                lastSuccessAt: result.ok ? startedAt : component.lastSuccessAt || null,
                lastFailureAt: result.ok ? component.lastFailureAt || null : startedAt,
                consecutiveFailures,
            },
        }
    );
    await aggregateDailyMetric(component._id, getDateKey(startedAt));
    return { componentId: String(component._id), status, ok: result.ok };
};

const runStatusMonitorCycle = async () => {
    if (!PUBLIC_STATUS_PAGE_ENABLED || monitorRunning) return { skipped: true };
    monitorRunning = true;
    try {
        const count = await StatusComponent.countDocuments({});
        if (count === 0) {
            await seedDefaultStatusCatalog();
        }
        const components = await StatusComponent.find({ isMonitored: true }).sort({ order: 1 }).lean();
        const results = [];
        for (const component of components) {
            results.push(await runStatusCheckForComponent(component));
        }
        invalidatePublicStatusCache();
        return { skipped: false, checked: results.length, results };
    } finally {
        monitorRunning = false;
    }
};

const startStatusMonitorWorker = () => {
    if (monitorTimer || !PUBLIC_STATUS_PAGE_ENABLED) return false;
    const intervalMs = DEFAULT_MONITOR_INTERVAL_SECONDS * 1000;
    monitorTimer = setInterval(() => {
        runStatusMonitorCycle().catch((error) => {
            logger.error('status.monitor_cycle_failed', { error: error.message });
        });
    }, intervalMs);
    if (typeof monitorTimer.unref === 'function') monitorTimer.unref();
    runStatusMonitorCycle().catch((error) => {
        logger.warn('status.monitor_initial_cycle_failed', { error: error.message });
    });
    startStatusSnapshotWorker();
    startStatusNotificationWorker();
    return true;
};

const startStatusSnapshotWorker = () => {
    if (snapshotTimer || !PUBLIC_STATUS_PAGE_ENABLED) return false;
    const intervalMs = DEFAULT_SNAPSHOT_INTERVAL_SECONDS * 1000;
    snapshotTimer = setInterval(() => {
        writeStatusSnapshot().catch((error) => {
            logger.warn('status.snapshot_write_failed', { error: error.message });
        });
    }, intervalMs);
    if (typeof snapshotTimer.unref === 'function') snapshotTimer.unref();
    writeStatusSnapshot().catch((error) => {
        logger.warn('status.snapshot_initial_write_failed', { error: error.message });
    });
    return true;
};

const stopStatusMonitorWorkerForTests = () => {
    if (!monitorTimer) return;
    clearInterval(monitorTimer);
    monitorTimer = null;
};

const stopStatusSnapshotWorkerForTests = () => {
    if (!snapshotTimer) return;
    clearInterval(snapshotTimer);
    snapshotTimer = null;
};

module.exports = {
    ACTIVE_INCIDENT_STATUSES,
    COMPONENT_STATUS_LABELS,
    DEFAULT_STATUS_CATALOG,
    OVERALL_STATUS_MESSAGES,
    SEVERITY_POLICY,
    STUDENT_PACK_SECURITY_STATUS_CATALOG,
    STATUS_UPDATE_TEMPLATES,
    aggregateDailyMetric,
    calculateDayStatus,
    calculateHistoryUptime,
    calculateOverallStatus,
    calculateUptimePercent,
    componentStatusToDayStatus,
    createMaintenance,
    createStatusComponent,
    createStatusIncident,
    addIncidentUpdate,
    generateIncidentPostmortem,
    getIncidentBySlug,
    getDefaultStatusCatalog,
    getActiveStatusIncidents,
    getPublicStatusComponents,
    getPublicStatus,
    getStatusAdminDashboard,
    getStatusHistory,
    getStatusMaintenance,
    getStatusSummary,
    invalidatePublicStatusCache,
    measureStatusPagePower,
    processStatusNotificationOutbox,
    resolveIncident,
    runStatusCheckForComponent,
    runStatusMonitorCycle,
    seedDefaultStatusCatalog,
    startStatusNotificationWorker,
    startStatusMonitorWorker,
    startStatusSnapshotWorker,
    stopStatusNotificationWorkerForTests,
    stopStatusMonitorWorkerForTests,
    stopStatusSnapshotWorkerForTests,
    subscribeToStatus,
    unsubscribeFromStatus,
    updateStatusComponent,
    updateStatusIncident,
    verifyStatusSubscription,
    writeStatusAuditLog,
    writeStatusSnapshot,
    __testables: {
        enqueueStatusEmail,
        resolveInternalHealthSignalStatus,
    },
};
