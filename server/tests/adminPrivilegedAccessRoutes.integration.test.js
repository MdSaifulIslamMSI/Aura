jest.mock('../middleware/authMiddleware', () => {
    const currentUser = { id: '64c0b0ff0f1e2c3d4e5f6a7e' };
    return {
        protect: (req, res, next) => {
            req.user = {
                _id: currentUser.id,
                email: 'approver@example.com',
                isAdmin: true,
                trustedDevices: [{ method: 'webauthn' }],
            };
            req.authToken = {
                email_verified: true,
                auth_time: Math.floor(Date.now() / 1000),
            };
            req.authzPosture = {
                fresh: true,
                authAgeSeconds: 0,
                webAuthnStepUpFresh: true,
            };
            req.requestId = 'req_privileged_access_1';
            return next();
        },
        admin: (req, res, next) => next(),
        __setCurrentUser: (id) => { currentUser.id = id; },
    };
});

jest.mock('../models/PrivilegedAccessGrant', () => ({
    create: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    updateMany: jest.fn(),
}));

jest.mock('../services/adminRecoveryGrantService', () => ({
    buildRateLimitKey: jest.fn((scope, req) => `${scope}:${String(req.user?._id || 'anon')}`),
}));

jest.mock('../trust/middleware/requireTrustDecision', () => ({
    requireTrustDecision: () => (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const adminPrivilegedAccessRoutes = require('../routes/adminPrivilegedAccessRoutes');
const { errorHandler, notFound } = require('../middleware/errorMiddleware');
const PrivilegedAccessGrant = require('../models/PrivilegedAccessGrant');

jest.setTimeout(30000);

const SUBJECT_ID = '64c0b0ff0f1e2c3d4e5f6a7d';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/privileged-access', adminPrivilegedAccessRoutes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
};

describe('Admin privileged access routes integration', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        PrivilegedAccessGrant.updateMany.mockResolvedValue({ modifiedCount: 0 });
        app = buildApp();
    });

    test('POST /grants creates a pending request and returns a success envelope', async () => {
        PrivilegedAccessGrant.findOne.mockReturnValue({
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue(null),
        });
        PrivilegedAccessGrant.create.mockResolvedValue({
            grantId: 'jit_new_1',
            subjectUser: SUBJECT_ID,
            permission: 'admin.users.delete',
            status: 'pending',
            reason: 'Offboarding a fraudulent seller account',
            requestedBy: SUBJECT_ID,
        });

        const res = await request(app)
            .post('/api/admin/privileged-access/grants')
            .send({ permission: 'admin.users.delete', reason: 'Offboarding a fraudulent seller account' });

        expect(res.statusCode).toBe(202);
        expect(res.body).toMatchObject({
            success: true,
            grant: { grantId: 'jit_new_1', status: 'pending', permission: 'admin.users.delete' },
        });
    });

    test('POST /grants rejects ineligible permissions with a coded 400', async () => {
        const res = await request(app)
            .post('/api/admin/privileged-access/grants')
            .send({ permission: 'admin.products.write', reason: 'Not eligible for JIT gating' });

        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({
            success: false,
            code: 'PRIVILEGED_PERMISSION_NOT_ELIGIBLE',
            status: 'fail',
        });
    });

    test('POST /grants/:grantId/approve approves a pending grant from another admin', async () => {
        const save = jest.fn().mockResolvedValue(undefined);
        PrivilegedAccessGrant.findOne.mockResolvedValue({
            grantId: 'jit_grant_1',
            subjectUser: SUBJECT_ID,
            requestedBy: SUBJECT_ID,
            permission: 'admin.users.delete',
            status: 'pending',
            save,
        });

        const res = await request(app).post('/api/admin/privileged-access/grants/jit_grant_1/approve');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ success: true, grant: { status: 'approved' } });
        expect(save).toHaveBeenCalled();
    });

    test('POST /grants/:grantId/approve rejects self-approval with a coded 403', async () => {
        // The requester is the same admin that protect injects as the actor.
        PrivilegedAccessGrant.findOne.mockResolvedValue({
            grantId: 'jit_self_approval',
            subjectUser: '64c0b0ff0f1e2c3d4e5f6a7e',
            requestedBy: '64c0b0ff0f1e2c3d4e5f6a7e',
            permission: 'admin.users.delete',
            status: 'pending',
        });

        const res = await request(app).post('/api/admin/privileged-access/grants/jit_self_approval/approve');

        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({
            success: false,
            code: 'PRIVILEGED_SELF_APPROVAL_DENIED',
            status: 'fail',
        });
    });

    test('POST /grants/:grantId/deny denies a pending grant with a reason', async () => {
        const save = jest.fn().mockResolvedValue(undefined);
        PrivilegedAccessGrant.findOne.mockResolvedValue({
            grantId: 'jit_grant_2',
            subjectUser: SUBJECT_ID,
            requestedBy: SUBJECT_ID,
            permission: 'admin.payments.refunds.write',
            status: 'pending',
            save,
        });

        const res = await request(app)
            .post('/api/admin/privileged-access/grants/jit_grant_2/deny')
            .send({ reason: 'Insufficient justification' });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ success: true, grant: { status: 'denied' } });
    });

    test('POST /grants/:grantId/revoke revokes an approved grant', async () => {
        const save = jest.fn().mockResolvedValue(undefined);
        PrivilegedAccessGrant.findOne.mockResolvedValue({
            grantId: 'jit_grant_3',
            subjectUser: SUBJECT_ID,
            requestedBy: SUBJECT_ID,
            permission: 'admin.ops.maintenance',
            status: 'approved',
            save,
        });

        const res = await request(app).post('/api/admin/privileged-access/grants/jit_grant_3/revoke');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ success: true, grant: { status: 'revoked' } });
    });

    test('GET /grants lists grants with a success envelope', async () => {
        PrivilegedAccessGrant.find.mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([
                { grantId: 'jit_grant_1', permission: 'admin.users.delete', status: 'pending' },
            ]),
        });

        const res = await request(app).get('/api/admin/privileged-access/grants?status=pending');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            total: 1,
            items: [{ grantId: 'jit_grant_1', status: 'pending' }],
        });
    });

    test('GET /grants requires an Idempotency-free valid status enum', async () => {
        const res = await request(app).get('/api/admin/privileged-access/grants?status=bogus');

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Validation Error');
    });
});
