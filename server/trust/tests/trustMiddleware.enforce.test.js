const express = require('express');
const request = require('supertest');
const { requireTrustDecision } = require('../middleware/requireTrustDecision');

describe('trust middleware enforce modes', () => {
    test('enforce-safe blocks order access when user does not own order', async () => {
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
                { config: { mode: 'enforce-safe', enforceOwnership: true } }
            ),
            (_req, res) => res.json({ ok: true })
        );

        const response = await request(app).get('/orders/order-1').expect(403);
        expect(response.body).toMatchObject({
            error: 'ACCESS_DENIED',
            reason: 'RESOURCE_OWNERSHIP_MISMATCH',
            decisionId: expect.stringMatching(/^trust_/),
        });
    });

    test('admin refund returns CHALLENGE when fresh step-up is missing', async () => {
        const app = express();
        app.post(
            '/admin/orders/:id/refund',
            (req, _res, next) => {
                req.user = { _id: 'admin-1', isAdmin: true };
                next();
            },
            requireTrustDecision(
                'admin.order.refund',
                () => ({ id: 'order-1', resourceType: 'order', state: 'paid', totalPrice: 75000 }),
                { config: { mode: 'enforce-sensitive', enforceAdminStepUp: true } }
            ),
            (_req, res) => res.json({ ok: true })
        );

        const response = await request(app).post('/admin/orders/order-1/refund').expect(428);
        expect(response.body).toMatchObject({
            error: 'STEP_UP_REQUIRED',
            requiredStepUp: 'PASSKEY',
            reason: 'STEP_UP_REQUIRED',
            decisionId: expect.stringMatching(/^trust_/),
        });
    });

    test('admin refund returns ALLOW after fresh passkey step-up', async () => {
        const app = express();
        app.post(
            '/admin/orders/:id/refund',
            (req, _res, next) => {
                req.user = { _id: 'admin-1', isAdmin: true };
                req.authSession = {
                    stepUpUntil: new Date(Date.now() + 60_000).toISOString(),
                    amr: ['webauthn'],
                };
                next();
            },
            requireTrustDecision(
                'admin.order.refund',
                () => ({ id: 'order-1', resourceType: 'order', state: 'paid', totalPrice: 75000 }),
                { config: { mode: 'enforce-sensitive', enforceAdminStepUp: true } }
            ),
            (req, res) => res.json({
                ok: true,
                decision: req.trustDecision.decision,
            })
        );

        const response = await request(app).post('/admin/orders/order-1/refund').expect(200);
        expect(response.body).toMatchObject({
            ok: true,
            decision: 'ALLOW',
        });
    });
});
