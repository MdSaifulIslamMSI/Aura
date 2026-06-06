const express = require('express');
const request = require('supertest');
const { requireTrustDecision } = require('../middleware/requireTrustDecision');

describe('trust middleware shadow mode', () => {
    test('shadow mode never blocks an existing successful route', async () => {
        const app = express();
        app.get(
            '/orders/:id',
            (req, _res, next) => {
                req.user = { _id: 'user-1' };
                next();
            },
            requireTrustDecision(
                'order.read',
                () => ({ id: 'order-1', resourceType: 'order', ownerId: 'user-2' }),
                { config: { mode: 'shadow' } }
            ),
            (req, res) => res.json({
                ok: true,
                decision: req.trustDecision.decision,
                reason: req.trustDecision.reason,
            })
        );

        const response = await request(app).get('/orders/order-1').expect(200);
        expect(response.body).toMatchObject({
            ok: true,
            decision: 'AUDIT_ONLY',
            reason: 'RESOURCE_OWNERSHIP_MISMATCH',
        });
    });
});
