const request = require('supertest');
const app = require('../index');
const { seedDefaultStatusCatalog } = require('../services/statusService');

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
});
