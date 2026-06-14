const express = require('express');
const mongoose = require('mongoose');
const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        req.user = {
            _id: '69aa000000000000000000aa',
            email: 'admin@example.com',
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
        req.requestId = 'req_support_security_1';
        return next();
    },
    admin: (req, _res, next) => {
        if (!req.user?.isAdmin) {
            const AppError = require('../utils/AppError');
            return next(new AppError('Admin access required', 403));
        }
        return next();
    },
}));

jest.mock('../middleware/routeSecurityGuards', () => ({
    sensitiveActions: new Proxy({}, { get: () => (_req, _res, next) => next() }),
}));

jest.mock('../services/notificationService', () => ({
    sendPersistentNotification: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/socketService', () => ({
    clearSupportVideoSession: jest.fn(),
    emitSupportRealtimeUpdate: jest.fn().mockResolvedValue(null),
    getSupportVideoSession: jest.fn(),
    markSupportVideoSessionConnected: jest.fn(),
    registerSupportVideoSession: jest.fn(),
    sendMessageToAdmins: jest.fn(),
    sendMessageToUser: jest.fn(),
}));

jest.mock('../services/livekitService', () => ({
    buildSupportRoomName: jest.fn((ticketId) => `aura-support-${ticketId}`),
    createSupportParticipantSession: jest.fn(),
    deleteSupportRoom: jest.fn().mockResolvedValue(undefined),
    ensureSupportRoom: jest.fn().mockResolvedValue(undefined),
}));

const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
require('../models/User');
const supportRoutes = require('../routes/supportRoutes');
const { errorHandler, notFound } = require('../middleware/errorMiddleware');
const { sendPersistentNotification } = require('../services/notificationService');
const { sendMessageToAdmins, sendMessageToUser } = require('../services/socketService');

const buildTestApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/support', supportRoutes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
};

describe('Support route security', () => {
    let app;

    beforeEach(async () => {
        jest.clearAllMocks();
        await SupportMessage.deleteMany({});
        await SupportTicket.deleteMany({});
        app = buildTestApp();
    });

    test('admin status update without audit reason fails before ticket mutation or side effects', async () => {
        const ownerId = new mongoose.Types.ObjectId();
        const ticket = await SupportTicket.create({
            user: ownerId,
            subject: 'Billing support request',
            category: 'order_issue',
            status: 'open',
            userActionRequired: false,
            lastActorRole: 'user',
        });

        const res = await request(app)
            .patch(`/api/support/${ticket._id}/status`)
            .send({ status: 'closed' });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Validation Error');

        const after = await SupportTicket.findById(ticket._id).lean();
        expect(after.status).toBe('open');
        expect(after.userActionRequired).toBe(false);
        expect(after.lastActorRole).toBe('user');
        expect(after.resolutionSummary).toBe('');
        expect(after.resolvedAt).toBeNull();
        expect(after.resolvedBy).toBeNull();
        await expect(SupportMessage.countDocuments({ ticket: ticket._id })).resolves.toBe(0);
        expect(sendPersistentNotification).not.toHaveBeenCalled();
        expect(sendMessageToAdmins).not.toHaveBeenCalled();
        expect(sendMessageToUser).not.toHaveBeenCalled();
    });

    test('admin status update with audit reason records the support moderation side effects', async () => {
        const ownerId = new mongoose.Types.ObjectId();
        const ticket = await SupportTicket.create({
            user: ownerId,
            subject: 'Delivery support request',
            category: 'order_issue',
            status: 'open',
            userActionRequired: false,
            lastActorRole: 'user',
        });

        const res = await request(app)
            .patch(`/api/support/${ticket._id}/status`)
            .send({
                status: 'closed',
                resolutionSummary: 'Issue resolved after verifying replacement delivery.',
                userActionRequired: false,
            });

        expect(res.statusCode).toBe(200);
        const after = await SupportTicket.findById(ticket._id).lean();
        expect(after.status).toBe('closed');
        expect(after.lastActorRole).toBe('system');
        expect(after.resolutionSummary).toBe('Issue resolved after verifying replacement delivery.');
        expect(after.resolvedAt).toBeTruthy();
        expect(String(after.resolvedBy)).toBe('69aa000000000000000000aa');

        const systemMessage = await SupportMessage.findOne({ ticket: ticket._id }).lean();
        expect(systemMessage).toMatchObject({
            isAdmin: true,
            isSystem: true,
        });
        expect(systemMessage.text).toContain('Resolution: Issue resolved after verifying replacement delivery.');
        expect(sendPersistentNotification).toHaveBeenCalledTimes(1);
        expect(sendMessageToAdmins).toHaveBeenCalled();
    });
});
