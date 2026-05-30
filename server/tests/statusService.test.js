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
    getDefaultStatusCatalog,
    getPublicStatus,
    measureStatusPagePower,
    pruneStatusChecks,
    resolveIncident,
    seedDefaultStatusCatalog,
    subscribeToStatus,
    __testables,
} = require('../services/statusService');

describe('statusService', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalStatusSeedDemoMetrics = process.env.STATUS_SEED_DEMO_METRICS;
    const originalSecurityHarnessEnabled = process.env.STUDENT_PACK_SECURITY_HARNESS_ENABLED;
    const originalSecurityHarnessPublic = process.env.STUDENT_PACK_SECURITY_HARNESS_PUBLIC;
    const originalSecurityHarnessProbeEndpoints = process.env.STUDENT_PACK_SECURITY_HARNESS_PROBE_ENDPOINTS;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalStatusSeedDemoMetrics === undefined) {
            delete process.env.STATUS_SEED_DEMO_METRICS;
        } else {
            process.env.STATUS_SEED_DEMO_METRICS = originalStatusSeedDemoMetrics;
        }
        if (originalSecurityHarnessEnabled === undefined) {
            delete process.env.STUDENT_PACK_SECURITY_HARNESS_ENABLED;
        } else {
            process.env.STUDENT_PACK_SECURITY_HARNESS_ENABLED = originalSecurityHarnessEnabled;
        }
        if (originalSecurityHarnessPublic === undefined) {
            delete process.env.STUDENT_PACK_SECURITY_HARNESS_PUBLIC;
        } else {
            process.env.STUDENT_PACK_SECURITY_HARNESS_PUBLIC = originalSecurityHarnessPublic;
        }
        if (originalSecurityHarnessProbeEndpoints === undefined) {
            delete process.env.STUDENT_PACK_SECURITY_HARNESS_PROBE_ENDPOINTS;
        } else {
            process.env.STUDENT_PACK_SECURITY_HARNESS_PROBE_ENDPOINTS = originalSecurityHarnessProbeEndpoints;
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

    test('prunes only raw status checks older than retention cutoff', async () => {
        const group = await StatusComponentGroup.create({
            name: 'Retention',
            slug: 'retention-group',
            isPublic: true,
        });
        const component = await StatusComponent.create({
            groupId: group._id,
            name: 'Retention API',
            slug: 'retention-api',
            isPublic: true,
            isMonitored: true,
            currentStatus: 'operational',
        });
        await StatusCheck.create([
            {
                componentId: component._id,
                status: 'operational',
                checkedAt: new Date('2026-05-01T00:00:00.000Z'),
            },
            {
                componentId: component._id,
                status: 'operational',
                checkedAt: new Date('2026-05-08T00:00:00.000Z'),
            },
            {
                componentId: component._id,
                status: 'operational',
                checkedAt: new Date('2026-05-10T00:00:00.000Z'),
            },
        ]);

        const dryRun = await pruneStatusChecks({
            dryRun: true,
            force: true,
            now: new Date('2026-05-10T00:00:00.000Z'),
            retentionDays: 7,
        });
        expect(dryRun).toMatchObject({
            dryRun: true,
            staleBefore: 1,
            deletedCount: 0,
            remainingStaleCount: 1,
        });
        expect(await StatusCheck.countDocuments()).toBe(3);

        const executed = await pruneStatusChecks({
            force: true,
            now: new Date('2026-05-10T00:00:00.000Z'),
            retentionDays: 7,
        });
        expect(executed).toMatchObject({
            dryRun: false,
            staleBefore: 1,
            deletedCount: 1,
            remainingStaleCount: 0,
        });
        expect(await StatusCheck.countDocuments()).toBe(2);
    });

    test('production seed never creates fake historical metrics', async () => {
        process.env.NODE_ENV = 'production';
        process.env.STATUS_SEED_DEMO_METRICS = 'true';

        await seedDefaultStatusCatalog();

        expect(await StatusDailyMetric.countDocuments()).toBe(0);
    });

    test('default catalog wires public surfaces to real monitored health signals', async () => {
        await seedDefaultStatusCatalog({ includeDemoMetrics: false });

        const components = await StatusComponent.find({
            slug: {
                $in: [
                    'web-storefront',
                    'authentication',
                    'payment-processing',
                    'email-delivery',
                    'status-subscriptions',
                    'commerce-assistant',
                    'media-uploads',
                    'admin-console',
                ],
            },
        }).lean();
        const bySlug = new Map(components.map((component) => [component.slug, component]));

        expect(bySlug.get('web-storefront')).toMatchObject({
            checkType: 'http',
            metadata: { healthSignal: 'web_app' },
        });
        expect(bySlug.get('authentication')).toMatchObject({
            checkType: 'internal_health',
            metadata: { healthSignal: 'auth' },
        });
        expect(bySlug.get('payment-processing')).toMatchObject({
            checkType: 'internal_health',
            metadata: { healthSignal: 'payments' },
        });
        expect(bySlug.get('email-delivery')).toMatchObject({
            checkType: 'internal_health',
            metadata: { healthSignal: 'email' },
        });
        expect(bySlug.get('status-subscriptions')).toMatchObject({
            checkType: 'internal_health',
            metadata: { healthSignal: 'status_subscriptions' },
        });
        expect(bySlug.get('commerce-assistant')).toMatchObject({
            checkType: 'internal_health',
            metadata: { healthSignal: 'ai' },
        });
        expect(bySlug.get('media-uploads')).toMatchObject({
            checkType: 'internal_health',
            metadata: { healthSignal: 'uploads' },
        });
        expect(bySlug.get('admin-console')).toMatchObject({
            checkType: 'internal_health',
            metadata: { healthSignal: 'admin' },
        });
    });

    test('measures status page power from coverage, signals, history, and operations', async () => {
        await seedDefaultStatusCatalog();

        const payload = await getPublicStatus({ force: true });
        const dimensions = payload.statusPower.dimensions.map((dimension) => dimension.id);

        expect(payload.statusPower).toMatchObject({
            level: 'powerhouse',
            coverage: {
                groups: expect.any(Number),
                components: expect.any(Number),
                measuredDays90d: 90,
            },
        });
        expect(payload.statusPower.score).toBeGreaterThanOrEqual(90);
        expect(payload.statusPower.coverage.groups).toBeGreaterThanOrEqual(10);
        expect(payload.statusPower.coverage.components).toBeGreaterThanOrEqual(14);
        expect(payload.statusPower.coverage.healthSignals).toBeGreaterThanOrEqual(10);
        expect(dimensions).toEqual(expect.arrayContaining([
            'surface_coverage',
            'health_signal_depth',
            'history_depth',
            'incident_operations',
            'security_posture',
        ]));
    });

    test('status page power measurement drops when monitoring history is absent', () => {
        const power = measureStatusPagePower({
            groups: [{ name: 'API' }],
            components: [{ checkType: 'manual', metadata: {} }],
            publicGroups: [{
                components: [{ history90d: [] }],
                measuredDays90d: 0,
            }],
        });

        expect(power.level).toBe('thin');
        expect(power.score).toBeLessThan(60);
        expect(power.dimensions.find((dimension) => dimension.id === 'history_depth')).toMatchObject({
            score: 0,
        });
    });

    test('security harness catalog is opt-in and exposes provider health signals', async () => {
        expect(getDefaultStatusCatalog().some((group) => group.slug === 'security-harness')).toBe(false);

        process.env.STUDENT_PACK_SECURITY_HARNESS_ENABLED = 'true';
        process.env.STUDENT_PACK_SECURITY_HARNESS_PUBLIC = 'true';
        process.env.STUDENT_PACK_SECURITY_HARNESS_PROBE_ENDPOINTS = 'false';
        await seedDefaultStatusCatalog({ includeDemoMetrics: false });

        const harnessGroup = await StatusComponentGroup.findOne({ slug: 'security-harness' }).lean();
        const sentryComponent = await StatusComponent.findOne({ slug: 'security-sentry-runtime-guard' }).lean();
        const payload = await getPublicStatus({ force: true });

        expect(harnessGroup).toMatchObject({ name: 'Security Harness', isPublic: true });
        expect(sentryComponent).toMatchObject({
            checkType: 'internal_health',
            metadata: { healthSignal: 'student_pack_sentry' },
        });
        expect(payload.securityHarness).toMatchObject({
            enabled: true,
        });
        expect(payload.securityHarness.providers.map((provider) => provider.id)).toEqual(expect.arrayContaining([
            'sentry',
            'datadog',
            'doppler',
            'testmail',
            'lambdatest',
            'localstack',
        ]));
        expect(JSON.stringify(payload.securityHarness)).not.toContain(process.env.DATADOG_API_KEY || 'secret-never-set');
    });

    test('internal health signals classify core service readiness without exposing internals', async () => {
        const snapshot = {
            core: { dbConnected: true, redisConnected: true },
            services: {
                catalog: { status: 'ok', staleData: false },
                paymentQueue: { status: 'ok', workerRunning: true },
                reconciliation: { status: 'ok' },
                fx: { status: 'ok' },
                emailQueue: { status: 'ok', workerRunning: true },
                ai: {
                    commerceAssistant: { healthy: true, gateway: { status: 'ok' } },
                    chatQuota: { status: 'ok' },
                },
                realtime: {
                    socket: { status: 'ok' },
                    videoCalls: { status: 'ok' },
                },
            },
        };

        await expect(__testables.resolveInternalHealthSignalStatus('catalog', snapshot))
            .resolves.toMatchObject({ ok: true, status: 'operational' });
        await expect(__testables.resolveInternalHealthSignalStatus('payments', {
            ...snapshot,
            services: {
                ...snapshot.services,
                paymentQueue: { status: 'degraded', workerRunning: true },
            },
        })).resolves.toMatchObject({
            ok: false,
            status: 'degraded_performance',
            errorMessage: 'payment_health_degraded',
        });
        const emailResult = await __testables.resolveInternalHealthSignalStatus('email', snapshot);
        expect(emailResult.ok).toBe(true);
        expect(['operational', 'maintenance']).toContain(emailResult.status);
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
