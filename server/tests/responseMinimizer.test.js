const express = require('express');
const request = require('supertest');
const { requestId } = require('../middleware/requestId');
const { errorHandler } = require('../middleware/errorMiddleware');
const AppError = require('../utils/AppError');

jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

describe('Invisible Fabric response minimization', () => {
    beforeEach(() => {
        process.env = {
            ...ORIGINAL_ENV,
            NODE_ENV: 'production',
            INVISIBLE_FABRIC_ENABLED: 'true',
            INVISIBLE_CLOAK_ADMIN: 'true',
            INVISIBLE_RESPONSE_MINIMIZATION: 'true',
        };
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    const buildApp = (handler) => {
        const app = express();
        app.use(requestId);
        app.get('/api/admin/users', handler);
        app.get('/api/products/fail', handler);
        app.use(errorHandler);
        return app;
    };

    test('anonymous or non-admin admin errors are cloaked', async () => {
        const app = buildApp((req, _res, next) => next(new AppError('Not authorized as an admin', 403)));

        const response = await request(app).get('/api/admin/users').expect(404);

        expect(response.body).toMatchObject({
            status: 'error',
            message: 'Not found',
        });
    });

    test('admin step-up errors remain actionable for legitimate admins', async () => {
        const app = buildApp((req, _res, next) => {
            req.user = { _id: 'admin-1', isAdmin: true };
            const error = new AppError('Fresh WebAuthn step-up verification is required for this action.', 403);
            error.code = 'WEBAUTHN_STEP_UP_REQUIRED';
            next(error);
        });

        const response = await request(app).get('/api/admin/users').expect(403);

        expect(response.body.message).toContain('Fresh WebAuthn');
    });

    test('admin recovery reauthentication errors remain actionable for legitimate admins', async () => {
        const app = buildApp((req, _res, next) => {
            req.user = { _id: 'admin-1', isAdmin: true };
            const error = new AppError('Sign in again before using an admin recovery grant.', 401);
            error.code = 'ADMIN_PRIMARY_REAUTH_REQUIRED';
            next(error);
        });

        const response = await request(app).get('/api/admin/users').expect(401);

        expect(response.body).toMatchObject({
            code: 'ADMIN_PRIMARY_REAUTH_REQUIRED',
            message: 'Sign in again before using an admin recovery grant.',
        });
    });

    test('production provider/database errors are sanitized and include request id', async () => {
        const app = buildApp((req, _res, next) => {
            next(new Error('MongoServerError at C:\\server\\models\\User.js PRIVATE_KEY leaked'));
        });

        const response = await request(app)
            .get('/api/products/fail')
            .set('X-Request-Id', 'req-minimized')
            .expect(500);

        expect(response.body).toEqual({
            status: 'error',
            message: 'Request failed',
            requestId: 'req-minimized',
        });
    });

    test('preserves only the allowlisted scanner-unavailable code on minimized 5xx responses', async () => {
        const app = buildApp((req, _res, next) => {
            const error = new AppError('Avatar malware scan unavailable. Please try again later.', 503);
            error.code = 'UPLOAD_SCANNER_UNAVAILABLE';
            next(error);
        });

        const response = await request(app)
            .get('/api/products/fail')
            .set('X-Request-Id', 'req-scanner-unavailable')
            .expect(503);

        expect(response.body).toEqual({
            success: false,
            code: 'UPLOAD_SCANNER_UNAVAILABLE',
            status: 'error',
            message: 'Request failed',
            requestId: 'req-scanner-unavailable',
        });
    });
});
