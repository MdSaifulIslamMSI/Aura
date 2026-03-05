const request = require('supertest');
const app = require('../index');

describe('Catalog Admin API Security Tests', () => {
    test('POST /api/admin/catalog/imports should fail without token', async () => {
        const res = await request(app)
            .post('/api/admin/catalog/imports')
            .set('Idempotency-Key', 'cat-imp-12345678')
            .send({
                sourceType: 'jsonl',
                sourceRef: 'missing.jsonl',
                mode: 'batch',
            });
        expect(res.statusCode).toBe(401);
    });

    test('GET /api/admin/catalog/imports/:jobId should fail without token', async () => {
        const res = await request(app).get('/api/admin/catalog/imports/imp_missing');
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/admin/catalog/imports/:jobId/publish should fail without token', async () => {
        const res = await request(app)
            .post('/api/admin/catalog/imports/imp_missing/publish')
            .set('Idempotency-Key', 'cat-pub-12345678')
            .send({ confirm: true });
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/admin/catalog/sync/run should fail without token', async () => {
        const res = await request(app)
            .post('/api/admin/catalog/sync/run')
            .set('Idempotency-Key', 'cat-sync-12345678')
            .send({ provider: 'file' });
        expect(res.statusCode).toBe(401);
    });

    test('GET /api/admin/catalog/health should fail without token', async () => {
        const res = await request(app).get('/api/admin/catalog/health');
        expect(res.statusCode).toBe(401);
    });
});
