const request = require('supertest');
const app = require('../index');

describe('Admin Ops API Security Tests', () => {
    test('GET /api/admin/ops/readiness should fail without token', async () => {
        const res = await request(app).get('/api/admin/ops/readiness');
        expect(res.statusCode).toBe(401);
    });

    test('GET /api/admin/ops/client-diagnostics should fail without token', async () => {
        const res = await request(app).get('/api/admin/ops/client-diagnostics');
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/admin/ops/smoke should fail without token', async () => {
        const res = await request(app)
            .post('/api/admin/ops/smoke')
            .send({});
        expect(res.statusCode).toBe(401);
    });
});
