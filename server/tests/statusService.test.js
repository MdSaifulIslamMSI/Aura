jest.mock('../services/email', () => ({
    sendTransactionalEmail: jest.fn().mockResolvedValue({ queued: true }),
}));

jest.mock('../services/healthService', () => ({
    getCachedHealthSnapshot: jest.fn(),
}));

const { getCachedHealthSnapshot } = require('../services/healthService');

const StatusComponentGroup = require('../models/StatusComponentGroup');
const StatusComponent = require('../models/StatusComponent');
const StatusCheck = require('../models/StatusCheck');
const StatusDailyMetric = require('../models/StatusDailyMetric');
const StatusIncident = require('../models/StatusIncident');
const StatusSubscriber = require('../models/StatusSubscriber');
const {
    addIncidentUpdate,
    backfillStatusHealthSignals,
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
    runStatusCheckForComponent,
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
                    'database',
                    'mongodb',
                    'redis',
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
        expect(bySlug.get('database')).toMatchObject({
            checkType: 'database',
            metadata: { healthSignal: 'database' },
        });
        expect(bySlug.get('mongodb')).toMatchObject({
            checkType: 'database',
            metadata: { healthSignal: 'database' },
        });
        expect(bySlug.get('redis')).toMatchObject({
            checkType: 'redis',
            metadata: { healthSignal: 'cache' },
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
                catalog: { activeVersion: 'legacy-v1', staleData: false, searchProviderStatus: 'ok', queueLagSec: 0 },
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

    test('catalog health signal judges the fields getCatalogHealth() actually returns', async () => {
        // Shape mirrors server/services/catalogService.js getCatalogHealth(), which
        // exposes no `status` field - the resolver must not depend on one.
        const realCatalogShape = {
            activeVersion: 'cat-2026-09-12',
            previousVersion: null,
            publicReadPolicy: 'published_only',
            demoPreviewAvailable: false,
            lastSuccessfulImportAt: null,
            lastSuccessfulSyncAt: null,
            lastImportAgeSec: null,
            lastSyncAgeSec: null,
            queueLagSec: 0,
            staleData: false,
            searchProviderStatus: 'ok',
            syncCursor: '',
            workers: { importWorkerRunning: true, syncWorkerRunning: true },
            quality: { publishedProductCount: 10, publishReadyProducts: 10, devOnlyProducts: 0, syntheticRejectedProducts: 0 },
        };
        const snapshot = {
            core: { dbConnected: true, redisConnected: true },
            services: { catalog: realCatalogShape },
        };

        await expect(__testables.resolveInternalHealthSignalStatus('catalog', snapshot))
            .resolves.toMatchObject({ ok: true, status: 'operational' });

        // Undetermined Atlas search support is not proof of degradation.
        await expect(__testables.resolveInternalHealthSignalStatus('catalog', {
            ...snapshot,
            services: { catalog: { ...realCatalogShape, searchProviderStatus: 'unknown' } },
        })).resolves.toMatchObject({ ok: true, status: 'operational' });

        await expect(__testables.resolveInternalHealthSignalStatus('catalog', {
            ...snapshot,
            services: { catalog: { ...realCatalogShape, staleData: true } },
        })).resolves.toMatchObject({
            ok: false,
            status: 'degraded_performance',
            errorMessage: 'catalog_health_degraded',
        });

        await expect(__testables.resolveInternalHealthSignalStatus('catalog', {
            ...snapshot,
            services: { catalog: { ...realCatalogShape, searchProviderStatus: 'degraded' } },
        })).resolves.toMatchObject({
            ok: false,
            status: 'degraded_performance',
            errorMessage: 'catalog_health_degraded',
        });

        // Missing catalog signal stays fail-closed, matching the ai signal convention.
        await expect(__testables.resolveInternalHealthSignalStatus('catalog', {
            core: snapshot.core,
            services: {},
        })).resolves.toMatchObject({
            ok: false,
            status: 'degraded_performance',
            errorMessage: 'catalog_health_degraded',
        });
    });

    test('catalog-signal component recovers to operational on the next passing check', async () => {
        await seedDefaultStatusCatalog({ includeDemoMetrics: false });
        const component = await StatusComponent.findOne({ slug: 'product-experience' }).lean();
        expect(component).toBeTruthy();

        await StatusComponent.updateOne(
            { _id: component._id },
            { $set: { currentStatus: 'degraded_performance', consecutiveFailures: 7 } },
        );

        getCachedHealthSnapshot.mockResolvedValue({
            core: { dbConnected: true, redisConnected: true },
            services: { catalog: { activeVersion: 'legacy-v1', staleData: false, searchProviderStatus: 'ok', queueLagSec: 0 } },
        });

        const outcome = await runStatusCheckForComponent({ ...component, currentStatus: 'degraded_performance', consecutiveFailures: 7 });
        expect(outcome).toMatchObject({ ok: true, status: 'operational' });

        const updated = await StatusComponent.findById(component._id).lean();
        expect(updated.currentStatus).toBe('operational');
        expect(updated.consecutiveFailures).toBe(0);
        expect(updated.lastSuccessAt).toBeTruthy();
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
        expect(calculateOverallStatus({
            components: [{ currentStatus: 'operational' }],
            activeIncidents: [{ impact: 'minor', isPublic: true }],
            activeMaintenance: [],
        })).toBe('degraded_performance');
        expect(calculateOverallStatus({
            components: [{ currentStatus: 'operational' }],
            activeIncidents: [{ impact: 'minor', isPublic: false }],
            activeMaintenance: [],
        })).toBe('operational');
    });

    test('public payload reflects minor incidents and manual component overrides', async () => {
        await seedDefaultStatusCatalog({ includeDemoMetrics: false });
        const component = await StatusComponent.findOne({ slug: 'public-api' });

        await createStatusIncident({
            title: 'API latency wobble',
            description: 'Slightly elevated latency on one route.',
            impact: 'minor',
            affectedComponentIds: [String(component._id)],
            updateMessage: 'Investigating slight latency.',
        });

        const withMinorIncident = await getPublicStatus({ force: true });
        expect(withMinorIncident.overallStatus).toBe('degraded_performance');
        expect(withMinorIncident.activeIncidents.length).toBeGreaterThan(0);

        await StatusComponent.findByIdAndUpdate(component._id, { manualStatusOverride: 'partial_outage' });
        const withOverride = await getPublicStatus({ force: true });
        expect(withOverride.overallStatus).toBe('partial_outage');
    });

    test('backfills missing health signals without overwriting existing metadata', async () => {
        const group = await StatusComponentGroup.create({
            name: 'Backfill Group',
            slug: 'backfill-group',
            isPublic: true,
        });
        await StatusComponent.deleteMany({ slug: { $in: ['web-storefront', 'website', 'mystery-box-status-test'] } });
        const missing = await StatusComponent.create({
            groupId: group._id,
            name: 'Web Storefront',
            slug: 'web-storefront',
            checkType: 'internal_health',
            isPublic: true,
            isMonitored: true,
            currentStatus: 'operational',
        });
        const kept = await StatusComponent.create({
            groupId: group._id,
            name: 'Website',
            slug: 'website',
            checkType: 'http',
            checkUrl: 'https://status.example.com/health',
            metadata: { healthSignal: 'custom-keep' },
            isPublic: true,
            isMonitored: true,
            currentStatus: 'operational',
        });
        await StatusComponent.create({
            groupId: group._id,
            name: 'Mystery Box',
            slug: 'mystery-box-status-test',
            checkType: 'manual',
            isPublic: true,
            isMonitored: true,
            currentStatus: 'operational',
        });

        const result = await backfillStatusHealthSignals();

        expect(result.unknownSlugs).toContain('mystery-box-status-test');
        expect(result.unknownSlugs).not.toContain('website');
        const freshMissing = await StatusComponent.findById(missing._id).lean();
        expect(freshMissing.metadata.healthSignal).toBe('web_app');
        const freshKept = await StatusComponent.findById(kept._id).lean();
        expect(freshKept.metadata.healthSignal).toBe('custom-keep');
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

    test('monitor allowlist derives the default web app host without explicit config', () => {
        const defaults = __testables.getDefaultMonitorHostnames();
        expect(defaults.size).toBeGreaterThan(0);
        const allowed = __testables.getAllowedMonitorHosts();
        defaults.forEach((host) => expect(allowed.has(host)).toBe(true));
        expect(allowed.has('127.0.0.1')).toBe(false);
    });

    test('built-in default storefront host stays allowlisted when env resolves elsewhere', () => {
        const relevantKeys = [
            'STATUS_WEB_APP_URL',
            'APP_PUBLIC_URL',
            'FRONTEND_URL',
            'APP_BASE_URL',
            'CORS_ORIGIN',
            'CORS_ORIGINS',
            'STATUS_MONITOR_ALLOWED_HOSTS',
        ];
        const original = Object.fromEntries(relevantKeys.map((key) => [key, process.env[key]]));
        try {
            relevantKeys.forEach((key) => { delete process.env[key]; });
            // Simulates the production split-runtime worker whose env points at a
            // different storefront host while the seeded components still store
            // the built-in default check URL.
            process.env.STATUS_WEB_APP_URL = 'https://dbtrhsolhec1s.cloudfront.net';

            const defaults = __testables.getDefaultMonitorHostnames();
            expect(defaults.has('dbtrhsolhec1s.cloudfront.net')).toBe(true);
            expect(defaults.has('aurapilot.vercel.app')).toBe(true);

            const allowed = __testables.getAllowedMonitorHosts();
            expect(allowed.has('aurapilot.vercel.app')).toBe(true);
        } finally {
            relevantKeys.forEach((key) => {
                if (original[key] === undefined) delete process.env[key];
                else process.env[key] = original[key];
            });
        }
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

describe('status notification outbox worker', () => {
    const StatusNotificationOutbox = require('../models/StatusNotificationOutbox');
    const { processStatusNotificationOutbox } = require('../services/statusService');
    const { sendTransactionalEmail } = require('../services/email');

    const originalNodeEnv = process.env.NODE_ENV;

    const buildRow = (idempotencyKey, overrides = {}) => ({
        eventType: 'incident',
        idempotencyKey,
        recipientEmail: 'ops@example.com',
        subject: `subject ${idempotencyKey}`,
        text: 'body',
        ...overrides,
    });

    beforeEach(async () => {
        // shouldSendStatusEmails() skips processing under NODE_ENV=test.
        process.env.NODE_ENV = 'development';
        sendTransactionalEmail.mockClear();
        await StatusNotificationOutbox.deleteMany({});
    });

    afterEach(async () => {
        process.env.NODE_ENV = originalNodeEnv;
        await StatusNotificationOutbox.deleteMany({});
    });

    test('drains queued rows atomically and marks them sent', async () => {
        await StatusNotificationOutbox.create(buildRow('drain-1', { status: 'queued' }));
        await StatusNotificationOutbox.create(buildRow('drain-2', { status: 'queued' }));

        const result = await processStatusNotificationOutbox();

        expect(result.sent).toBe(2);
        expect(result.checked).toBe(2);
        const sentRows = await StatusNotificationOutbox.find({ status: 'sent' });
        expect(sentRows).toHaveLength(2);
        expect(sentRows.every((row) => !row.lockedBy && row.lockedAt === null)).toBe(true);
    });

    test('skips rows locked by another replica instead of double-sending', async () => {
        await StatusNotificationOutbox.create(buildRow('fresh-lock', {
            status: 'sending',
            lockedAt: new Date(),
            lockedBy: 'other-replica-1',
            attempts: 1,
        }));

        const result = await processStatusNotificationOutbox();

        expect(result.checked).toBe(0);
        const row = await StatusNotificationOutbox.findOne({ idempotencyKey: 'fresh-lock' });
        expect(row.status).toBe('sending');
        expect(row.lockedBy).toBe('other-replica-1');
        expect(sendTransactionalEmail).not.toHaveBeenCalled();
    });

    test('reclaims rows whose lock went stale after a worker crash', async () => {
        await StatusNotificationOutbox.create(buildRow('stale-lock', {
            status: 'sending',
            lockedAt: new Date(Date.now() - 10 * 60 * 1000),
            lockedBy: 'crashed-replica',
            attempts: 2,
        }));

        const result = await processStatusNotificationOutbox();

        expect(result.sent).toBe(1);
        const row = await StatusNotificationOutbox.findOne({ idempotencyKey: 'stale-lock' });
        expect(row.status).toBe('sent');
        expect(row.attempts).toBe(3);
    });

    test('failed sends back off exponentially and release the lock', async () => {
        await StatusNotificationOutbox.create(buildRow('send-fail', { status: 'queued' }));
        sendTransactionalEmail.mockRejectedValueOnce(new Error('smtp down'));

        const result = await processStatusNotificationOutbox();

        expect(result.failed).toBe(1);
        const row = await StatusNotificationOutbox.findOne({ idempotencyKey: 'send-fail' });
        expect(row.status).toBe('failed');
        expect(row.attempts).toBe(1);
        expect(row.lockedBy).toBe('');
        expect(row.lockedAt).toBeNull();
        expect(row.lastError).toContain('smtp down');
        expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    });
});
