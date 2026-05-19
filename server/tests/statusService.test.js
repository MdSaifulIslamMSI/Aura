const StatusComponentGroup = require('../models/StatusComponentGroup');
const StatusComponent = require('../models/StatusComponent');
const StatusIncident = require('../models/StatusIncident');
const StatusSubscriber = require('../models/StatusSubscriber');
const {
    addIncidentUpdate,
    calculateDayStatus,
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
    test('calculates uptime and daily status thresholds', () => {
        expect(calculateUptimePercent({ successfulChecks: 999, totalChecks: 1000 })).toBe(99.9);
        expect(calculateDayStatus({ uptimePercent: 99.95, totalChecks: 100 })).toBe('operational');
        expect(calculateDayStatus({ uptimePercent: 99.4, totalChecks: 100 })).toBe('degraded');
        expect(calculateDayStatus({ uptimePercent: 97.5, totalChecks: 100 })).toBe('partial_outage');
        expect(calculateDayStatus({ uptimePercent: 90, totalChecks: 100 })).toBe('major_outage');
        expect(calculateDayStatus({ uptimePercent: 100, totalChecks: 100, maintenanceChecks: 1 })).toBe('maintenance');
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
