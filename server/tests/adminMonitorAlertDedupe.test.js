// syncIndexes and the race assertions do real DB work; the 5s default hook
// timeout is not enough on loaded CI runners.
jest.setTimeout(30000);

const AdminNotification = require('../models/AdminNotification');
const {
    __testables: { upsertAnomalyNotification },
} = require('../services/adminAnalyticsMonitorService');
const {
    __testables: { upsertNotification },
} = require('../services/email/emailOpsMonitorService');

const buildAnomaly = (key) => ({
    key,
    title: 'Anomaly',
    currentCount: 42,
    baselineExpected: 4,
    ratio: 10.5,
    severity: 'warning',
    windowMinutes: 5,
    recommendation: 'investigate',
});

describe('monitor alert dedupe', () => {
    beforeAll(async () => {
        // The dedupe relies on the notificationId unique index existing.
        await AdminNotification.syncIndexes();
    });

    afterEach(async () => {
        await AdminNotification.deleteMany({ source: 'system' });
    });

    test('racing analytics alert upserts create exactly one notification', async () => {
        const anomaly = buildAnomaly('race.analytics');
        const outcomes = await Promise.all([
            upsertAnomalyNotification(anomaly),
            upsertAnomalyNotification(anomaly),
        ]);

        const createdCount = outcomes.filter((outcome) => !outcome.skipped).length;
        expect(createdCount).toBe(1);
        expect(await AdminNotification.countDocuments({ entityId: 'race.analytics' })).toBe(1);
    });

    test('racing email-ops alert upserts create exactly one notification', async () => {
        const payload = {
            key: 'race.emailops',
            title: 'Queue backlog',
            summary: 'backlog breached threshold',
            severity: 'warning',
        };
        const outcomes = await Promise.all([
            upsertNotification(payload),
            upsertNotification(payload),
        ]);

        const createdCount = outcomes.filter((outcome) => !outcome.skipped).length;
        expect(createdCount).toBe(1);
        expect(await AdminNotification.countDocuments({ entityId: 'race.emailops' })).toBe(1);
    });
});
