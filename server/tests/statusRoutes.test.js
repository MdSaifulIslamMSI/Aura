const request = require('supertest');
const crypto = require('crypto');
const app = require('../index');
const { seedDefaultStatusCatalog } = require('../services/statusService');
const StatusComponent = require('../models/StatusComponent');
const StatusIncident = require('../models/StatusIncident');
const StatusNotificationOutbox = require('../models/StatusNotificationOutbox');

const signWebhook = (payload, secret = 'test-status-webhook-secret') => {
    const timestamp = String(Date.now());
    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
    return { timestamp, raw, signature };
};

describe('Status routes', () => {
    test('GET /api/status/public returns sanitized public status', async () => {
        await seedDefaultStatusCatalog({ includeDemoMetrics: false });
        const res = await request(app).get('/api/status/public');

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('overallStatus');
        expect(Array.isArray(res.body.groups)).toBe(true);
        expect(JSON.stringify(res.body)).not.toContain('checkUrl');
        expect(JSON.stringify(res.body)).not.toContain('metadata');
    });

    test('public status split endpoints are cacheable', async () => {
        await seedDefaultStatusCatalog({ includeDemoMetrics: false });

        const [components, active, history, maintenance, rss, summary] = await Promise.all([
            request(app).get('/api/status/components'),
            request(app).get('/api/status/incidents/active'),
            request(app).get('/api/status/incidents/history'),
            request(app).get('/api/status/maintenance'),
            request(app).get('/api/status/rss.xml'),
            request(app).get('/api/status/summary.json'),
        ]);

        expect(components.statusCode).toBe(200);
        expect(active.statusCode).toBe(200);
        expect(history.statusCode).toBe(200);
        expect(maintenance.statusCode).toBe(200);
        expect(rss.statusCode).toBe(200);
        expect(summary.statusCode).toBe(200);
        expect(components.headers['cache-control']).toContain('stale-while-revalidate=300');
        expect(rss.headers['content-type']).toContain('application/rss+xml');
    });

    test('admin status dashboard requires admin auth', async () => {
        const res = await request(app).get('/api/admin/status');
        expect(res.statusCode).toBe(401);
    });

    test('subscribe endpoint validates email input', async () => {
        const res = await request(app)
            .post('/api/status/subscribe')
            .send({ email: 'bad-email', notificationLevel: 'all' });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    test('subscriber emails are queued instead of sent from request thread', async () => {
        await seedDefaultStatusCatalog({ includeDemoMetrics: false });
        const component = await StatusComponent.findOne({ slug: 'api' });
        await request(app)
            .post('/api/status/subscribe')
            .send({ email: 'status-queue@example.com', notificationLevel: 'all' })
            .expect(201);

        const incident = await StatusIncident.create({
            title: 'API degraded performance',
            slug: 'api-degraded-performance',
            severity: 'SEV3',
            impact: 'minor',
            status: 'investigating',
            affectedComponentIds: [component._id],
            isPublic: true,
        });
        const { addIncidentUpdate } = require('../services/statusService');
        await addIncidentUpdate(String(incident._id), {
            status: 'investigating',
            message: 'We are investigating elevated API errors.',
            public: true,
        });

        const queued = await StatusNotificationOutbox.find({ recipientEmail: 'status-queue@example.com' }).lean();
        expect(queued.length).toBeGreaterThan(0);
        expect(queued.every((entry) => ['queued', 'failed'].includes(entry.status))).toBe(true);
    });

    test('uptime kuma webhook rejects missing HMAC signature', async () => {
        await request(app)
            .post('/api/status/webhooks/uptime-kuma')
            .send({ monitorName: 'api', status: 'down' })
            .expect(401);
    });

    test('uptime kuma webhook deduplicates signed monitor events and creates draft after repeated failures', async () => {
        process.env.STATUS_WEBHOOK_SECRET = 'test-status-webhook-secret';
        await seedDefaultStatusCatalog({ includeDemoMetrics: false });

        for (let index = 0; index < 3; index += 1) {
            const payload = { eventId: `api-down-${index}`, monitorName: 'api', status: 'down' };
            const { timestamp, raw, signature } = signWebhook(payload);
            await request(app)
                .post('/api/status/webhooks/uptime-kuma')
                .set('Content-Type', 'application/json')
                .set('x-aura-timestamp', timestamp)
                .set('x-aura-signature', signature)
                .send(raw)
                .expect(200);
        }

        const draft = await StatusIncident.findOne({ source: 'uptime_kuma', isPublic: false }).lean();
        expect(draft).toBeTruthy();
        expect(draft.severity).not.toBe('SEV1');

        const duplicatePayload = { eventId: 'api-down-2', monitorName: 'api', status: 'down' };
        const duplicate = signWebhook(duplicatePayload);
        const duplicateRes = await request(app)
            .post('/api/status/webhooks/uptime-kuma')
            .set('Content-Type', 'application/json')
            .set('x-aura-timestamp', duplicate.timestamp)
            .set('x-aura-signature', duplicate.signature)
            .send(duplicate.raw);
        expect(duplicateRes.statusCode).toBe(202);
        expect(duplicateRes.body.duplicate).toBe(true);
    });
});
