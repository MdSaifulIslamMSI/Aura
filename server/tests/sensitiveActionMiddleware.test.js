const express = require('express');
const request = require('supertest');
const { requireSensitiveAction } = require('../middleware/sensitiveActionMiddleware');
const { SENSITIVE_ACTION_CATEGORIES } = require('../config/sensitiveActionPolicy');

jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

const buildApp = ({ user, posture = {}, env = {} } = {}) => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production', ...env };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = user;
        req.authzPosture = {
            fresh: true,
            authAgeSeconds: 60,
            ...posture,
        };
        next();
    });
    app.post('/admin/users/:userId/suspend', requireSensitiveAction({
        action: 'admin.users.mutate',
        category: SENSITIVE_ACTION_CATEGORIES.ADMIN_USER_MANAGEMENT,
        riskLevel: 'critical',
        resourceType: 'user',
    }), (req, res) => {
        res.json({ ok: true, decision: req.sensitiveActionDecision });
    });
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || 500).json({
            message: err.message,
            code: err.code,
            telemetryCode: err.telemetryCode,
        });
    });
    return app;
};

describe('sensitive action middleware', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
        jest.resetModules();
    });

    test('blocks critical admin action without registered WebAuthn credential', async () => {
        const app = buildApp({
            user: {
                _id: 'admin-1',
                isAdmin: true,
                trustedDevices: [],
            },
            posture: {
                webAuthnStepUpFresh: true,
            },
        });

        const res = await request(app)
            .post('/admin/users/user-1/suspend')
            .send({});

        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({
            code: 'WEBAUTHN_REGISTRATION_REQUIRED',
            telemetryCode: 'security.policy.denied.webauthn_registration_required',
        });
    });

    test('allows critical admin action with fresh WebAuthn evidence', async () => {
        const app = buildApp({
            user: {
                _id: 'admin-1',
                isAdmin: true,
                trustedDevices: [{ method: 'webauthn' }],
            },
            posture: {
                webAuthnStepUpFresh: true,
            },
        });

        const res = await request(app)
            .post('/admin/users/user-1/suspend')
            .send({});

        expect(res.statusCode).toBe(200);
        expect(res.body.decision).toMatchObject({
            allowed: true,
            action: 'admin.users.mutate',
            riskLevel: 'critical',
        });
    });

    test('rollback bypass works only when configured', async () => {
        const app = buildApp({
            user: {
                _id: 'admin-1',
                isAdmin: true,
                trustedDevices: [],
            },
            env: {
                AUTH_SENSITIVE_ACTION_POLICY_ROLLBACK: 'true',
            },
        });

        const res = await request(app)
            .post('/admin/users/user-1/suspend')
            .send({});

        expect(res.statusCode).toBe(200);
        expect(res.body.decision).toMatchObject({
            allowed: true,
            reason: 'rollback_override',
            rollbackAllowed: true,
        });
    });
});
