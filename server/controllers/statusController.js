const asyncHandler = require('express-async-handler');
const StatusCheck = require('../models/StatusCheck');
const StatusSubscriber = require('../models/StatusSubscriber');
const AppError = require('../utils/AppError');
const {
    addIncidentUpdate,
    createMaintenance,
    createStatusComponent,
    createStatusIncident,
    getIncidentBySlug,
    getPublicStatus,
    getStatusAdminDashboard,
    getStatusHistory,
    resolveIncident,
    runStatusMonitorCycle,
    seedDefaultStatusCatalog,
    subscribeToStatus,
    unsubscribeFromStatus,
    updateStatusComponent,
    updateStatusIncident,
} = require('../services/statusService');

const escapeXml = (value = '') => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const publicBaseUrl = () => String(process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/+$/, '');

const getPublicStatusController = asyncHandler(async (req, res) => {
    const payload = await getPublicStatus();
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30');
    res.json(payload);
});

const getStatusHistoryController = asyncHandler(async (req, res) => {
    const result = await getStatusHistory(req.query || {});
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.json(result);
});

const getStatusIncidentController = asyncHandler(async (req, res) => {
    const result = await getIncidentBySlug(req.params.slug);
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.json(result);
});

const getStatusRssController = asyncHandler(async (req, res) => {
    const result = await getStatusHistory({ page: 1, limit: 30, type: 'all' });
    const items = result.incidents.map((incident) => {
        const link = `${publicBaseUrl()}/status/incidents/${incident.slug}`;
        const description = [
            `Impact: ${incident.impact}`,
            `State: ${incident.status}`,
            incident.latestUpdate?.message || incident.description || '',
        ].filter(Boolean).join('\n');
        return [
            '<item>',
            `<title>${escapeXml(incident.title)}</title>`,
            `<link>${escapeXml(link)}</link>`,
            `<guid>${escapeXml(link)}</guid>`,
            `<pubDate>${new Date(incident.startedAt || Date.now()).toUTCString()}</pubDate>`,
            `<description>${escapeXml(description)}</description>`,
            '</item>',
        ].join('');
    }).join('');
    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0">',
        '<channel>',
        '<title>Aura Marketplace Status</title>',
        `<link>${escapeXml(`${publicBaseUrl()}/status`)}</link>`,
        '<description>Public incident and maintenance updates for Aura Marketplace.</description>',
        `<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
        items,
        '</channel>',
        '</rss>',
    ].join('');
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=60');
    res.send(xml);
});

const subscribeStatusController = asyncHandler(async (req, res) => {
    const subscription = await subscribeToStatus(req.body || {});
    res.status(201).json({
        success: true,
        message: 'Subscription saved. You will receive status updates based on your preferences.',
        subscription,
    });
});

const unsubscribeStatusController = asyncHandler(async (req, res) => {
    const result = await unsubscribeFromStatus(req.body || {});
    res.json({ success: true, ...result });
});

const getAdminStatusController = asyncHandler(async (req, res) => {
    const dashboard = await getStatusAdminDashboard();
    res.json({ success: true, dashboard });
});

const createAdminStatusComponentController = asyncHandler(async (req, res) => {
    const component = await createStatusComponent(req.body || {});
    res.status(201).json({ success: true, componentId: String(component._id) });
});

const updateAdminStatusComponentController = asyncHandler(async (req, res) => {
    const component = await updateStatusComponent(req.params.id, req.body || {});
    res.json({ success: true, componentId: String(component._id) });
});

const createAdminStatusIncidentController = asyncHandler(async (req, res) => {
    const incident = await createStatusIncident(req.body || {}, req.user?._id || null);
    res.status(201).json({ success: true, incidentId: String(incident._id), slug: incident.slug });
});

const updateAdminStatusIncidentController = asyncHandler(async (req, res) => {
    const result = await updateStatusIncident(req.params.id, req.body || {}, req.user?._id || null);
    res.json({ success: true, incidentId: String(result.incident._id) });
});

const addAdminStatusIncidentUpdateController = asyncHandler(async (req, res) => {
    const update = await addIncidentUpdate(req.params.id, req.body || {}, req.user?._id || null);
    res.status(201).json({ success: true, updateId: String(update._id) });
});

const resolveAdminStatusIncidentController = asyncHandler(async (req, res) => {
    const incident = await resolveIncident(req.params.id, req.body || {}, req.user?._id || null);
    res.json({ success: true, incidentId: String(incident._id), status: incident.status });
});

const createAdminStatusMaintenanceController = asyncHandler(async (req, res) => {
    const incident = await createMaintenance(req.body || {}, req.user?._id || null);
    res.status(201).json({ success: true, incidentId: String(incident._id), slug: incident.slug });
});

const listAdminStatusSubscribersController = asyncHandler(async (req, res) => {
    const subscribers = await StatusSubscriber.find({})
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
    res.json({
        success: true,
        total: await StatusSubscriber.countDocuments({}),
        subscribers: subscribers.map((subscriber) => ({
            id: String(subscriber._id),
            email: subscriber.email,
            verifiedAt: subscriber.verifiedAt,
            notificationLevel: subscriber.notificationLevel,
            selectedComponentIds: (subscriber.selectedComponentIds || []).map(String),
            selectedGroupIds: (subscriber.selectedGroupIds || []).map(String),
            createdAt: subscriber.createdAt,
            updatedAt: subscriber.updatedAt,
        })),
    });
});

const listAdminStatusChecksController = asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.componentId) filter.componentId = req.query.componentId;
    if (req.query.status) filter.status = req.query.status;
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 200);
    const checks = await StatusCheck.find(filter)
        .sort({ checkedAt: -1 })
        .limit(limit)
        .populate('componentId', 'name slug')
        .lean();
    res.json({
        success: true,
        checks: checks.map((check) => ({
            id: String(check._id),
            componentId: check.componentId?._id ? String(check.componentId._id) : String(check.componentId || ''),
            componentName: check.componentId?.name || 'Unknown component',
            status: check.status,
            responseTimeMs: check.responseTimeMs,
            httpStatusCode: check.httpStatusCode,
            errorMessage: check.errorMessage || '',
            checkedAt: check.checkedAt,
            region: check.region || '',
        })),
    });
});

const runAdminStatusMonitorController = asyncHandler(async (req, res) => {
    const result = await runStatusMonitorCycle();
    res.json({ success: true, result });
});

const seedAdminStatusController = asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        throw new AppError('Status seed endpoint is disabled in production', 403);
    }
    const result = await seedDefaultStatusCatalog({ includeDemoMetrics: req.body?.includeDemoMetrics !== false });
    res.json({ success: true, result });
});

module.exports = {
    addAdminStatusIncidentUpdateController,
    createAdminStatusComponentController,
    createAdminStatusIncidentController,
    createAdminStatusMaintenanceController,
    getAdminStatusController,
    getPublicStatusController,
    getStatusHistoryController,
    getStatusIncidentController,
    getStatusRssController,
    listAdminStatusChecksController,
    listAdminStatusSubscribersController,
    resolveAdminStatusIncidentController,
    runAdminStatusMonitorController,
    seedAdminStatusController,
    subscribeStatusController,
    unsubscribeStatusController,
    updateAdminStatusComponentController,
    updateAdminStatusIncidentController,
};
