const request = require('supertest');
const app = require('../index');

describe('Order Email Admin API Security Tests', () => {
    test('GET /api/admin/order-emails should fail without token', async () => {
        const res = await request(app).get('/api/admin/order-emails');
        expect(res.statusCode).toBe(401);
    });

    test('GET /api/admin/order-emails/:notificationId should fail without token', async () => {
        const res = await request(app).get('/api/admin/order-emails/test_notification');
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/admin/order-emails/:notificationId/retry should fail without token', async () => {
        const res = await request(app)
            .post('/api/admin/order-emails/test_notification/retry')
            .set('Idempotency-Key', 'retry-key-12345');
        expect(res.statusCode).toBe(401);
    });
});
