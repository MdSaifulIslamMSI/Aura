const request = require('supertest');

const previousTrafficFortressEnabled = process.env.TRAFFIC_FORTRESS_ENABLED;
process.env.TRAFFIC_FORTRESS_ENABLED = 'false';

const app = require('../index');

jest.setTimeout(30000);

describe('Admin Ops API Security Tests', () => {
    afterAll(() => {
        if (previousTrafficFortressEnabled === undefined) {
            delete process.env.TRAFFIC_FORTRESS_ENABLED;
        } else {
            process.env.TRAFFIC_FORTRESS_ENABLED = previousTrafficFortressEnabled;
        }
    });

    test('GET /api/admin/ops/readiness should fail without token', async () => {
        const res = await request(app).get('/api/admin/ops/readiness');
        expect(res.statusCode).toBe(401);
    });

    test('GET /api/admin/ops/client-diagnostics should fail without token', async () => {
        const res = await request(app).get('/api/admin/ops/client-diagnostics');
        expect(res.statusCode).toBe(401);
    });

    test('GET /api/admin/ops/aws-control should fail without token', async () => {
        const res = await request(app).get('/api/admin/ops/aws-control');
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/admin/ops/smoke should fail without token', async () => {
        const res = await request(app)
            .post('/api/admin/ops/smoke')
            .send({});
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/admin/ops/aws-control/actions should fail without token', async () => {
        const res = await request(app)
            .post('/api/admin/ops/aws-control/actions')
            .send({
                target: 'staging',
                action: 'stop',
                reason: 'operator requested staging stop',
                confirmationPhrase: 'STOP STAGING',
            });
        expect(res.statusCode).toBe(401);
    });
});
