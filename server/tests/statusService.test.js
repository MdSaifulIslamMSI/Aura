const StatusComponentGroup = require('../models/StatusComponentGroup');
const StatusComponent = require('../models/StatusComponent');
const StatusCheck = require('../models/StatusCheck');
const StatusDailyMetric = require('../models/StatusDailyMetric');
const StatusIncident = require('../models/StatusIncident');
const StatusSubscriber = require('../models/StatusSubscriber');
const {
    addIncidentUpdate,
    calculateDayStatus,
    calculateHistoryUptime,
    calculateOverallStatus,
    calculateUptimePercent,
    createStatusComponent,
    createStatusIncident,
    getPublicStatus,
    resolveIncident,
    seedDefaultStatusCatalog,
    subscribeToStatus,
} = require('../services/statusService');

describe('statusService', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalStatusSeedDemoMetrics = process.env.STATUS_SEED_DEMO_METRICS;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalStatusSeedDemoMetrics === undefined) {
            delete process.env.STATUS_SEED_DEMO_METRICS;
        } else {
            process.env.STATUS_SEED_DEMO_METRICS = originalStatusSeedDemoMetrics;
        }
    });

    test('calculates uptime and daily status thresholds', () => {
        expect(calculateUptimePercent({ successfulChecks: 999, totalChecks: 1000 })).toBe(99.9);
        expect(calculateDayStatus({ uptimePercent: 99.95, totalChecks: 100 })).toBe('operational');
        expect(calculateDayStatus({ uptimePercent: 99.4, totalChecks: 100 })).toBe('degraded');
        expect(calculateDayStatus({ uptimePercent: 97.5, totalChecks: 100 })).toBe('partial_outage');
        expect(calculateDayStatus({ uptimePercent: 90, totalChecks: 100 })).toBe('major_outage');
        expect(calculateDayStatus({ uptimePercent: 100, totalChecks: 100, maintenanceChecks: 1 })).toBe('maintenance');
    });

    test('calculates 90-day uptime from measured days only', async () => {
        const date = new Date().toISOString().slice(0, 10);
        const group = await StatusComponentGroup.create({
            name: 'API',
            slug: 'api-measured-window',
            isPublic: true,
        });
        const component = await StatusComponent.create({
            groupId: group._id,
            name: 'Public API',
            slug: 'api-measured-window-public',
            isPublic: true,
            isMonitored: true,
            currentStatus: 'operational',
        });
        await StatusDailyMetric.create({
            componentId: component._id,
            date,
            uptimePercent: 100,
            status: 'operational',
            totalChecks: 1,
            successfulChecks: 1,
        });

        const payload = await getPublicStatus({ force: true });
        const publicGroup = payload.groups[0];
        const publicComponent = publicGroup.components[0];

        expect(publicComponent.uptimePercent90d).toBe(100);
        expect(publicComponent.uptimeSinceMonitoringBegan).toBe(100);
        expect(publicComponent.measuredDays90d).toBe(1);
        expect(publicComponent.monitoringStartedAt).toBe(new Date(`${date}T00:00:00.000Z`).toISOString());
        expect(publicComponent.history90d.filter((entry) => entry.status === 'unknown')).toHaveLength(89);
        expect(publicGroup.uptimePercent90d).toBe(100);
        expect(payload.uptimeSinceMonitoringBegan).toBe(100);
    });

    test('unknown history days are excluded from uptime calculation', () => {
        expect(calculateHistoryUptime([
            { date: '2026-01-01', status: 'unknown', uptimePercent: null },
            { date: '2026-01-02', status: 'unknown', uptimePercent: 0 },
            { date: '2026-01-03', status: 'operational', uptimePercent: 100 },
        ])).toBe(100);
    });

    test('uses monitor checks for a day only when no daily aggregate exists', async () => {
        const date = new Date().toISOString().slice(0, 10);
        const group = await StatusComponentGroup.create({
            name: 'Worker',
            slug: 'worker-check-fallback',
            isPublic: true,
        });
        const component = await StatusComponent.create({
            groupId: group._id,
            name: 'Queue Worker',
            slug: 'queue-worker-check-fallback',
            isPublic: true,
            isMonitored: true,
            currentStatus: 'operational',
        });
        await StatusCheck.create({
            componentId: component._id,
            status: 'operational',
            checkedAt: new Date(`${date}T12:00:00.000Z`),
        });

        const payload = await getPublicStatus({ force: true });
        const publicComponent = payload.groups[0].components[0];
        expect(publicComponent.history90d.filter((entry) => entry.status === 'unknown')).toHaveLength(89);
        expect(publicComponent.history90d.at(-1)).toMatchObject({
            date,
            status: 'operational',
            uptimePercent: 100,
            totalChecks: 1,
        });
        expect(publicComponent.uptimePercent90d).toBe(100);
    });

    test('production seed never creates fake historical metrics', async () => {
        process.env.NODE_ENV = 'production';
        process.env.STATUS_SEED_DEMO_METRICS = 'true';

        await seedDefaultStatusCatalog();

        expect(await StatusDailyMetric.countDocuments()).toBe(0);
    });

    test('development seed can create demo metrics outside production', async () => {
        process.env.NODE_ENV = 'development';
        process.env.STATUS_SEED_DEMO_METRICS = 'true';

        await seedDefaultStatusCatalog();

        expect(await StatusDailyMetric.countDocuments()).toBeGreaterThan(0);
    });

    test('rolls up overall status from active incidents and components', () => {
        expect(calculateOverallStatus({
            components: [{ currentStatus: 'operational' }],
            activeIncidents: [{ impact: 'critical', isPublic: true }],
            activeMaintenance: [],
        })).toBe('major_outage');
        expect(calculateOverallStatus({
            components: [{ currentStatus: 'partial_outage' }],
            activeIncidents: [],
            activeMaintenance: [],
        })).toBe('partial_outage');
        expect(calculateOverallStatus({
            components: [{ currentStatus: 'operational' }],
            activeIncidents: [],
            activeMaintenance: [{ id: 'maintenance' }],
        })).toBe('maintenance');
    });

    test('public payload sanitizes monitor internals', async () => {
        const group = await StatusComponentGroup.create({
            name: 'Private Dependency',
            slug: 'private-dependency',
            isPublic: true,
        });
        await StatusComponent.create({
            groupId: group._id,
            name: 'Public API',
            slug: 'public-api-status-test',
            checkType: 'http',
            checkUrl: 'https://internal.example.com/secret-health',
            metadata: { privateUrl: 'mongodb://secret.example' },
            isPublic: true,
            isMonitored: true,
            currentStatus: 'operational',
        });

        const payload = await getPublicStatus({ force: true });
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain('secret-health');
        expect(serialized).not.toContain('mongodb://');
        expect(payload.groups[0].components[0]).not.toHaveProperty('checkUrl');
        expect(payload.groups[0].components[0]).not.toHaveProperty('metadata');
    });

    test('admin HTTP monitor config rejects private check URLs', async () => {
        await expect(createStatusComponent({
            groupName: 'API',
            name: 'Internal monitor target',
            checkType: 'http',
            checkUrl: 'http://127.0.0.1:5000/health',
        })).rejects.toThrow('STATUS_MONITOR_ALLOWED_HOSTS');
    });

    test('incident lifecycle creates, updates, and resolves', async () => {
        const { components } = await seedDefaultStatusCatalog({ includeDemoMetrics: false });
        expect(components).toBeGreaterThan(0);
        const component = await StatusComponent.findOne({ slug: 'public-api' });
        const incident = await createStatusIncident({
            title: 'API latency spike',
            description: 'Elevated latency across public API routes.',
            impact: 'major',
            confirmMajor: true,
            affectedComponentIds: [String(component._id)],
            updateMessage: 'Investigating elevated latency.',
        });
        await addIncidentUpdate(String(incident._id), {
            status: 'identified',
            message: 'A database query regression was identified.',
        });
        const resolved = await resolveIncident(String(incident._id), {
            message: 'Latency returned to normal.',
        });
        const fresh = await StatusIncident.findById(incident._id).lean();
        expect(resolved.status).toBe('resolved');
        expect(fresh.resolvedAt).toBeTruthy();
    });

    test('subscription validation stores hashed unsubscribe token only', async () => {
        await expect(subscribeToStatus({ email: 'not-an-email' })).rejects.toThrow('valid email');
        await subscribeToStatus({ email: 'status-user@example.com', notificationLevel: 'major' });
        const subscriber = await StatusSubscriber.findOne({ email: 'status-user@example.com' }).lean();
        expect(subscriber.unsubscribeTokenHash).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(subscriber)).not.toContain('dev-status-unsubscribe-secret');
        expect(subscriber.notificationLevel).toBe('major');
    });
});
