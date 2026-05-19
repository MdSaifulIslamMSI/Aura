const crypto = require('crypto');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
const xss = require('xss');

const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { EMAIL_REGEX, flags: emailFlags } = require('../config/emailFlags');
const { getRedisHealth } = require('../config/redis');
const { sendTransactionalEmail } = require('./email');
const { getCachedHealthSnapshot } = require('./healthService');
const StatusComponentGroup = require('../models/StatusComponentGroup');
const StatusComponent = require('../models/StatusComponent');
const StatusCheck = require('../models/StatusCheck');
const StatusDailyMetric = require('../models/StatusDailyMetric');
const StatusIncident = require('../models/StatusIncident');
const StatusIncidentUpdate = require('../models/StatusIncidentUpdate');
const StatusSubscriber = require('../models/StatusSubscriber');

const COMPONENT_STATUS_LABELS = {
    operational: 'Operational',
    degraded_performance: 'Degraded performance',
    partial_outage: 'Partial outage',
    major_outage: 'Major outage',
    maintenance: 'Maintenance',
};

const OVERALL_STATUS_MESSAGES = {
    operational: 'All systems operational',
    degraded_performance: 'Degraded performance',
    partial_outage: 'Partial outage',
    major_outage: 'Major outage',
    maintenance: 'Scheduled maintenance',
};

const STATUS_RANK = {
    operational: 0,
    maintenance: 1,
    degraded_performance: 2,
    partial_outage: 3,
    major_outage: 4,
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
const PUBLIC_STATUS_PAGE_ENABLED = String(process.env.PUBLIC_STATUS_PAGE_ENABLED || 'true').trim().toLowerCase() !== 'false';
const xssTextFilter = new xss.FilterXSS({ whiteList: {}, stripIgnoreTag: true, stripIgnoreTagBody: ['script', 'style'] });

let publicStatusCache = { expiresAt: 0, value: null, inFlight: null };
let monitorTimer = null;
let monitorRunning = false;

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
    if (components.some((component) => component.currentStatus === 'degraded_performance')) return 'degraded_performance';
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

const componentStatusToDayStatus = (status) => {
    switch (status) {
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

const shouldSendStatusEmails = () => process.env.NODE_ENV !== 'test';

const DEFAULT_STATUS_CATALOG = [
    {
        name: 'Web App',
        slug: 'web-app',
        description: 'Customer storefront, browsing, cart, and checkout UI.',
        components: [
            { name: 'Storefront', slug: 'web-storefront', checkType: 'manual' },
            { name: 'Product Experience', slug: 'product-experience', checkType: 'manual' },
        ],
    },
    {
        name: 'API',
        slug: 'api',
        description: 'Public and authenticated marketplace APIs.',
        components: [
            { name: 'Public API', slug: 'public-api', checkType: 'internal_health' },
            { name: 'Commerce API', slug: 'commerce-api', checkType: 'internal_health' },
        ],
    },
    {
        name: 'Auth',
        slug: 'auth',
        description: 'Login, sessions, trusted-device checks, and admin access.',
        components: [{ name: 'Authentication', slug: 'authentication', checkType: 'manual' }],
    },
    {
        name: 'Database',
        slug: 'database',
        description: 'MongoDB persistence layer.',
        components: [{ name: 'MongoDB', slug: 'mongodb', checkType: 'database' }],
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
        components: [{ name: 'Payment Processing', slug: 'payment-processing', checkType: 'manual' }],
    },
    {
        name: 'Email',
        slug: 'email',
        description: 'Transactional email and notification delivery.',
        components: [{ name: 'Email Delivery', slug: 'email-delivery', checkType: 'manual' }],
    },
    {
        name: 'AI Services',
        slug: 'ai-services',
        description: 'Assistant, recommendations, and product intelligence.',
        components: [{ name: 'Commerce Assistant', slug: 'commerce-assistant', checkType: 'manual' }],
    },
    {
        name: 'File Uploads',
        slug: 'file-uploads',
        description: 'Review media and upload pipeline.',
        components: [{ name: 'Media Uploads', slug: 'media-uploads', checkType: 'manual' }],
    },
    {
        name: 'Realtime',
        slug: 'realtime',
        description: 'Chat, live updates, and video session signaling.',
        components: [{ name: 'Realtime Messaging', slug: 'realtime-messaging', checkType: 'manual' }],
    },
    {
        name: 'Admin Panel',
        slug: 'admin-panel',
        description: 'Admin dashboard and operational controls.',
        components: [{ name: 'Admin Console', slug: 'admin-console', checkType: 'manual' }],
    },
];

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

    for (const [groupIndex, groupConfig] of DEFAULT_STATUS_CATALOG.entries()) {
        const group = await StatusComponentGroup.findOneAndUpdate(
            { slug: groupConfig.slug },
            {
                $setOnInsert: {
                    name: groupConfig.name,
                    slug: groupConfig.slug,
                    description: groupConfig.description,
                    order: groupIndex,
                    isPublic: true,
                },
            },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );
        groups.push(group);

        for (const [componentOrder, componentConfig] of groupConfig.components.entries()) {
            const component = await StatusComponent.findOneAndUpdate(
                { slug: componentConfig.slug },
                {
                    $setOnInsert: {
                        groupId: group._id,
                        name: componentConfig.name,
                        slug: componentConfig.slug,
                        description: componentConfig.description || '',
                        checkType: componentConfig.checkType || 'manual',
                        currentStatus: 'operational',
                        isPublic: true,
                        isMonitored: true,
                        order: componentOrder,
                        metadata: componentConfig.metadata || {},
                    },
                },
                { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
            );
            if (includeDemoMetrics) {
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

const buildComponentHistory = ({ componentId, dates, metricMap }) => dates.map((date) => {
    const metric = metricMap.get(`${String(componentId)}:${date}`);
    return {
        date,
        status: metric?.status || 'unknown',
        uptimePercent: metric ? Number(metric.uptimePercent || 0) : null,
        downtimeMinutes: metric ? Number(metric.downtimeMinutes || 0) : null,
    };
});

const buildGroupHistory = (componentHistories, dates) => dates.map((date, index) => {
    const dayEntries = componentHistories.map((history) => history[index]).filter(Boolean);
    const knownEntries = dayEntries.filter((entry) => entry.status !== 'unknown');
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
        .map((entry) => Number(entry.uptimePercent))
        .filter((value) => Number.isFinite(value));
    if (values.length === 0) return null;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
};

const formatIncidentSummary = (incident, updates = [], componentMap = new Map()) => ({
    id: String(incident._id),
    title: sanitizeText(incident.title, 180),
    slug: incident.slug,
    description: sanitizeText(incident.description, 2000),
    impact: incident.impact,
    status: incident.status,
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
        message: sanitizeText(updates[0].message, 1000),
        createdAt: updates[0].createdAt,
    } : null,
    startedAt: incident.startedAt,
    resolvedAt: incident.resolvedAt,
    scheduledStartAt: incident.scheduledStartAt,
    scheduledEndAt: incident.scheduledEndAt,
    durationMinutes: incident.resolvedAt ? formatDurationMinutes(incident.startedAt, incident.resolvedAt) : formatDurationMinutes(incident.startedAt),
    url: buildPublicStatusUrl(`/status/incidents/${incident.slug}`),
});

const getActiveIncidentRows = async () => {
    const incidents = await StatusIncident.find({
        isPublic: true,
        status: { $in: ACTIVE_INCIDENT_STATUSES },
    }).sort({ startedAt: -1 }).lean();
    if (incidents.length === 0) return [];
    const updates = await StatusIncidentUpdate.find({
        incidentId: { $in: incidents.map((incident) => incident._id) },
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
    const dates = buildDateRange(HISTORY_DAYS);
    const groups = await StatusComponentGroup.find({ isPublic: true }).sort({ order: 1, name: 1 }).lean();
    const groupIds = groups.map((group) => group._id);
    const components = await StatusComponent.find({
        isPublic: true,
        groupId: { $in: groupIds },
    }).sort({ order: 1, name: 1 }).lean();
    const metricMap = await fetchMetricMap(components.map((component) => component._id), dates);
    const componentsByGroup = new Map();

    components.forEach((component) => {
        const key = String(component.groupId);
        if (!componentsByGroup.has(key)) componentsByGroup.set(key, []);
        componentsByGroup.get(key).push(component);
    });

    const activeRows = await getActiveIncidentRows();
    const activeIncidents = activeRows.filter((incident) => incident.type !== 'maintenance');
    const activeMaintenance = activeRows.filter((incident) => incident.type === 'maintenance');

    const publicGroups = groups.map((group) => {
        const groupComponents = componentsByGroup.get(String(group._id)) || [];
        const componentPayloads = groupComponents.map((component) => {
            const history90d = buildComponentHistory({ componentId: component._id, dates, metricMap });
            return {
                id: String(component._id),
                name: sanitizeText(component.name, 120),
                slug: component.slug,
                status: component.manualStatusOverride || component.currentStatus || 'operational',
                statusLabel: COMPONENT_STATUS_LABELS[component.manualStatusOverride || component.currentStatus] || 'Unknown',
                uptimePercent90d: calculateHistoryUptime(history90d),
                lastCheckedAt: component.lastCheckedAt,
                lastResponseTimeMs: component.lastResponseTimeMs,
                history90d,
            };
        });
        const histories = componentPayloads.map((component) => component.history90d);
        const history90d = buildGroupHistory(histories, dates);
        return {
            id: String(group._id),
            name: sanitizeText(group.name, 120),
            slug: group.slug,
            description: sanitizeText(group.description, 500),
            status: chooseWorstComponentStatus(componentPayloads.map((component) => component.status)),
            statusLabel: COMPONENT_STATUS_LABELS[chooseWorstComponentStatus(componentPayloads.map((component) => component.status))] || 'Unknown',
            uptimePercent90d: calculateHistoryUptime(history90d),
            componentsCount: componentPayloads.length,
            history90d,
            components: componentPayloads,
        };
    });

    const overallStatus = calculateOverallStatus({ components, activeIncidents, activeMaintenance });
    return {
        overallStatus,
        message: OVERALL_STATUS_MESSAGES[overallStatus] || OVERALL_STATUS_MESSAGES.operational,
        lastUpdatedAt: nowIso(),
        groups: publicGroups,
        activeIncidents,
        activeMaintenance,
    };
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
        ? await StatusIncidentUpdate.find({ incidentId: { $in: incidents.map((incident) => incident._id) } }).sort({ createdAt: 1 }).lean()
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
            message: sanitizeText(update.message, 1000),
            createdAt: update.createdAt,
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
        StatusIncidentUpdate.find({ incidentId: incident._id }).sort({ createdAt: 1 }).lean(),
        StatusComponent.find({ _id: { $in: incident.affectedComponentIds || [] }, isPublic: true }).lean(),
    ]);
    const componentMap = new Map(components.map((component) => [String(component._id), component]));
    return {
        incident: {
            ...formatIncidentSummary(incident, [...updates].reverse(), componentMap),
            timeline: updates.map((update) => ({
                status: update.status,
                message: sanitizeText(update.message, 2000),
                createdAt: update.createdAt,
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
    const subscriber = await StatusSubscriber.findOneAndUpdate(
        { email: normalizedEmail },
        {
            $set: {
                selectedComponentIds: selectedComponentIds.map((id) => toObjectId(id, 'selectedComponentIds')),
                selectedGroupIds: selectedGroupIds.map((id) => toObjectId(id, 'selectedGroupIds')),
                notificationLevel,
                unsubscribeTokenHash,
            },
            $setOnInsert: {
                email: normalizedEmail,
                verifiedAt: null,
            },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    if (shouldSendStatusEmails()) {
        await sendTransactionalEmail({
            eventType: 'system',
            to: normalizedEmail,
            subject: 'Aura status subscription confirmed',
            text: [
                'You are subscribed to Aura Marketplace status updates.',
                `Notification level: ${notificationLevel}`,
                `Unsubscribe: ${buildPublicStatusUrl(`/status/subscribe?unsubscribe=${encodeURIComponent(unsubscribeToken)}`)}`,
            ].join('\n'),
            html: '',
            requestId: `status-subscribe-${subscriber._id}`,
            securityTags: ['status', 'subscription'],
            meta: { subscriberId: String(subscriber._id), notificationLevel },
        }).catch((error) => {
            logger.warn('status.subscription_email_failed', { email: normalizedEmail, error: error.message });
        });
    }

    return {
        subscriberId: String(subscriber._id),
        email: subscriber.email,
        notificationLevel: subscriber.notificationLevel,
    };
};

const unsubscribeFromStatus = async ({ token } = {}) => {
    const tokenHash = hashToken(token);
    const result = await StatusSubscriber.deleteOne({ unsubscribeTokenHash: tokenHash });
    return { removed: Number(result.deletedCount || 0) > 0 };
};

const getStatusAdminDashboard = async () => {
    const [
        publicPayload,
        totalSubscribers,
        recentChecks,
        allGroups,
        allComponents,
        allIncidents,
    ] = await Promise.all([
        getPublicStatus({ force: true }),
        StatusSubscriber.countDocuments({}),
        StatusCheck.find({}).sort({ checkedAt: -1 }).limit(80).populate('componentId', 'name slug').lean(),
        StatusComponentGroup.find({}).sort({ order: 1, name: 1 }).lean(),
        StatusComponent.find({}).sort({ order: 1, name: 1 }).lean(),
        StatusIncident.find({}).sort({ startedAt: -1 }).limit(30).lean(),
    ]);

    const degradedComponents = allComponents.filter((component) => !['operational', 'maintenance'].includes(component.currentStatus)).length;
    const uptimeValues = publicPayload.groups
        .map((group) => Number(group.uptimePercent90d))
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
            lastCheckedAt: component.lastCheckedAt,
            lastResponseTimeMs: component.lastResponseTimeMs,
            consecutiveFailures: component.consecutiveFailures,
            order: component.order,
        })),
        incidents: allIncidents.map((incident) => ({
            id: String(incident._id),
            title: incident.title,
            slug: incident.slug,
            impact: incident.impact,
            status: incident.status,
            affectedComponentIds: (incident.affectedComponentIds || []).map(String),
            startedAt: incident.startedAt,
            resolvedAt: incident.resolvedAt,
            scheduledStartAt: incident.scheduledStartAt,
            scheduledEndAt: incident.scheduledEndAt,
            isPublic: incident.isPublic,
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
        isPublic: payload.isPublic !== undefined ? Boolean(payload.isPublic) : true,
        isMonitored: payload.isMonitored !== undefined ? Boolean(payload.isMonitored) : true,
        manualStatusOverride: payload.manualStatusOverride || null,
        currentStatus: payload.currentStatus || payload.manualStatusOverride || 'operational',
        order: payload.order || 0,
        metadata: payload.metadata || {},
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
        'timeoutMs', 'isPublic', 'isMonitored', 'manualStatusOverride', 'currentStatus', 'order', 'metadata',
    ];
    allowed.forEach((field) => {
        if (payload[field] === undefined) return;
        if (['name', 'description', 'checkUrl'].includes(field)) {
            component[field] = sanitizeText(payload[field], field === 'description' ? 500 : 500);
            return;
        }
        component[field] = payload[field];
    });
    if (payload.groupId) component.groupId = toObjectId(payload.groupId, 'groupId');
    if (payload.slug) component.slug = normalizeSlug(payload.slug);
    if (payload.manualStatusOverride !== undefined) {
        component.currentStatus = payload.manualStatusOverride || payload.currentStatus || component.currentStatus;
    }
    await component.save();
    invalidatePublicStatusCache();
    return component;
};

const createIncidentUpdate = async ({ incident, status, message, createdBy }) => {
    const update = await StatusIncidentUpdate.create({
        incidentId: incident._id,
        status: status || incident.status,
        message: sanitizeText(message || incident.description || incident.title, 5000),
        createdBy: createdBy || null,
    });
    return update;
};

const notifySubscribersOfIncident = async ({ incident, update }) => {
    if (!shouldSendStatusEmails()) return { sent: 0 };
    const subscribers = await StatusSubscriber.find({}).lean();
    if (subscribers.length === 0) return { sent: 0 };
    const incidentType = incident.impact === 'maintenance' ? 'maintenance' : 'incident';
    const isMajor = ['major', 'critical'].includes(incident.impact);
    let sent = 0;
    await Promise.all(subscribers.map(async (subscriber) => {
        if (subscriber.notificationLevel === 'maintenance' && incidentType !== 'maintenance') return;
        if (subscriber.notificationLevel === 'major' && !isMajor) return;
        const token = buildUnsubscribeToken(subscriber.email);
        const subject = incidentType === 'maintenance'
            ? `Scheduled maintenance: ${incident.title}`
            : `Status update: ${incident.title}`;
        const text = [
            subject,
            `Impact: ${incident.impact}`,
            `State: ${incident.status}`,
            '',
            sanitizeText(update?.message || incident.description || '', 1200),
            '',
            `View: ${buildPublicStatusUrl(`/status/incidents/${incident.slug}`)}`,
            `Unsubscribe: ${buildPublicStatusUrl(`/status/subscribe?unsubscribe=${encodeURIComponent(token)}`)}`,
        ].join('\n');
        await sendTransactionalEmail({
            eventType: 'system',
            to: subscriber.email,
            subject,
            text,
            html: '',
            requestId: `status-incident-${incident._id}`,
            securityTags: ['status', incidentType],
            meta: { incidentId: String(incident._id), impact: incident.impact, status: incident.status },
        }).then(() => { sent += 1; }).catch((error) => {
            logger.warn('status.incident_email_failed', { subscriberId: String(subscriber._id), error: error.message });
        });
    }));
    return { sent };
};

const createStatusIncident = async (payload = {}, actorUserId = null) => {
    const title = sanitizeText(payload.title, 180);
    if (!title) throw new AppError('Incident title is required', 400);
    const impact = payload.impact || 'minor';
    if (['major', 'critical'].includes(impact) && payload.confirmMajor !== true) {
        throw new AppError('Publishing a major or critical incident requires confirmation', 409);
    }
    const affectedComponentIds = (payload.affectedComponentIds || []).map((id) => toObjectId(id, 'affectedComponentIds'));
    const incident = await StatusIncident.create({
        title,
        slug: payload.slug ? normalizeSlug(payload.slug) : await generateIncidentSlug(title),
        description: sanitizeText(payload.description, 5000),
        impact,
        status: payload.status || 'investigating',
        affectedComponentIds,
        startedAt: payload.startedAt ? new Date(payload.startedAt) : new Date(),
        scheduledStartAt: payload.scheduledStartAt ? new Date(payload.scheduledStartAt) : null,
        scheduledEndAt: payload.scheduledEndAt ? new Date(payload.scheduledEndAt) : null,
        isPublic: payload.isPublic !== undefined ? Boolean(payload.isPublic) : true,
        createdBy: actorUserId || null,
    });
    const update = await createIncidentUpdate({
        incident,
        status: incident.status,
        message: payload.updateMessage || incident.description || incident.title,
        createdBy: actorUserId,
    });
    if (incident.isPublic) {
        await notifySubscribersOfIncident({ incident, update });
    }
    invalidatePublicStatusCache();
    return incident;
};

const updateStatusIncident = async (incidentId, payload = {}, actorUserId = null) => {
    const incident = await StatusIncident.findById(toObjectId(incidentId, 'incidentId'));
    if (!incident) throw new AppError('Incident not found', 404);
    ['title', 'description', 'impact', 'status', 'isPublic', 'resolutionSummary'].forEach((field) => {
        if (payload[field] !== undefined) {
            incident[field] = ['title', 'description', 'resolutionSummary'].includes(field)
                ? sanitizeText(payload[field], field === 'title' ? 180 : 5000)
                : payload[field];
        }
    });
    if (payload.affectedComponentIds) {
        incident.affectedComponentIds = payload.affectedComponentIds.map((id) => toObjectId(id, 'affectedComponentIds'));
    }
    if (payload.startedAt) incident.startedAt = new Date(payload.startedAt);
    if (payload.resolvedAt) incident.resolvedAt = new Date(payload.resolvedAt);
    if (payload.scheduledStartAt !== undefined) incident.scheduledStartAt = payload.scheduledStartAt ? new Date(payload.scheduledStartAt) : null;
    if (payload.scheduledEndAt !== undefined) incident.scheduledEndAt = payload.scheduledEndAt ? new Date(payload.scheduledEndAt) : null;
    await incident.save();

    let update = null;
    if (payload.updateMessage) {
        update = await createIncidentUpdate({
            incident,
            status: incident.status,
            message: payload.updateMessage,
            createdBy: actorUserId,
        });
        if (incident.isPublic) await notifySubscribersOfIncident({ incident, update });
    }
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
        createdBy: actorUserId,
    });
    await incident.save();
    if (incident.isPublic) await notifySubscribersOfIncident({ incident, update });
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
        createdBy: actorUserId,
    });
    if (incident.isPublic) await notifySubscribersOfIncident({ incident, update });
    invalidatePublicStatusCache();
    return incident;
};

const createMaintenance = async (payload = {}, actorUserId = null) => createStatusIncident({
    ...payload,
    impact: 'maintenance',
    status: payload.status || 'identified',
    confirmMajor: true,
}, actorUserId);

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

const runInternalHealthCheck = async () => {
    const snapshot = await getCachedHealthSnapshot();
    const ok = Boolean(snapshot?.core?.dbConnected && snapshot?.core?.redisConnected);
    return {
        ok,
        responseTimeMs: 0,
        errorMessage: ok ? '' : 'internal_health_degraded',
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

    const status = classifyCheckStatus({ result, component });
    const consecutiveFailures = result.ok ? 0 : Number(component.consecutiveFailures || 0) + 1;
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
    return true;
};

const stopStatusMonitorWorkerForTests = () => {
    if (!monitorTimer) return;
    clearInterval(monitorTimer);
    monitorTimer = null;
};

module.exports = {
    ACTIVE_INCIDENT_STATUSES,
    COMPONENT_STATUS_LABELS,
    DEFAULT_STATUS_CATALOG,
    OVERALL_STATUS_MESSAGES,
    aggregateDailyMetric,
    calculateDayStatus,
    calculateOverallStatus,
    calculateUptimePercent,
    componentStatusToDayStatus,
    createMaintenance,
    createStatusComponent,
    createStatusIncident,
    addIncidentUpdate,
    getIncidentBySlug,
    getPublicStatus,
    getStatusAdminDashboard,
    getStatusHistory,
    invalidatePublicStatusCache,
    resolveIncident,
    runStatusCheckForComponent,
    runStatusMonitorCycle,
    seedDefaultStatusCatalog,
    startStatusMonitorWorker,
    stopStatusMonitorWorkerForTests,
    subscribeToStatus,
    unsubscribeFromStatus,
    updateStatusComponent,
    updateStatusIncident,
};
