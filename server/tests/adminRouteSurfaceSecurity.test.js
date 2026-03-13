const request = require('supertest');
const app = require('../index');

jest.setTimeout(30000);

describe('Admin Route Surface Security Matrix', () => {
    const cases = [
        ['GET', '/api/admin/notifications/summary'],
        ['GET', '/api/admin/notifications'],
        ['PATCH', '/api/admin/notifications/read-all'],
        ['PATCH', '/api/admin/notifications/test-notification/read'],

        ['GET', '/api/admin/analytics/overview'],
        ['GET', '/api/admin/analytics/timeseries'],
        ['GET', '/api/admin/analytics/anomalies'],
        ['GET', '/api/admin/analytics/export'],
        ['GET', '/api/admin/analytics/bi-config'],

        ['GET', '/api/admin/users'],
        ['GET', '/api/admin/users/507f1f77bcf86cd799439011'],
        ['POST', '/api/admin/users/507f1f77bcf86cd799439011/warn'],
        ['POST', '/api/admin/users/507f1f77bcf86cd799439011/suspend'],
        ['POST', '/api/admin/users/507f1f77bcf86cd799439011/dismiss-warning'],
        ['POST', '/api/admin/users/507f1f77bcf86cd799439011/reactivate'],
        ['POST', '/api/admin/users/507f1f77bcf86cd799439011/delete'],

        ['GET', '/api/admin/products'],
        ['GET', '/api/admin/products/1001'],
        ['GET', '/api/admin/products/1001/logs'],
        ['POST', '/api/admin/products'],
        ['PATCH', '/api/admin/products/1001/core'],
        ['PATCH', '/api/admin/products/1001/pricing'],
        ['DELETE', '/api/admin/products/1001'],

        ['GET', '/api/admin/payments'],
        ['GET', '/api/admin/payments/refunds/ledger'],
        ['PATCH', '/api/admin/payments/refunds/ledger/507f1f77bcf86cd799439011/req_1/reference'],
        ['GET', '/api/admin/payments/pi_test'],
        ['POST', '/api/admin/payments/pi_test/capture'],
        ['POST', '/api/admin/payments/pi_test/retry-capture'],

        ['GET', '/api/admin/ops/readiness'],
        ['POST', '/api/admin/ops/smoke'],
    ];

    test.each(cases)('%s %s should return 401 without token', async (method, url) => {
        const lower = method.toLowerCase();
        let req = request(app)[lower](url);

        if (['post', 'patch', 'delete'].includes(lower)) {
            req = req.send({});
        }

        const res = await req;
        expect(res.statusCode).toBe(401);
    });
});
