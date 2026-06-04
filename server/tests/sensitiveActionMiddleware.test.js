const express = require('express');
const { rateLimit } = require('express-rate-limit');
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
const testRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1000,
    standardHeaders: false,
    legacyHeaders: false,
});

const buildApp = ({
    user,
    posture = {},
    env = {},
    action = 'admin.users.mutate',
    category = SENSITIVE_ACTION_CATEGORIES.ADMIN_USER_MANAGEMENT,
    riskLevel = 'critical',
    route = '/admin/users/:userId/suspend',
} = {}) => {
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
    app.post(route, testRateLimiter, requireSensitiveAction({
        action,
        category,
        riskLevel,
        resourceType: 'user',
    }), (req, res) => {
        res.json({ ok: true, decision: req.sensitiveActionDecision });
    });
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || 500).json({
            message: err.message,
            code: err.code,
            telemetryCode: err.telemetryCode,
            requiresStepUpMfa: err.requiresStepUpMfa,
            mfaChallenge: err.mfaChallenge,
            mfaPolicy: err.mfaPolicy,
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

    test('returns a fresh MFA challenge for sensitive actions when MFA policy is enabled', async () => {
        const app = buildApp({
            route: '/account/recovery-codes/regenerate',
            action: 'auth.recovery.change',
            category: SENSITIVE_ACTION_CATEGORIES.ACCOUNT_RECOVERY_CHANGE,
            riskLevel: 'critical',
            user: {
                _id: 'user-1',
                isAdmin: false,
                mfa: {
                    enabled: true,
                    totp: {
                        enabled: true,
                        confirmedAt: new Date(),
                    },
                },
                recoveryCodeState: { activeCount: 1 },
            },
            posture: {
                fresh: true,
                authAgeSeconds: 60,
            },
            env: {
                NODE_ENV: 'test',
                MFA_ENABLED: 'true',
                MFA_TOTP_ENABLED: 'true',
                MFA_RECOVERY_CODES_ENABLED: 'true',
            },
        });

        const res = await request(app)
            .post('/account/recovery-codes/regenerate')
            .send({});

        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({
            code: 'FRESH_MFA_REQUIRED',
            requiresStepUpMfa: true,
            mfaChallenge: {
                purpose: 'step_up',
                allowedMethods: ['totp', 'recovery_code'],
                preferredMethod: 'totp',
            },
            mfaPolicy: {
                freshMfaRequired: true,
            },
        });
    });
});
